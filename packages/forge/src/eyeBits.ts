// Bit masks for the eye anatomy (face-control, WP-B; eyes.ts): 0/1 pixel sets of one eye image,
// their components, holes and row/column spans, the largest disc inside one, the median colour of a
// set, and the conversion to and from the alpha-mask images the rig stores. Pure.
import type { Rgba } from "./types.js";

export type Bits = Uint8Array;

/** A disc in image px (centre and radius), pixel centres at +0.5. */
export interface Disc {
  cx: number;
  cy: number;
  r: number;
}

/** Alpha from which a pixel belongs to the eye. */
export const EYE_OPAQUE = 200;

export const opaqueAt = (img: Rgba, i: number): boolean => (img.data[i * 4 + 3] ?? 0) >= EYE_OPAQUE;

/** RGBA of pixel i. */
export const px = (img: Rgba, i: number): [number, number, number, number] => [img.data[i * 4] ?? 0, img.data[i * 4 + 1] ?? 0, img.data[i * 4 + 2] ?? 0, img.data[i * 4 + 3] ?? 0];

/** 4-connected components of `bits`; returns the component label per pixel (0 = none) and each label's size. */
function label(bits: Bits, w: number, h: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const stack: number[] = [];
  for (let s = 0; s < bits.length; s++) {
    if (bits[s] === 0 || labels[s] !== 0) continue;
    const id = sizes.length;
    sizes.push(0);
    labels[s] = id;
    stack.push(s);
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      sizes[id] = (sizes[id] ?? 0) + 1;
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (bits[n] !== 0 && labels[n] === 0) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
  }
  return { labels, sizes };
}

/** Only the largest component of `bits` (or the one under `seed`, when it has one). */
export function keepComponent(bits: Bits, w: number, h: number, seed?: (i: number) => boolean): Bits {
  const { labels, sizes } = label(bits, w, h);
  let best = 0;
  if (seed !== undefined) {
    const score = new Array<number>(sizes.length).fill(0);
    for (let i = 0; i < labels.length; i++) if ((labels[i] ?? 0) > 0 && seed(i)) score[labels[i] ?? 0] = (score[labels[i] ?? 0] ?? 0) + 1;
    for (let id = 1; id < sizes.length; id++) if ((score[id] ?? 0) > (score[best] ?? 0)) best = id;
  }
  if (best === 0) for (let id = 1; id < sizes.length; id++) if ((sizes[id] ?? 0) > (sizes[best] ?? 0)) best = id;
  const out = new Uint8Array(bits.length);
  if (best > 0) for (let i = 0; i < labels.length; i++) if (labels[i] === best) out[i] = 1;
  return out;
}

/** `bits` with every enclosed hole filled (4-connected background not reaching the frame). */
export function fillHoles(bits: Bits, w: number, h: number): Bits {
  const outside = new Uint8Array(bits.length);
  const stack: number[] = [];
  const push = (i: number) => {
    if (bits[i] === 0 && outside[i] === 0) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop() ?? 0;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return outside.map((o) => (o === 1 ? 0 : 1));
}

/** Every row span and then every column span of `bits` filled: an eye opening is convex along rows and columns. */
export function spanFill(bits: Bits, w: number, h: number): Bits {
  const out = bits.slice();
  for (let y = 0; y < h; y++) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < w; x++) if (out[y * w + x] !== 0) {
      a = a < 0 ? x : a;
      b = x;
    }
    for (let x = a; a >= 0 && x <= b; x++) out[y * w + x] = 1;
  }
  for (let x = 0; x < w; x++) {
    let a = -1;
    let b = -1;
    for (let y = 0; y < h; y++) if (out[y * w + x] !== 0) {
      a = a < 0 ? y : a;
      b = y;
    }
    for (let y = a; a >= 0 && y <= b; y++) out[y * w + x] = 1;
  }
  return out;
}

/** The largest disc inside `bits` (exact distance to the nearest unset pixel or the frame); ties averaged. */
export function inscribedDisc(bits: Bits, w: number, h: number): Disc | undefined {
  const border: [number, number][] = [];
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      const inside = x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x] !== 0;
      if (inside) continue;
      const touches = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a = 0, b = 0]) => a >= 0 && b >= 0 && a < w && b < h && bits[b * w + a] !== 0);
      if (touches) border.push([x, y]);
    }
  }
  let best = 0;
  const at: [number, number][] = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    let d = Infinity;
    for (const [bx, by] of border) d = Math.min(d, (bx - x) ** 2 + (by - y) ** 2);
    d = Math.sqrt(d) - 0.5;
    if (d > best + 0.25) {
      best = d;
      at.length = 0;
    }
    if (d >= best - 0.25) at.push([x, y]);
  }
  if (at.length === 0) return undefined;
  const cx = at.reduce((s, [x]) => s + x, 0) / at.length + 0.5;
  const cy = at.reduce((s, [, y]) => s + y, 0) / at.length + 0.5;
  return { cx, cy, r: best };
}

/** The median colour of the opaque pixels `pick` selects, or undefined when none. */
export function medianColour(eye: Rgba, pick: (i: number) => boolean): [number, number, number] | undefined {
  const ch: [number[], number[], number[]] = [[], [], []];
  for (let i = 0; i < eye.width * eye.height; i++) {
    if (!opaqueAt(eye, i) || !pick(i)) continue;
    const [r, g, b] = px(eye, i);
    ch[0].push(r);
    ch[1].push(g);
    ch[2].push(b);
  }
  if (ch[0].length === 0) return undefined;
  const mid = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
  return [mid(ch[0]), mid(ch[1]), mid(ch[2])];
}

/** 0/1 bits as a white image with alpha 255 where set. */
export function bitsToImage(bits: Bits, width: number, height: number): Rgba {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = bits[i] === 0 ? 0 : 255;
  return { width, height, data };
}

/** An alpha mask image back to 0/1 bits (alpha >= 128). */
export const imageToBits = (mask: Rgba): Bits => {
  const out = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < out.length; i++) out[i] = (mask.data[i * 4 + 3] ?? 0) >= 128 ? 1 : 0;
  return out;
};

/** `bits` grown by `k` px (4-neighbour steps). */
export function growBits(bits: Bits, w: number, h: number, k: number): Bits {
  let out = bits;
  for (let step = 0; step < k; step++) {
    const from = out;
    out = from.map((v, i) => {
      if (v === 1) return 1;
      const x = i % w;
      return (x > 0 && from[i - 1] === 1) || (x < w - 1 && from[i + 1] === 1) || (i >= w && from[i - w] === 1) || (i + w < from.length && from[i + w] === 1) ? 1 : 0;
    });
  }
  return out;
}
