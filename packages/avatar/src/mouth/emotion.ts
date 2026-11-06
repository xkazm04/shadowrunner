// The emotion the drawn mouth carries (the rig owns the mouth: the expression art keeps neutral lips,
// so the drawn mouth smiles, snarls, smirks or sulks itself). One bias per expression family
// (@sr/rig EMOTION_FAMILY), ADDED to the blended viseme params every frame: talking through a smile
// keeps the corners up, and a PBM closure still closes (what would open the lips is scaled by
// 1 - press). A change of emotion eases over EMOTION_EASE_MS (smoothstep); the reduced-motion twin
// switches at once. Pure, no DOM.
import { EMOTION_FAMILY, type Emotion, type ExpressionFamily } from "@sr/rig";
import type { MouthParams } from "./shapes.js";

/** The params an emotion moves, as deltas on the viseme mix. */
export type EmotionBias = Readonly<Pick<MouthParams, "width" | "open" | "teeth" | "jaw" | "smile" | "snarl" | "skew" | "tight">>;

export const NO_BIAS: EmotionBias = { width: 0, open: 0, teeth: 0, jaw: 0, smile: 0, snarl: 0, skew: 0, tight: 0 };

export const EMOTION_BIAS: Readonly<Record<ExpressionFamily, EmotionBias>> = {
  joy: { ...NO_BIAS, width: 0.1, smile: 0.85 },
  // Showman: wider, a little open (a stage smile showing the upper teeth), corners up.
  showman: { ...NO_BIAS, width: 0.18, open: 0.3, teeth: 0.5, jaw: 0.14, smile: 0.55 },
  anger: { ...NO_BIAS, width: 0.06, teeth: 0.4, smile: -0.3, snarl: 0.85, tight: 0.25 },
  gloom: { ...NO_BIAS, width: -0.06, smile: -0.8, tight: 0.15 },
  smug: { ...NO_BIAS, width: -0.02, smile: 0.2, skew: 0.85 },
  suspicion: { ...NO_BIAS, width: -0.14, skew: -0.2, tight: 0.85 },
};

export const EMOTION_EASE_MS = 250;

const KEYS = Object.keys(NO_BIAS) as (keyof EmotionBias)[];
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smoothstep = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** The bias a family asks for (null = neutral = none). */
export const biasOf = (family: ExpressionFamily | null): EmotionBias => (family === null ? NO_BIAS : EMOTION_BIAS[family]);

/** `p` with the emotion added, in place; anything that would part the lips yields to `press`. */
export function applyBiasInto(p: MouthParams, b: EmotionBias): MouthParams {
  const keep = 1 - clamp(p.press, 0, 1);
  p.width = Math.max(0.3, p.width + b.width);
  p.open = clamp(p.open + b.open * keep, 0, 1);
  p.teeth = clamp(p.teeth + b.teeth, 0, 1);
  p.jaw = clamp(p.jaw + b.jaw * keep, 0, 1);
  p.smile = clamp(p.smile + b.smile, -1, 1);
  p.snarl = clamp(p.snarl + b.snarl * (1 - 0.7 * (1 - keep)), 0, 1);
  p.skew = clamp(p.skew + b.skew, -1, 1);
  p.tight = clamp(p.tight + b.tight, 0, 1);
  return p;
}

/** The viseme params with the emotion added (a new object). */
export const applyBias = (p: MouthParams, b: EmotionBias): MouthParams => applyBiasInto({ ...p }, b);

export interface EmotionState {
  bias: EmotionBias;
  /** 0..1: how far from neutral the mouth is (how much the drawn mouth must show at rest). */
  strength: number;
}

export interface EmotionEase {
  /** The character's emotion changed at `nowMs` (any monotonic ms clock). */
  set(emotion: Emotion, nowMs: number): void;
  at(nowMs: number): EmotionState;
  /** True while the target is a non-neutral family. */
  readonly expressive: boolean;
}

/** `reducedMotion` may be read live (the player's "auto" follows the viewer's setting every frame). */
export function createEmotionEase(reducedMotion: boolean | (() => boolean), easeMs = EMOTION_EASE_MS): EmotionEase {
  const reduced = typeof reducedMotion === "function" ? reducedMotion : () => reducedMotion;
  let from: EmotionState = { bias: NO_BIAS, strength: 0 };
  let to: EmotionState = from;
  let startMs = 0;
  const at = (nowMs: number): EmotionState => {
    const s = reduced() || !(easeMs > 0) ? 1 : smoothstep((nowMs - startMs) / easeMs);
    if (s >= 1) return to;
    const bias: Record<keyof EmotionBias, number> = { ...NO_BIAS };
    for (const k of KEYS) bias[k] = from.bias[k] + (to.bias[k] - from.bias[k]) * s;
    return { bias, strength: from.strength + (to.strength - from.strength) * s };
  };
  return {
    set(emotion, nowMs) {
      const family = EMOTION_FAMILY[emotion] ?? null;
      from = at(nowMs);
      to = { bias: biasOf(family), strength: family === null ? 0 : 1 };
      startMs = nowMs;
    },
    at,
    get expressive() {
      return to.strength > 0;
    },
  };
}
