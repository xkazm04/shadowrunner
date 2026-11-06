// The iris's clip by its eye's socket (face-control, WP-A): the math both renderers share. Pure,
// no DOM: the map from the iris's rest canvas px to its eye's socket-mask uv, the crossfade of the
// eye's sockets by the face weights, the mask sample, and the socket's half extents (`SocketBox`).
//
// Decisions the brief leaves open:
// - The mask is the eye's `socket` (an alpha PNG at the eye's bbox), crossfaded with each shown
//   face's patch `socket` by that face's weight (as posed: expression.strength included); a face
//   without a socket of its own lends the eye's. Weights over 1 in total are scaled down to 1.
// - The mask is placed by the eye's pose exactly as the eye's art is (its squash included, never a
//   brow shift: a socketed eye takes none), so the lids close over the iris as the eye squints.
// - Outside the mask's rectangle the mask is 0, so the iris is never drawn outside the socket's box,
//   and inside it the iris's alpha is multiplied by the mask's (bilinear on canvas2D as on GL).
// - The half extents are those of the mask's alpha box (alpha >= SOCKET_ALPHA), in the eye's rest
//   canvas px (scaled from the mask's pixels to the eye's bbox).
import type { Layer, LayerPose, SocketBox } from "@sr/rig";
import { layerAffine, type Affine, type View } from "./frame.js";

/** A mask pixel counts as socket from this alpha (0..255) up, for the half extents. */
export const SOCKET_ALPHA = 128;

const UNIT_VIEW: View = { scale: 1, ox: 0, oy: 0, width: 1, height: 1 };

/** The inverse of an affine; undefined when it is singular. */
export function invertAffine(m: Affine): Affine | undefined {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12) || !Number.isFinite(det)) return undefined;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** outer . inner. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [p, q, r, s, t, u] = inner;
  return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * t + c * u + e, b * t + d * u + f];
}

/**
 * The iris's rest canvas px -> its eye's socket-mask uv (0..1 over the eye's bbox), for these poses.
 * Undefined when the eye is posed degenerate (a zero scale), where nothing of it shows.
 */
export function irisMaskMap(iris: Layer, irisPose: LayerPose, eye: Layer, eyePose: LayerPose): Affine | undefined {
  const toCanvas = layerAffine(iris, irisPose, UNIT_VIEW, 0);
  const fromEye = invertAffine(layerAffine(eye, eyePose, UNIT_VIEW, 0));
  if (fromEye === undefined) return undefined;
  const [bx, by, bw, bh] = eye.bbox;
  if (!(bw > 0 && bh > 0)) return undefined;
  const toUv: Affine = [1 / bw, 0, 0, 1 / bh, -bx / bw, -by / bh];
  return composeAffine(toUv, composeAffine(fromEye, toCanvas));
}

/** The masks to blend for the eye's pose: its socket and its shown faces' sockets, by weight. */
export function socketWeights(eye: Layer, eyePose: Pick<LayerPose, "faces">): { file: string; weight: number }[] {
  const base = eye.socket;
  if (base === undefined) return [];
  const faces = (eyePose.faces ?? []).map((face) => ({ file: eye.variants?.[face.family]?.socket ?? base, weight: Math.max(0, Math.min(1, face.weight)) }));
  const total = faces.reduce((sum, face) => sum + face.weight, 0);
  const k = total > 1 ? 1 / total : 1;
  const out = new Map<string, number>([[base, Math.max(0, 1 - total * k)]]);
  for (const face of faces) out.set(face.file, (out.get(face.file) ?? 0) + face.weight * k);
  return [...out].filter(([, weight]) => weight > 0).map(([file, weight]) => ({ file, weight }));
}

/** A mask's alpha channel, 0..255, row-major. */
export interface MaskAlpha {
  w: number;
  h: number;
  alpha: Uint8Array | Uint8ClampedArray;
}

/** The alpha channel of straight RGBA pixels. */
export function alphaOf(w: number, h: number, rgba: ArrayLike<number>): MaskAlpha {
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) alpha[i] = rgba[i * 4 + 3] ?? 0;
  return { w, h, alpha };
}

/** The mask at uv (0..1 over the mask), 0..1: bilinear on texel centres, edges clamped, 0 outside [0, 1]. */
export function maskAt(mask: MaskAlpha, u: number, v: number): number {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
  const x = Math.min(mask.w - 1, Math.max(0, u * mask.w - 0.5));
  const y = Math.min(mask.h - 1, Math.max(0, v * mask.h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(mask.w - 1, x0 + 1);
  const y1 = Math.min(mask.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xi: number, yi: number): number => (mask.alpha[yi * mask.w + xi] ?? 0) / 255;
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** The half extents of the mask's alpha box (alpha >= SOCKET_ALPHA) at an eye bbox of `bw` x `bh`; undefined when empty. */
export function socketBoxOf(mask: MaskAlpha, bw: number, bh: number): SocketBox | undefined {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < mask.h; y += 1) {
    for (let x = 0; x < mask.w; x += 1) {
      if ((mask.alpha[y * mask.w + x] ?? 0) < SOCKET_ALPHA) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + 1);
    }
  }
  if (!(x1 > x0 && y1 > y0)) return undefined;
  return { hx: ((x1 - x0) / 2) * (bw / mask.w), hy: ((y1 - y0) / 2) * (bh / mask.h) };
}
