// Glow orbs and region sockets (cast-face-pass): the pieces for eyes with no paintable iris. A
// carved hole, a void, a visor slit or a pixel lens has no iris to cut, so its iris layer is a
// procedural orb (`orbArt`: a radial glow in the eye's own light colour, `lightColour`, or a given
// one), and its socket may be a given region (`discBits`, `ellipseBits`: a lens interior, a carved
// triangle's inscribed shape) rather than the 14 px eye box the cut left. `widenEye` grows an eye
// layer to such a region (the lens around a pixel pupil), its pixels the composite of everything up
// to the eye. Pure: numbers and images in, fresh images out. Coordinates are eye-local px, centres at +0.5.
import type { Layer, Rig } from "@sr/rig";
import { compositeRig } from "./composite.js";
import { EYE_OPAQUE, medianColour, type Bits } from "./eyeBits.js";
import { luma } from "./mask.js";
import type { IrisArt } from "./eyeArt.js";
import type { Iris } from "./eyes.js";
import type { Rgba } from "./types.js";

/** An orb's fully lit core (share of its radius) and its edge feather (px past the radius). */
export const ORB_CORE = 0.35;
export const ORB_FEATHER = 1.5;
/** How far the core whitens toward white (0: the light's colour, 1: white). */
export const ORB_HOT = 0.45;
/** `lightColour` takes the median of this brightest share of the eye's pixels. */
export const LIGHT_SHARE = 0.1;

export interface OrbStyle {
  /** The light's colour, [r, g, b] 0..255. */
  rgb: readonly [number, number, number];
  /** Fully lit core, share of the radius (default ORB_CORE). */
  core?: number;
  /** Core whitening, 0..1 (default ORB_HOT). */
  hot?: number;
  /** Pixel art: the orb is drawn in square cells of this size (px), hard-edged, no feather. */
  cell?: number;
}

/**
 * A glow orb for the iris layer at `iris` (eye-local): inside the core the light whitened by `hot`,
 * then the light's colour fading out to the radius (alpha (1 - t)^1.5 over the ring, t 0..1 from the
 * core to the radius; the box keeps ORB_FEATHER px of margin). With `cell`, each cell takes the value at its centre, alpha cut at 0.5 (hard pixels).
 * The box is eye-local like `irisImage`'s; the anchor (the iris centre) is the caller's.
 */
export function orbArt(iris: Iris, style: OrbStyle): IrisArt {
  const core = Math.max(0, Math.min(1, style.core ?? ORB_CORE));
  const hot = Math.max(0, Math.min(1, style.hot ?? ORB_HOT));
  const pad = style.cell === undefined ? ORB_FEATHER : 0;
  const x0 = Math.floor(iris.cx - iris.r - pad);
  const y0 = Math.floor(iris.cy - iris.r - pad);
  const bw = Math.ceil(iris.cx + iris.r + pad) - x0;
  const bh = Math.ceil(iris.cy + iris.r + pad) - y0;
  const data = new Uint8ClampedArray(bw * bh * 4);
  const shade = (d: number): [number, number] => {
    const t = d <= core * iris.r ? 0 : Math.min(1, (d - core * iris.r) / Math.max(1e-6, (1 - core) * iris.r));
    return [t, d >= iris.r ? 0 : (1 - t) ** 1.5];
  };
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let px = x0 + x + 0.5;
      let py = y0 + y + 0.5;
      if (style.cell !== undefined) {
        // The cell's centre, on the cell grid through the iris centre.
        px = iris.cx + (Math.floor((px - iris.cx) / style.cell + 0.5)) * style.cell;
        py = iris.cy + (Math.floor((py - iris.cy) / style.cell + 0.5)) * style.cell;
      }
      const [t, a0] = shade(Math.hypot(px - iris.cx, py - iris.cy));
      const a = style.cell === undefined ? a0 : a0 >= 0.25 ? 1 : 0;
      if (a === 0) continue;
      const w = hot * (1 - t);
      const o = (y * bw + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round((style.rgb[c] ?? 0) * (1 - w) + 255 * w);
      data[o + 3] = Math.round(255 * a);
    }
  }
  return { image: { width: bw, height: bh, data }, box: [x0, y0, bw, bh] };
}

/** An eye's own light: the median colour of its brightest LIGHT_SHARE opaque pixels (inside `within`, when given). */
export function lightColour(eye: Rgba, within?: Bits): [number, number, number] | undefined {
  const n = eye.width * eye.height;
  const lit = (i: number) => (eye.data[i * 4 + 3] ?? 0) >= EYE_OPAQUE && (within === undefined || within[i] === 1);
  const lumas: number[] = [];
  for (let i = 0; i < n; i++) if (lit(i)) lumas.push(luma(eye.data[i * 4] ?? 0, eye.data[i * 4 + 1] ?? 0, eye.data[i * 4 + 2] ?? 0));
  if (lumas.length === 0) return undefined;
  lumas.sort((a, b) => b - a);
  const floor = lumas[Math.max(0, Math.ceil(lumas.length * LIGHT_SHARE) - 1)] ?? 0;
  return medianColour(eye, (i) => lit(i) && luma(eye.data[i * 4] ?? 0, eye.data[i * 4 + 1] ?? 0, eye.data[i * 4 + 2] ?? 0) >= floor);
}

/** 0/1 bits of a `w` x `h` image set inside the ellipse at (cx, cy) with radii rx, ry (pixel centres). */
export function ellipseBits(w: number, h: number, cx: number, cy: number, rx: number, ry: number): Bits {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1 ? 1 : 0;
  return out;
}

/** 0/1 bits of a `w` x `h` image set inside the disc. */
export const discBits = (w: number, h: number, disc: Iris): Bits => ellipseBits(w, h, disc.cx, disc.cy, disc.r, disc.r);

/**
 * `rig` with eye layer `name` grown to `bbox` (canvas px, integers): its new image is the composite
 * of every layer up to and including the eye, cropped to `bbox`, opaque where `mask` (bbox-local
 * bits) is set and transparent elsewhere; the anchor keeps its canvas place. `images` gets the new
 * file under the eye's file name. Throws when the rig has no such eye layer.
 */
export function widenEye(rig: Rig, images: Readonly<Record<string, Rgba>>, name: string, bbox: Layer["bbox"], mask: Bits): { rig: Rig; images: Record<string, Rgba> } {
  const eye = rig.layers.find((l) => l.name === name && l.kind === "eye");
  if (eye === undefined) throw new RangeError(`widenEye: no eye layer ${name}`);
  const [x0, y0, w, h] = bbox.map((v) => Math.round(v)) as [number, number, number, number];
  const below = compositeRig({ ...rig, layers: rig.layers.filter((l) => l.z <= eye.z) }, images);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x0 + x;
      const cy = y0 + y;
      if (mask[y * w + x] !== 1 || cx < 0 || cy < 0 || cx >= below.width || cy >= below.height) continue;
      const s = (cy * below.width + cx) * 4;
      const o = (y * w + x) * 4;
      data.set([below.data[s] ?? 0, below.data[s + 1] ?? 0, below.data[s + 2] ?? 0, 255], o);
    }
  }
  const layers = rig.layers.map((l) => (l === eye ? { ...l, bbox: [x0, y0, w, h] as Layer["bbox"] } : l));
  return { rig: { ...rig, layers }, images: { ...images, [eye.file]: { width: w, height: h, data } } };
}
