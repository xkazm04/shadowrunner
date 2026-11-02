// The background layer (forge-pipeline task 10, director ruling of 2026-11-01). Task 9 drew the
// whole plate, so a turned head showed a second, static copy of the head and crown at its old place.
// Now the plate is painted out (blurExtend from the surface around them) under every moving layer,
// and the rest view stays the same. Pure: arrays in, fresh images out.
import { type Bbox, type Cut, type CutPart, blendBy } from "./cut.js";
import { blurExtend } from "./fill.js";
import { type Mask, dilateMask, rasterizeMask } from "./mask.js";
import { asNamed, isKeyed } from "./named.js";
import { ROLE_KIND, toCanvas } from "./parts.js";
import type { NamedPart, Part, PartRole, Rgba } from "./types.js";

/** The painted area is the moving layers' solid area eroded by this many px. */
export const BACKGROUND_ERODE = 2;
/** Blur passes for the painted background: enough to melt the extension's streaks. */
export const BACKGROUND_BLUR_PASSES = 12;
/** A moving layer's pixel counts as solid from this alpha up. */
export const SOLID_ALPHA = 96;

/** A cut layer of either format: v1 `CutPart` or a named cut part. */
export type NamedLayer = Cut & { name: string };

export interface Background<L extends NamedLayer = CutPart> {
  /** The background layer's pixels. */
  background: Rgba;
  /** The layers, front to back as given; inside the painted area they are opaque (see below). */
  layers: L[];
}

/** The layer re-cropped to also cover `box` (new pixels transparent). */
function grown<L extends NamedLayer>(layer: L, box: Bbox): L {
  const [ax, ay, aw, ah] = layer.bbox;
  const x0 = Math.min(ax, box[0]);
  const y0 = Math.min(ay, box[1]);
  const w = Math.max(ax + aw, box[0] + box[2]) - x0;
  const h = Math.max(ay + ah, box[1] + box[3]) - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < ah; y++) data.set(layer.image.data.subarray(y * aw * 4, (y + 1) * aw * 4), ((ay - y0 + y) * w + ax - x0) * 4);
  return { ...layer, bbox: [x0, y0, w, h], image: { width: w, height: h, data } };
}

/**
 * Task 10. The solid area: every pixel where a moving layer (all but the torso) has alpha >=
 * SOLID_ALPHA, plus the whole polygon of a keyed moving part (crown, hair, accessory), whose dark
 * facets the luma key took out and which would otherwise stay behind as a static copy. Inside that
 * area eroded by BACKGROUND_ERODE px the background is `blurExtend`ed from the surface outside all
 * the moving layers; elsewhere it is the plate, so nothing the parts leave uncovered is black. The
 * rest view does not change: where a painted pixel has no opaque layer over it, the most solid
 * moving layer there (or the keyed part whose polygon holds it) is made opaque with the colour the
 * plate and the layers from the back up to it showed. `layers` are front to back (as `cutAll`
 * returns them); they are copied, never modified.
 */
export function backgroundOf<L extends NamedLayer>(plate: Rgba, layers: readonly L[], parts: readonly (Part | NamedPart)[]): Background<L> {
  const { width, height } = plate;
  const named = asNamed(parts);
  const roles = new Map<string, PartRole>();
  for (const part of named) if (!roles.has(part.name)) roles.set(part.name, part.role);
  const isMoving = (layer: L): boolean => {
    const role = roles.get(layer.name);
    return role === undefined ? layer.name !== "torso" : ROLE_KIND[role] !== "body";
  };
  const keyed = new Map<string, Mask>();
  for (const part of named) {
    if (!isKeyed(part) || keyed.has(part.name) || !layers.some((l) => l.name === part.name)) continue;
    keyed.set(part.name, rasterizeMask(toCanvas(part.poly, width, height), width, height, 0));
  }
  const out = layers.map((l): L => {
    const poly = keyed.get(l.name);
    const box = poly === undefined ? undefined : boxOf(poly);
    return box === undefined ? { ...l, image: { ...l.image, data: l.image.data.slice() } } : grown(l, box);
  });
  const alphaOf = (l: L, x: number, y: number): number => {
    const [bx, by, bw, bh] = l.bbox;
    return x < bx || y < by || x >= bx + bw || y >= by + bh ? 0 : (l.image.data[((y - by) * bw + x - bx) * 4 + 3] ?? 0);
  };

  const solid: Mask = { width, height, data: new Uint8ClampedArray(width * height) };
  const touched: Mask = { width, height, data: new Uint8ClampedArray(width * height) };
  for (const poly of keyed.values()) poly.data.forEach((a, i) => a !== 0 && (solid.data[i] = 255));
  for (const layer of out) {
    if (!isMoving(layer)) continue;
    const [bx, by, bw, bh] = layer.bbox;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const a = layer.image.data[(y * bw + x) * 4 + 3] ?? 0;
        if (a > 0) touched.data[(by + y) * width + bx + x] = 255;
        if (a >= SOLID_ALPHA) solid.data[(by + y) * width + bx + x] = 255;
      }
    }
  }
  for (let i = 0; i < solid.data.length; i++) if (solid.data[i] !== 0) touched.data[i] = 255;
  const near = dilateMask({ width, height, data: solid.data.map((a) => (a === 0 ? 255 : 0)) }, BACKGROUND_ERODE).data;
  const hole: Mask = { width, height, data: solid.data.map((a, i) => (a !== 0 && near[i] === 0 ? 255 : 0)) };

  for (let i = 0; i < hole.data.length; i++) {
    if (hole.data[i] === 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    const alphas = out.map((l) => alphaOf(l, x, y));
    if (alphas.includes(255)) continue;
    let pick = -1;
    out.forEach((l, k) => {
      if (!isMoving(l)) return;
      const better = pick < 0 || (alphas[k] ?? 0) > (alphas[pick] ?? 0);
      const holds = (alphas[k] ?? 0) > 0 || keyed.get(l.name)?.data[i] === 255;
      if (holds && better) pick = k;
    });
    const layer = out[pick];
    if (layer === undefined) continue;
    const c = [plate.data[i * 4] ?? 0, plate.data[i * 4 + 1] ?? 0, plate.data[i * 4 + 2] ?? 0];
    for (let k = out.length - 1; k >= pick; k--) {
      const l = out[k];
      const a = (alphas[k] ?? 0) / 255;
      if (l === undefined || a === 0) continue;
      const at = ((y - l.bbox[1]) * l.bbox[2] + x - l.bbox[0]) * 4;
      for (let ch = 0; ch < 3; ch++) c[ch] = (l.image.data[at + ch] ?? 0) * a + (c[ch] ?? 0) * (1 - a);
    }
    const at = ((y - layer.bbox[1]) * layer.bbox[2] + x - layer.bbox[0]) * 4;
    layer.image.data.set([Math.round(c[0] ?? 0), Math.round(c[1] ?? 0), Math.round(c[2] ?? 0), 255], at);
  }
  // Painted from the ground and torso around the moving layers, never from their own soft edges.
  const fill = blurExtend(plate, dilateMask(touched, BACKGROUND_ERODE), { passes: BACKGROUND_BLUR_PASSES });
  return { background: blendBy(plate, fill, hole), layers: out };
}

function boxOf(mask: Mask): Bbox | undefined {
  let x0 = mask.width;
  let y0 = mask.height;
  let x1 = -1;
  let y1 = -1;
  mask.data.forEach((a, i) => {
    if (a === 0) return;
    const x = i % mask.width;
    const y = (i - x) / mask.width;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  });
  return x1 < 0 ? undefined : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
