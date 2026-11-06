// The drawn mouth's eight shapes (spark llm-avatar-lab: "the rig owns the mouth"), each shape's
// geometry and jaw opening, and the mixes the player blends: a caller with visemes hands the player
// a weight per shape (`setMouthShapes`); without one the speech level opens a mid mouth
// (`levelWeights`). Pure data, no DOM.
import { JAW_FLOOR } from "../driver/state.js";

export const MOUTH_SHAPES = ["rest", "openWide", "openMid", "round", "closed", "teeth", "tongue", "narrow"] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

/**
 * A mouth's geometry, every value 0..1 except `width` (a multiple of the rest mouth's width).
 * Shapes blend by mixing these linearly, so every in-between is a valid mouth.
 */
export interface MouthParams {
  width: number;
  /** Inner opening, a fraction of the largest the mouth draws. */
  open: number;
  /** Pucker: rounder corners, fuller lips. */
  round: number;
  /** Upper teeth showing. */
  teeth: number;
  /** Tongue showing. */
  tongue: number;
  /** Lips pressed together (the closed PBM line). */
  press: number;
  /** Jaw opening 0..1 (the player turns it into the driver's level, `jawLevel`). */
  jaw: number;
  // Emotion (mouth/emotion.ts adds them per expression family; every shape has them at 0).
  /** -1..1 corner lift: joy up, gloom down. */
  smile: number;
  /** 0..1 upper lip raised, upper teeth bared (anger). */
  snarl: number;
  /** -1..1 one-sided smirk: the right corner (viewer's) lifts for +, the left for -. */
  skew: number;
  /** 0..1 thinner, pressed lips (suspicion). */
  tight: number;
}

const CALM = { smile: 0, snarl: 0, skew: 0, tight: 0 } as const;

export const SHAPE_PARAMS: Readonly<Record<MouthShape, MouthParams>> = {
  rest: { width: 1, open: 0, round: 0, teeth: 0, tongue: 0, press: 0, jaw: 0, ...CALM },
  openWide: { width: 1, open: 1, round: 0.1, teeth: 0.35, tongue: 0.35, press: 0, jaw: 0.9, ...CALM },
  openMid: { width: 0.95, open: 0.55, round: 0.1, teeth: 0.45, tongue: 0.2, press: 0, jaw: 0.5, ...CALM },
  round: { width: 0.55, open: 0.45, round: 1, teeth: 0, tongue: 0.1, press: 0, jaw: 0.4, ...CALM },
  closed: { width: 0.92, open: 0, round: 0, teeth: 0, tongue: 0, press: 1, jaw: 0, ...CALM },
  teeth: { width: 0.9, open: 0.2, round: 0, teeth: 1, tongue: 0, press: 0, jaw: 0.12, ...CALM },
  tongue: { width: 0.9, open: 0.4, round: 0.1, teeth: 0.6, tongue: 1, press: 0, jaw: 0.35, ...CALM },
  narrow: { width: 1.08, open: 0.22, round: 0, teeth: 0.85, tongue: 0, press: 0, jaw: 0.18, ...CALM },
};

/** One weight per shape (a full mix sums to 1). */
export type ShapeWeights = Record<MouthShape, number>;

export const PARAM_KEYS = Object.keys(SHAPE_PARAMS.rest) as readonly (keyof MouthParams)[];

export function restWeights(): ShapeWeights {
  return { rest: 1, openWide: 0, openMid: 0, round: 0, closed: 0, teeth: 0, tongue: 0, narrow: 0 };
}

/** The total weight of a mix (non-positive and non-finite weights count 0). */
export function totalOf(weights: Partial<ShapeWeights>): number {
  let total = 0;
  for (const shape of MOUTH_SHAPES) {
    const w = weights[shape] ?? 0;
    if (w > 0) total += w;
  }
  return total;
}

/** The weighted mix of the shapes' params into `out` (weights need not be normalised; zero total is rest). */
export function blendInto(weights: Partial<ShapeWeights>, out: MouthParams): MouthParams {
  for (const key of PARAM_KEYS) out[key] = 0;
  const total = totalOf(weights);
  for (const shape of MOUTH_SHAPES) {
    const w = weights[shape] ?? 0;
    if (!(w > 0)) continue;
    const p = SHAPE_PARAMS[shape];
    for (const key of PARAM_KEYS) out[key] += (w / total) * p[key];
  }
  if (!(total > 0)) Object.assign(out, SHAPE_PARAMS.rest);
  return out;
}

/** `blendInto` on a fresh object. */
export const blendParams = (weights: Partial<ShapeWeights>): MouthParams => blendInto(weights, { ...SHAPE_PARAMS.rest });

/** The heaviest shape (ties go to the earlier in MOUTH_SHAPES). */
export function dominant(weights: ShapeWeights): MouthShape {
  let best: MouthShape = "rest";
  for (const shape of MOUTH_SHAPES) if (weights[shape] > weights[best]) best = shape;
  return best;
}

/** How far the speech level opens the mouth (0..1): the share of openMid in `levelWeights`. */
export const levelOpen = (level: number): number => Math.min(1, Math.max(0, (level - JAW_FLOOR) * 2.5));

/** Level -> a mid-open mouth (the product's drive: it has the speech level, no visemes). */
export function levelWeights(level: number, out: ShapeWeights = restWeights()): ShapeWeights {
  for (const shape of MOUTH_SHAPES) out[shape] = 0;
  const open = levelOpen(level);
  out.openMid = open;
  out.rest = 1 - open;
  return out;
}

/** Driver level for a jaw opening 0..1: the driver maps level to jaw above its floor. */
export const jawLevel = (jaw: number): number => (jaw > 0.005 ? JAW_FLOOR + Math.min(1, jaw) * (1 - JAW_FLOOR) : 0);

/** How strongly the drawn mouth covers the art for a mix: full by the time rest is half gone. */
export const coverOf = (weights: Partial<ShapeWeights>): number => {
  const total = totalOf(weights);
  const rest = total > 0 ? Math.max(0, weights.rest ?? 0) / total : 1;
  return Math.min(1, Math.max(0, (1 - rest) * 2));
};
