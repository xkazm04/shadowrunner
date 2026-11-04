// Shared frame math for both renderers (pure, no DOM): fitting the rig into the canvas, the affine
// map from a layer's rest canvas px to device px for its pose, the look's light values.
//
// Decisions the spec leaves open:
// - The rig is fitted into the drawing buffer whole (contain), centred, letterboxed.
// - A pose places a layer as rig-core documents (`LayerPose`): scale about the posed anchor (the
//   y-squash in the layer's own frame), then rotation about it.
// - Brow: no Rig v1 kind is a brow, so the emotion's brow offset moves the `eye` layers, the part
//   of the face a brow frames, by `BROW_STEP * rig.height` canvas px per step (rig-core ruling:
//   0.004 * height; positive raises). It is canvas-space and not inherited, like the jaw drop.
//   A rig with brow layers (`hasBrowLayers`, character-control "Moods") moves those in the pose
//   instead, so its eyes get no brow shift here.
import { hasBrowLayers, isEmissive, lookToEmotionDrive, type Layer, type LayerPose, type Look, type Rig } from "@sr/rig";

/** Brow offset per table step, as a fraction of rig height (rig-core ruling). */
export const BROW_STEP = 0.004;
/** Rim-light strength on `palette.rim` (design.md "Rendering"; character-control raises it to 0.6). */
export const RIM_STRENGTH = 0.6;

/** Device-px placement of rig canvas px: `device = scale * rig + offset`. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
  /** Drawing buffer size, device px. */
  width: number;
  height: number;
}

/** 2D affine `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f (canvas `setTransform` order). */
export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number];

/** The rig fitted whole into a `width` x `height` buffer, centred. Degenerate sizes give scale 0. */
export function fitView(rig: Pick<Rig, "width" | "height">, width: number, height: number): View {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const scale = rig.width > 0 && rig.height > 0 ? Math.min(w / rig.width, h / rig.height) : 0;
  return { scale, ox: (w - rig.width * scale) / 2, oy: (h - rig.height * scale) / 2, width: w, height: h };
}

/** Maps the layer's rest canvas px (its bbox) to device px for `pose`; `browY` shifts eye layers. */
export function layerAffine(layer: Layer, pose: LayerPose, view: View, browY: number): Affine {
  const [bx, by] = layer.bbox;
  const [ax, ay] = layer.anchor;
  const [sx, sy] = pose.scale;
  const cos = Math.cos(pose.rotation);
  const sin = Math.sin(pose.rotation);
  // Rest -> posed rig px: P(q) = A' + R S (q - A), A' = A + (x - bx, y - by) (+ brow for eyes).
  const a0 = cos * sx;
  const b0 = sin * sx;
  const c0 = -sin * sy;
  const d0 = cos * sy;
  const px = ax + pose.x - bx;
  const py = ay + pose.y - by + (layer.kind === "eye" ? browY : 0);
  const k = view.scale;
  return [k * a0, k * b0, k * c0, k * d0, k * (px - a0 * ax - c0 * ay) + view.ox, k * (py - b0 * ax - d0 * ay) + view.oy];
}

/** Applies an affine to a point. */
export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export type Rgb = [r: number, g: number, b: number];

/** "#rrggbb" -> linear 0..1 channels (as stored, no gamma); anything else is black. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) return [0, 0, 0];
  return [parseInt(m[1] ?? "0", 16) / 255, parseInt(m[2] ?? "0", 16) / 255, parseInt(m[3] ?? "0", 16) / 255];
}

/** The light a look sets: rim and glow colours, the eye multiplier (palette x eyeGain), the brow shift. */
export interface LookLight {
  rim: Rgb;
  /** The old eye multiply (palette x eyeGain), for an eye the look does not recolour. */
  eye: Rgb;
  /** The emotion's eye gain alone, applied after the eye light's recolour. */
  eyeGain: number;
  glow: Rgb;
  /** Canvas px added to eye layers' y; negative is up. */
  browY: number;
}

export function lookLight(rig: Pick<Rig, "height" | "layers">, look: Look): LookLight {
  const { eyeGain, brow } = lookToEmotionDrive(look.emotion);
  const [er, eg, eb] = hexToRgb(look.palette.eye);
  const [rr, rg, rb] = hexToRgb(look.palette.rim);
  return {
    rim: [rr * RIM_STRENGTH, rg * RIM_STRENGTH, rb * RIM_STRENGTH],
    eye: [er * eyeGain, eg * eyeGain, eb * eyeGain],
    eyeGain,
    glow: hexToRgb(look.palette.glow),
    browY: hasBrowLayers(rig) ? 0 : -brow * BROW_STEP * rig.height,
  };
}

/** The light left on a dimmed layer at full dim (`dim` 1): a hint of the face, not black. */
export const DIM_FLOOR = 0.12;
/** Dim level per second: a full dim takes about 1.25 s (the old CSS filter transition). */
export const DIM_RATE = 0.8;

/** Clamps a dim level to 0..1; absent or non-finite is 0 (no dim). */
export const clampDim = (dim: number | undefined): number => (dim === undefined || !Number.isFinite(dim) ? 0 : Math.min(1, Math.max(0, dim)));

/**
 * The eyes-only dim (stage "LINE DEAD"): the light gain of `layer` at `dim` 0..1. An emissive eye
 * keeps its light (1); every other layer falls toward DIM_FLOOR. At dim 0 every layer is 1, so
 * the default draw is untouched. Both renderers multiply a layer's gain by this.
 */
export function dimGain(layer: Pick<Layer, "kind" | "emissive">, dim: number | undefined): number {
  const d = clampDim(dim);
  return d === 0 || (layer.kind === "eye" && isEmissive(layer)) ? 1 : 1 - d * (1 - DIM_FLOOR);
}

/**
 * Pure: the shown dim one frame closer to `target` (both 0..1) at DIM_RATE per second, so it eases
 * like a CSS transition; under reduced motion it is the target at once.
 */
export function easeDim(shown: number, target: number, dt: number, reducedMotion: boolean): number {
  const to = clampDim(target);
  if (reducedMotion) return to;
  const step = Math.max(0, Number.isFinite(dt) ? dt : 0) * DIM_RATE;
  return shown < to ? Math.min(to, shown + step) : Math.max(to, shown - step);
}
