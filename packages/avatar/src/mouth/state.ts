// The drawn mouth's per-mount state, one step per frame (player/frame.ts runs it for a rig with
// `mouth`). It picks the shape mix (a caller's visemes, `setMouthShapes`, or else the speech level:
// `levelWeights`, a mid-open mouth), adds the emotion's bias (eased over EMOTION_EASE_MS, instant
// under reduced motion), and returns what the renderer draws plus the driver level that opens the
// jaw to match. At neutral rest it returns no pose: the art is untouched and nothing is drawn.
//
// Reduced motion (the twin): with the level drive the mouth does not follow the level; while the
// level says speech it eases (REDUCED_EASE_MS) to one soft half-open shape and back after. A caller's
// mix is taken as given (the caller owns its own twin). An emotion change switches at once.
//
// Hot path: the mixes and params are reused objects; nothing is allocated per frame at steady state.
import type { Emotion } from "@sr/rig";
import { JAW_FLOOR } from "../driver/state.js";
import { applyBiasInto, createEmotionEase, EMOTION_EASE_MS, NO_BIAS, type EmotionBias } from "./emotion.js";
import { blendInto, coverOf, jawLevel, levelWeights, MOUTH_SHAPES, restWeights, SHAPE_PARAMS, totalOf, type MouthParams, type ShapeWeights } from "./shapes.js";

export const REDUCED_EASE_MS = 150;

/** A caller's mouth: the shape mix it wants shown (visemes), see `AvatarPlayer.setMouthShapes`. */
export interface MouthShapesInput {
  /** The mix shown: it sets the cover (how much of the art's mouth the drawn one replaces). */
  shapes: ShapeWeights;
  /** The mix the jaw opens for (default `shapes`), e.g. read a little ahead of the shown one. */
  jaw?: ShapeWeights;
  /**
   * The part of `shapes` the player draws (default all of it). Its total weight is the share of
   * the lips drawn; the rest the caller draws itself over the player (the lab's forge art, L2).
   */
  drawn?: Partial<ShapeWeights>;
}

/** What the renderer draws this frame (read-only for callers; reused between frames). */
export interface MouthPose {
  /** The drawn lips' params, emotion included. */
  readonly params: Readonly<MouthParams>;
  /** 0..1: how much of the art's mouth the drawn one replaces (the cover's strength). */
  readonly alpha: number;
  /** 0..1 share of `alpha` the lips are drawn at (1 unless a caller draws part of the mix). */
  readonly lips: number;
}

export interface MouthStepInputs {
  emotion: Emotion;
  /** The speech level 0..1 (setLevel or the audio tap). */
  level: number;
  /** A caller's mix; absent = the level drive. */
  input?: MouthShapesInput;
  reducedMotion: boolean;
  /** Seconds since the previous frame. */
  dt: number;
  /** The face profile's mouth.emotion (face-control), 0..1.5: the emotion bias's multiplier. Omitted = 1. */
  emotionStrength?: number;
}

export interface MouthStep {
  /** Undefined at neutral rest: draw nothing. */
  pose: MouthPose | undefined;
  /** The driver level that opens the jaw for this mouth. */
  level: number;
}

export function createMouthState(): (inputs: MouthStepInputs) => MouthStep {
  let reduced = false;
  const ease = createEmotionEase(() => reduced);
  let emotion: Emotion | undefined;
  let ms = 0;
  let soft = 0;
  const levelMix = restWeights();
  const params: MouthParams = { ...SHAPE_PARAMS.rest };
  const jawParams: MouthParams = { ...SHAPE_PARAMS.rest };
  const pose = { params, alpha: 0, lips: 1 };
  const out: MouthStep = { pose: undefined, level: 0 };

  return (p) => {
    reduced = p.reducedMotion;
    const dtMs = Number.isFinite(p.dt) ? Math.max(0, p.dt) * 1000 : 0;
    ms += dtMs;
    if (emotion === undefined) ease.set(p.emotion, ms - EMOTION_EASE_MS);
    else if (p.emotion !== emotion) ease.set(p.emotion, ms);
    emotion = p.emotion;
    const eased = ease.at(ms);
    const { strength } = eased;
    const bias = scaleBias(eased.bias, p.emotionStrength ?? 1);

    let talk: number;
    let shown: ShapeWeights;
    if (p.input !== undefined) {
      shown = p.input.shapes;
      talk = coverOf(shown);
    } else if (p.reducedMotion) {
      const target = p.level > JAW_FLOOR ? 1 : 0;
      soft += (target - soft) * (1 - Math.exp(-dtMs / REDUCED_EASE_MS));
      for (const shape of MOUTH_SHAPES) levelMix[shape] = 0;
      levelMix.openMid = 0.5 * soft;
      levelMix.rest = 1 - levelMix.openMid;
      shown = levelMix;
      talk = Math.min(1, soft * 2);
    } else {
      shown = levelWeights(p.level, levelMix);
      talk = coverOf(shown);
    }

    const jawMix = p.input?.jaw ?? shown;
    out.level = jawLevel(withBias(blendInto(jawMix, jawParams), bias).jaw);

    const alpha = Math.max(talk, strength);
    if (!(alpha > 0.001)) {
      out.pose = undefined;
      return out;
    }
    const drawn = p.input?.drawn;
    withBias(blendInto(drawn ?? shown, params), bias);
    pose.alpha = alpha;
    pose.lips = drawn === undefined ? 1 : Math.min(1, totalOf(drawn));
    out.pose = pose;
    return out;
  };
}

const withBias = (p: MouthParams, bias: EmotionBias): MouthParams => (bias === NO_BIAS ? p : applyBiasInto(p, bias));

/** The bias times `k` (face-control mouth.emotion); the same object at 1 (or a non-finite k). */
function scaleBias(bias: EmotionBias, k: number): EmotionBias {
  if (k === 1 || !Number.isFinite(k) || bias === NO_BIAS) return bias;
  const out: Record<keyof EmotionBias, number> = { ...NO_BIAS };
  for (const key of Object.keys(NO_BIAS) as (keyof EmotionBias)[]) out[key] = bias[key] * Math.max(0, k);
  return out;
}
