// Masks for the cut step (forge-pipeline requirements 4.1, 4.2, 4.5; director rulings 2 and 3).
// rasterizeMask: scanline fill at pixel centres with the non-zero winding rule (Gemini polygons
// can cross themselves), then an inward distance feather. lumaKey: near-black ground -> 0.
// Pure: plain arrays in, a fresh Mask out.
import type { Polygon, Rgba } from "./types.js";

/** A one-channel alpha mask: `data` holds width * height bytes, row-major, 0..255. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Ruling 2: `lo` is the brightest luma in the four corner patches, plus a margin, but at least 10. */
export const KEY_CORNER_PATCH = 40;
export const KEY_LO_MARGIN = 4;
export const KEY_LO_MIN = 10;
/** design.md "Cut algorithm": the top of the key ramp. */
export const KEY_HI = 28;

function checkSize(width: number, height: number, where: string): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`${where}: bad size ${width}x${height}`);
  }
}

/** A fully transparent mask. */
export function emptyMask(width: number, height: number): Mask {
  checkSize(width, height, "emptyMask");
  return { width, height, data: new Uint8ClampedArray(width * height) };
}

/**
 * 1 where the pixel centre (col + 0.5, row + 0.5) has non-zero winding, else 0. An edge counts
 * on a row when the row's centre line lies in [min y, max y) of the edge; the pixel is inside
 * when the crossings at or left of its centre sum to non-zero (upward +1, downward -1).
 */
function fillNonZero(poly: Polygon, width: number, height: number): Uint8Array {
  const inside = new Uint8Array(width * height);
  const n = poly.length;
  if (n < 3) return inside;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of poly) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const rowFrom = Math.max(0, Math.floor(minY - 0.5));
  const rowTo = Math.min(height - 1, Math.ceil(maxY));
  const crossings: { x: number; dir: number }[] = [];
  for (let row = rowFrom; row <= rowTo; row++) {
    const py = row + 0.5;
    crossings.length = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i] ?? [0, 0];
      const [x1, y1] = poly[(i + 1) % n] ?? [0, 0];
      const dir = y0 <= py && py < y1 ? 1 : y1 <= py && py < y0 ? -1 : 0;
      if (dir !== 0) crossings.push({ x: x0 + ((py - y0) * (x1 - x0)) / (y1 - y0), dir });
    }
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let k = 0; k + 1 < crossings.length; k++) {
      winding += crossings[k]?.dir ?? 0;
      if (winding === 0) continue;
      // Columns whose centre c + 0.5 satisfies x_k <= c + 0.5 < x_{k+1}.
      const from = Math.max(0, Math.ceil((crossings[k]?.x ?? 0) - 0.5));
      const to = Math.min(width, Math.ceil((crossings[k + 1]?.x ?? 0) - 0.5));
      if (from < to) inside.fill(1, row * width + from, row * width + to);
    }
  }
  return inside;
}

/**
 * Squared distance transform along one line (Felzenszwalb and Huttenlocher), in place on `f`.
 * Infinite entries are not parabolas; a line with none finite stays infinite.
 */
function edt1d(f: Float64Array, v: Int32Array, z: Float64Array, out: Float64Array): void {
  const n = f.length;
  let k = -1;
  for (let q = 0; q < n; q++) {
    const fq = f[q] ?? Infinity;
    if (fq === Infinity) continue;
    let s = -Infinity;
    while (k >= 0) {
      const p = v[k] ?? 0;
      s = (fq + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
      if (s > (z[k] ?? -Infinity)) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = k === 0 ? -Infinity : s;
    z[k + 1] = Infinity;
  }
  if (k < 0) {
    out.fill(Infinity);
  } else {
    let j = 0;
    for (let q = 0; q < n; q++) {
      while ((z[j + 1] ?? Infinity) < q) j++;
      const p = v[j] ?? 0;
      out[q] = (q - p) * (q - p) + (f[p] ?? 0);
    }
  }
  f.set(out);
}

/**
 * Squared distance from each pixel of the window to the nearest pixel centre in the window
 * that is not inside. Pixels beyond the window (and so beyond the canvas) never count.
 */
function squaredDistances(inside: Uint8Array, width: number, x0: number, y0: number, w: number, h: number): Float64Array {
  const d = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) d[y * w + x] = inside[(y0 + y) * width + x0 + x] === 1 ? Infinity : 0;
  }
  const longest = Math.max(w, h);
  const v = new Int32Array(longest);
  const z = new Float64Array(longest + 1);
  const col = new Float64Array(h);
  const colOut = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = d[y * w + x] ?? 0;
    edt1d(col, v, z, colOut);
    for (let y = 0; y < h; y++) d[y * w + x] = col[y] ?? 0;
  }
  const rowOut = new Float64Array(w);
  for (let y = 0; y < h; y++) edt1d(d.subarray(y * w, y * w + w), v, z, rowOut);
  return d;
}

/**
 * Polygon (canvas px, [x, y]) -> alpha mask (requirement 4.1, ruling 3). Pixels whose centre is
 * outside the polygon (non-zero rule) are 0. Inside, alpha is 255 * d / feather, capped at 255,
 * where d is the distance to the nearest outside pixel centre on the canvas, so the opaque core
 * lies inside the polygon and the feather band is under `feather` px wide. The canvas edge is not
 * an outside: a part cut off by the frame stays opaque at the frame. `feather = 0` is a hard mask.
 */
export function rasterizeMask(poly: Polygon, width: number, height: number, feather: number): Mask {
  checkSize(width, height, "rasterizeMask");
  if (!Number.isFinite(feather) || feather < 0) throw new RangeError(`rasterizeMask: bad feather ${feather}`);
  const inside = fillNonZero(poly, width, height);
  const mask = emptyMask(width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] !== 1) continue;
    mask.data[i] = 255;
    const x = i % width;
    const y = (i - x) / width;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (maxX < 0 || feather === 0) return mask;
  const margin = Math.ceil(feather) + 1;
  const x0 = Math.max(0, minX - margin);
  const y0 = Math.max(0, minY - margin);
  const w = Math.min(width, maxX + margin + 1) - x0;
  const h = Math.min(height, maxY + margin + 1) - y0;
  const d2 = squaredDistances(inside, width, x0, y0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (y0 + y) * width + x0 + x;
      if (inside[at] !== 1) continue;
      const d = Math.sqrt(d2[y * w + x] ?? Infinity);
      // An inside centre is >= 1 px from any outside centre, so a partial pixel is never 0.
      if (d < feather) mask.data[at] = Math.max(1, Math.floor((255 * d) / feather));
    }
  }
  return mask;
}

/** Rec. 601 luma of an 8-bit RGB triple, 0..255. */
export const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Near-black ground -> transparent (requirement 4.2): luma <= lo -> 0, luma >= hi -> 255, linear
 * (rounded) between. Monotonic in luma. Alpha in the image is ignored; multiply it in separately.
 */
export function lumaKey(image: Rgba, lo: number, hi: number): Mask {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) throw new RangeError(`lumaKey: need lo < hi, got ${lo}, ${hi}`);
  const mask = emptyMask(image.width, image.height);
  const { data } = image;
  for (let i = 0; i < mask.data.length; i++) {
    const l = luma(data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0);
    mask.data[i] = l <= lo ? 0 : l >= hi ? 255 : Math.round((255 * (l - lo)) / (hi - lo));
  }
  return mask;
}

/**
 * Ruling 2: the key's `lo` for this portrait, from its four KEY_CORNER_PATCH px corner patches
 * (smaller on a smaller image): the brightest pixel luma there + KEY_LO_MARGIN, at least KEY_LO_MIN.
 */
export function cornerKeyLo(image: Rgba): number {
  checkSize(image.width, image.height, "cornerKeyLo");
  const pw = Math.min(KEY_CORNER_PATCH, image.width);
  const ph = Math.min(KEY_CORNER_PATCH, image.height);
  let brightest = 0;
  for (const [cx, cy] of [
    [0, 0],
    [image.width - pw, 0],
    [0, image.height - ph],
    [image.width - pw, image.height - ph],
  ] as const) {
    for (let y = cy; y < cy + ph; y++) {
      for (let x = cx; x < cx + pw; x++) {
        const i = (y * image.width + x) * 4;
        brightest = Math.max(brightest, luma(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0));
      }
    }
  }
  return Math.max(KEY_LO_MIN, brightest + KEY_LO_MARGIN);
}
