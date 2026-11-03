// Glass pick (character-control design "Creator UI"): which part, and which colour region of it, is
// under a point on the glass, and the outline of that region traced from its pixels. Pure, no DOM:
// the images arrive as RGBA pixel arrays (pixels.ts decodes them).
//
// Decisions the spec leaves open:
// - The face is posed at rest for the pick (`REST_DRIVE`, the look's own shapes applied): the
//   driver's breath and drift move it a few px, which a click does not need to chase.
// - The pose is inverted here from `LayerPose` as rig-core defines it (scale, then rotation, about
//   the posed anchor), not through the renderer, so the pick does not depend on its internals.
// - Static layers (the backdrop) are never picked: a click beside the character selects nothing.
// - Outlines are traced on a grid of at most `TRACE_CELLS` cells per side (a 1024 px layer is
//   traced every 4 px), merged into runs, so the path stays small; it is an outline, not a mask.
import { poseLayers, type Drive, type Layer, type LayerPose, type Look, type Rig } from "@sr/rig";
import type { Point } from "./pins";

/** An image's pixels: RGBA, row-major, `width * height * 4` bytes. */
export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** The decoded image of a file (Layer.file, a region map), when it is ready. */
export type PixelsOf = (file: string) => Pixels | undefined;

/** A pixel at or above this alpha belongs to its layer. */
export const PICK_ALPHA = 128;
/** The most grid cells a traced outline has per side. */
export const TRACE_CELLS = 256;

/** The face at rest, still: what the pick inverts. */
export const REST_DRIVE: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, still: true };

/** 2D affine `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number];

export const applyAffine = (m: Affine, [x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** `m` after `n`: x -> m(n(x)). */
export const compose = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export function invert(m: Affine): Affine | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  const [a, b, c, d, e, f] = [m[0] / det, m[1] / det, m[2] / det, m[3] / det, m[4], m[5]];
  return [d, -b, -c, a, c * f - d * e, b * e - a * f];
}

/** A layer's rest canvas px -> its posed canvas px: P = A' + R S (q - A), A' = A + (x - bx, y - by). */
export function poseAffine(layer: Layer, pose: LayerPose): Affine {
  const [bx, by] = layer.bbox;
  const [ax, ay] = layer.anchor;
  const [sx, sy] = pose.scale;
  const cos = Math.cos(pose.rotation);
  const sin = Math.sin(pose.rotation);
  const [a, b, c, d] = [cos * sx, sin * sx, -sin * sy, cos * sy];
  const px = ax + pose.x - bx;
  const py = ay + pose.y - by;
  return [a, b, c, d, px - a * ax - c * ay, py - b * ax - d * ay];
}

/** Image px of a `width` x `height` image drawn over the layer's bbox -> rest canvas px. */
export const imageAffine = (layer: Layer, width: number, height: number): Affine => [
  layer.bbox[2] / Math.max(1, width),
  0,
  0,
  layer.bbox[3] / Math.max(1, height),
  layer.bbox[0],
  layer.bbox[1],
];

/** Rig px -> percent of the square glass (pins.ts `toGlass` as an affine). */
export function glassAffine(rig: Pick<Rig, "width" | "height">): Affine {
  const side = Math.max(rig.width, rig.height, 1);
  const k = 100 / side;
  return [k, 0, 0, k, ((side - rig.width) / 2) * k, ((side - rig.height) / 2) * k];
}

const at = (img: Pixels, x: number, y: number, channel: number): number => img.data[(y * img.width + x) * 4 + channel] ?? 0;

/** The region slot index + 1 (0 none) at image px (x, y) of `layer`, read from its map. */
function regionAt(layer: Layer, image: Pixels, map: Pixels, x: number, y: number): number {
  const mx = Math.min(map.width - 1, Math.floor(((x + 0.5) * map.width) / image.width));
  const my = Math.min(map.height - 1, Math.floor(((y + 0.5) * map.height) / image.height));
  const v = at(map, mx, my, 0);
  return v >= 1 && v <= (layer.regions?.slots.length ?? 0) ? v : 0;
}

export interface Picked {
  layer: string;
  /** The region slot id under the point, when the layer has regions and its map is read. */
  slot?: string;
}

/** The poses `pickAt` inverts: the look's visible layers at rest. */
export const restPoses = (rig: Rig, look: Look): LayerPose[] => poseLayers(rig, look, REST_DRIVE);

/**
 * The topmost visible, non-static layer whose image alpha under `point` (rig px) is at least
 * `PICK_ALPHA`, and its region slot there. Layers whose image is not decoded yet are passed over.
 */
export function pickAt(rig: Rig, poses: readonly LayerPose[], point: Point, pixelsOf: PixelsOf): Picked | undefined {
  const byName = new Map(rig.layers.map((l) => [l.name, l]));
  for (let i = poses.length - 1; i >= 0; i -= 1) {
    const pose = poses[i];
    const layer = pose === undefined ? undefined : byName.get(pose.name);
    if (pose === undefined || layer === undefined || layer.kind === "static") continue;
    const image = pixelsOf(layer.file);
    const inverse = invert(compose(poseAffine(layer, pose), imageAffine(layer, image?.width ?? 1, image?.height ?? 1)));
    if (image === undefined || inverse === undefined) continue;
    const [fx, fy] = applyAffine(inverse, point);
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height || at(image, x, y, 3) < PICK_ALPHA) continue;
    const map = layer.regions === undefined ? undefined : pixelsOf(layer.regions.map);
    const index = map === undefined ? 0 : regionAt(layer, image, map, x, y);
    const slot = index === 0 ? undefined : layer.regions?.slots[index - 1]?.id;
    return slot === undefined ? { layer: layer.name } : { layer: layer.name, slot };
  }
  return undefined;
}

/**
 * The outline of the cells of a `width` x `height` grid for which `inside` holds, as an SVG path
 * in px of that grid scaled by `cell` (each boundary edge once, runs merged). Empty when none is.
 */
export function traceMask(width: number, height: number, inside: (x: number, y: number) => boolean, cell = 1): string {
  const cols = Math.max(0, Math.ceil(width / cell));
  const rows = Math.max(0, Math.ceil(height / cell));
  const hit = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < cols && cy < rows && inside(Math.min(width - 1, Math.floor((cx + 0.5) * cell)), Math.min(height - 1, Math.floor((cy + 0.5) * cell)));
  const grid: boolean[] = [];
  for (let cy = 0; cy < rows; cy += 1) for (let cx = 0; cx < cols; cx += 1) grid.push(hit(cx, cy));
  const on = (cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < cols && cy < rows && grid[cy * cols + cx] === true;
  const parts: string[] = [];
  const n = (v: number): string => String(Math.round(v * cell * 100) / 100);
  // Horizontal edges: between row y - 1 and row y.
  for (let y = 0; y <= rows; y += 1) {
    let start = -1;
    for (let x = 0; x <= cols; x += 1) {
      const edge = x < cols && on(x, y - 1) !== on(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        parts.push(`M${n(start)} ${n(y)}H${n(x)}`);
        start = -1;
      }
    }
  }
  // Vertical edges: between column x - 1 and column x.
  for (let x = 0; x <= cols; x += 1) {
    let start = -1;
    for (let y = 0; y <= rows; y += 1) {
      const edge = y < rows && on(x - 1, y) !== on(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        parts.push(`M${n(x)} ${n(start)}V${n(y)}`);
        start = -1;
      }
    }
  }
  return parts.join("");
}

export interface Outline {
  /** In image px of the traced image. */
  d: string;
  /** The traced image's size (the layer image, or its region map). */
  width: number;
  height: number;
}

/**
 * The outline of a picked region (its map's pixels equal to the slot's index + 1), or of the
 * layer's opaque pixels when no slot is named. Undefined while the image it needs is not decoded.
 */
export function outlineOf(layer: Layer, slot: string | undefined, pixelsOf: PixelsOf): Outline | undefined {
  const index = slot === undefined ? -1 : (layer.regions?.slots.findIndex((s) => s.id === slot) ?? -1);
  const image = index >= 0 && layer.regions !== undefined ? pixelsOf(layer.regions.map) : pixelsOf(layer.file);
  if (image === undefined) return undefined;
  const inside = index >= 0 ? (x: number, y: number) => at(image, x, y, 0) === index + 1 : (x: number, y: number) => at(image, x, y, 3) >= PICK_ALPHA;
  const cell = Math.max(1, Math.ceil(Math.max(image.width, image.height) / TRACE_CELLS));
  return { d: traceMask(image.width, image.height, inside, cell), width: image.width, height: image.height };
}

/** The SVG `matrix(...)` placing an outline of `layer` (image px) on the glass (percent), posed. */
export function outlineMatrix(rig: Rig, layer: Layer, pose: LayerPose, outline: Pick<Outline, "width" | "height">): string {
  const m = compose(glassAffine(rig), compose(poseAffine(layer, pose), imageAffine(layer, outline.width, outline.height)));
  return `matrix(${m.map((v) => Math.round(v * 1e5) / 1e5).join(" ")})`;
}
