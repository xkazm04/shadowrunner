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
import { lookToEmotionDrive, type Layer, type LayerPose, type Look, type Rig } from "@sr/rig";

/** Brow offset per table step, as a fraction of rig height (rig-core ruling). */
export const BROW_STEP = 0.004;
/** Rim-light strength on `palette.rim` (design.md "Rendering"). */
export const RIM_STRENGTH = 0.35;

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
  eye: Rgb;
  glow: Rgb;
  /** Canvas px added to eye layers' y; negative is up. */
  browY: number;
}

export function lookLight(rig: Pick<Rig, "height">, look: Look): LookLight {
  const { eyeGain, brow } = lookToEmotionDrive(look.emotion);
  const [er, eg, eb] = hexToRgb(look.palette.eye);
  const [rr, rg, rb] = hexToRgb(look.palette.rim);
  return {
    rim: [rr * RIM_STRENGTH, rg * RIM_STRENGTH, rb * RIM_STRENGTH],
    eye: [er * eyeGain, eg * eyeGain, eb * eyeGain],
    glow: hexToRgb(look.palette.glow),
    browY: -brow * BROW_STEP * rig.height,
  };
}
