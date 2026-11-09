// Character control in the pose (.kiro/specs/character-control/design.md "Moods", "Reshape"): the
// pure per-layer pieces poseLayers composes - brow layers, faces, the reshape about the anchor.
// Pure, no DOM.
//
// Decisions the spec leaves open (documented here so the renderer and creator agree):
// - Brow side: the design tilts "the left brow" by `-browLift * 600` degrees and the right one the
//   opposite, "an angry V when negative". Rig names say the character's side (Reveille's `brow_l`
//   sits on screen right), and on the y-down canvas a positive (clockwise) turn lowers a part's
//   right end. So the side is read from the art, not the name: a brow whose bbox centre lies left
//   of the brows' mean centre is the screen-left brow and turns by `-browLift * 600` (its inner,
//   right end goes down when browLift < 0), a screen-right brow by the opposite. A rig with a
//   single brow layer lifts it and does not tilt it.
// - Faces: when the outgoing and incoming families are the same (amused -> delighted, both joy) the
//   one family is listed once with weight 1, so a crossfade between two moods of one family never
//   dims its face; zero weights are dropped, and an empty list is omitted.
// - Retired faces (retire-a-face): a family in `retired` adds no weight, exactly as if the layer had
//   no variant for it, so procedural motion carries that mood; other families keep their weights.
import { moodDrive, smoothstep, type EmotionDrive } from "./look.js";
import { EMOTION_FAMILY, clampShape } from "./control.js";
import type { LayerPose } from "./pose.js";
import type { ExpressionFamily, Layer, Look, PartShape, RetiredFaces, Rig } from "./types.js";

/** design.md: the inner end turns by `-browLift * BROW_TILT_DEG_PER_LIFT` degrees on the left brow. */
export const BROW_TILT_DEG_PER_LIFT = 600;

const BROW_NAME = /^brow(_|$)/;

/** Whether `layer` is a brow layer (Reveille's `brow_l`, `brow_r`; any name `brow` or `brow_*`). */
export const isBrowLayer = (layer: Pick<Layer, "name">): boolean => BROW_NAME.test(layer.name);

/**
 * Whether the rig has brow layers. When it does, the mood's `browLift` moves them and the
 * renderer must NOT also shift the eyes by the emotion's `brow` steps (`BROW_STEP`).
 */
export const hasBrowLayers = (rig: Pick<Rig, "layers">): boolean => rig.layers.some(isBrowLayer);

/** The mood held this frame, for `look.emotion` and the drive's crossfade. */
export const moodOf = (look: Pick<Look, "emotion">, mood: { from: Look["emotion"]; mix: number } | undefined): EmotionDrive => moodDrive(look.emotion, mood);

export interface BrowPose {
  /** Canvas px in the parent's frame; negative is up. */
  liftY: number;
  /** Degrees, clockwise on screen, about the brow's anchor. */
  tiltDeg: number;
}

const NO_BROWS: ReadonlyMap<string, BrowPose> = new Map();

/** Per brow layer, its lift and tilt for `browLift` (fraction of rig height, positive raises); one shared empty map at 0. */
export function browPoses(rig: Rig, browLift: number): ReadonlyMap<string, BrowPose> {
  if (browLift === 0) return NO_BROWS;
  const out = new Map<string, BrowPose>();
  const brows = rig.layers.filter(isBrowLayer);
  const centre = (layer: Layer): number => layer.bbox[0] + layer.bbox[2] / 2;
  const mid = brows.reduce((sum, layer) => sum + centre(layer), 0) / Math.max(1, brows.length);
  const tilt = -browLift * BROW_TILT_DEG_PER_LIFT;
  for (const layer of brows) {
    const side = brows.length < 2 ? 0 : Math.sign(mid - centre(layer));
    out.set(layer.name, { liftY: -browLift * rig.height, tiltDeg: side * tilt + 0 });
  }
  return out;
}

/** design.md "Faces": the layer's face weights, or undefined when it shows only its base. A `retired` family adds none. */
export function facesOf(layer: Layer, look: Pick<Look, "emotion">, mood: { from: Look["emotion"]; mix: number } | undefined, retired?: RetiredFaces): LayerPose["faces"] {
  const variants = layer.variants;
  if (variants === undefined) return undefined;
  const fb = EMOTION_FAMILY[look.emotion];
  const fa = mood === undefined ? fb : EMOTION_FAMILY[mood.from];
  const m = mood === undefined ? 1 : smoothstep(mood.mix);
  const weights = new Map<ExpressionFamily, number>();
  const add = (family: ExpressionFamily | null, weight: number): void => {
    if (family === null || variants[family] === undefined || weight <= 0 || retired?.[family] === "procedural") return;
    weights.set(family, (weights.get(family) ?? 0) + weight);
  };
  add(fa, 1 - m);
  add(fb, m);
  if (weights.size === 0) return undefined;
  return [...weights].map(([family, weight]) => ({ family, weight }));
}

/** The look's reshape of `layer`, clamped (`clampShape`), or undefined when it has none. */
export function shapeOf(look: Pick<Look, "shape">, layer: Pick<Layer, "name">): PartShape | undefined {
  const raw = look.shape;
  if (raw === undefined || !Object.hasOwn(raw, layer.name)) return undefined;
  const value: unknown = raw[layer.name];
  if (typeof value !== "object" || value === null) return undefined;
  return clampShape(value);
}
