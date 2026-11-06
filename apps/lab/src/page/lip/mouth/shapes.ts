// The eight mouth shapes WP3's lip arms draw (L1 procedurally, L2 from forge art), the Oculus-15
// viseme -> shape grouping, and each shape's geometry and jaw opening. Pure data, no DOM, so the
// Node mouth generator (src/mouths) reads the same list.
import type { Viseme } from "../../../contract.js";

export const MOUTH_SHAPES = ["rest", "openWide", "openMid", "round", "closed", "teeth", "tongue", "narrow"] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

/** Oculus 15 -> mouth shape (sil is rest; PBM close the lips; FV bite; L/TH/D/N show the tongue). */
export const VISEME_SHAPE: Readonly<Record<Viseme, MouthShape>> = {
  sil: "rest",
  PP: "closed",
  FF: "teeth",
  TH: "tongue",
  DD: "tongue",
  kk: "openMid",
  CH: "narrow",
  SS: "narrow",
  nn: "tongue",
  RR: "round",
  aa: "openWide",
  E: "openMid",
  ih: "narrow",
  oh: "round",
  ou: "round",
};

/**
 * A mouth's geometry, every value 0..1 except `width` (a multiple of the rest mouth's width).
 * Shapes blend by mixing these linearly, so every in-between is a valid mouth.
 */
export interface MouthParams {
  width: number;
  /** Inner opening, a fraction of the largest the arm draws. */
  open: number;
  /** Pucker: rounder corners, fuller lips. */
  round: number;
  /** Upper teeth showing. */
  teeth: number;
  /** Tongue showing. */
  tongue: number;
  /** Lips pressed together (the closed PBM line). */
  press: number;
  /** Jaw opening handed to the player (setLevel), before the driver's floor. */
  jaw: number;
  // Emotion (mouth/emotion.ts adds them per expression family; every viseme shape has them at 0).
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

/** One weight per shape, summing to 1. */
export type ShapeWeights = Record<MouthShape, number>;

export function restWeights(): ShapeWeights {
  return { rest: 1, openWide: 0, openMid: 0, round: 0, closed: 0, teeth: 0, tongue: 0, narrow: 0 };
}

/** The weighted mix of the shapes' params (weights need not be normalised; zero total is rest). */
export function blendParams(weights: Partial<ShapeWeights>): MouthParams {
  const out: MouthParams = { width: 0, open: 0, round: 0, teeth: 0, tongue: 0, press: 0, jaw: 0, ...CALM };
  let total = 0;
  for (const shape of MOUTH_SHAPES) {
    const w = weights[shape] ?? 0;
    if (!(w > 0)) continue;
    total += w;
    const p = SHAPE_PARAMS[shape];
    for (const key of Object.keys(out) as (keyof MouthParams)[]) out[key] += w * p[key];
  }
  if (!(total > 0)) return { ...SHAPE_PARAMS.rest };
  for (const key of Object.keys(out) as (keyof MouthParams)[]) out[key] /= total;
  return out;
}

/** The heaviest shape (ties go to the earlier in MOUTH_SHAPES). */
export function dominant(weights: ShapeWeights): MouthShape {
  let best: MouthShape = "rest";
  for (const shape of MOUTH_SHAPES) if (weights[shape] > weights[best]) best = shape;
  return best;
}
