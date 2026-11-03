// Character control (.kiro/specs/character-control/design.md): the expression families the ten
// emotions share, the reshape limits, and the small pure helpers the rig, renderer, forge and
// creator all use. Constants here are the contract; behaviour lives in pose.ts and look.ts.
import type { Emotion, ExpressionFamily, PartShape } from "./types.js";

export const EXPRESSION_FAMILIES: readonly ExpressionFamily[] = Object.freeze(["joy", "showman", "anger", "gloom", "smug", "suspicion"]);

/** design.md "Wire types": neutral is the base art. */
export const EMOTION_FAMILY: Readonly<Record<Emotion, ExpressionFamily | null>> = Object.freeze({
  neutral: null,
  amused: "joy",
  delighted: "joy",
  theatrical: "showman",
  irritated: "anger",
  furious: "anger",
  bored: "gloom",
  grim: "gloom",
  smug: "smug",
  suspicious: "suspicion",
});

/** Inclusive [min, max] per field; dx and dy are fractions of the rig's width, rot degrees. */
export const SHAPE_LIMITS: Readonly<Record<keyof PartShape, readonly [number, number]>> = Object.freeze({
  size: [0.6, 1.6],
  sx: [0.6, 1.6],
  sy: [0.6, 1.6],
  dx: [-0.15, 0.15],
  dy: [-0.15, 0.15],
  rot: [-25, 25],
});

export const IDENTITY_SHAPE: Readonly<PartShape> = Object.freeze({ size: 1, sx: 1, sy: 1, dx: 0, dy: 0, rot: 0 });

export const MAX_REGION_SLOTS = 4;

/** Seconds an emotion change takes to crossfade (instant under reduced motion). */
export const MOOD_FADE_S = 0.25;

const SHAPE_KEYS = Object.keys(IDENTITY_SHAPE) as (keyof PartShape)[];

/** A full shape from a partial one: missing or non-finite fields from IDENTITY_SHAPE, each clamped. */
export function clampShape(value: Partial<PartShape>): PartShape {
  const out = { ...IDENTITY_SHAPE };
  for (const key of SHAPE_KEYS) {
    const v = value[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const [min, max] = SHAPE_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, v));
  }
  return out;
}

export function isIdentityShape(shape: PartShape): boolean {
  return SHAPE_KEYS.every((key) => shape[key] === IDENTITY_SHAPE[key]);
}

/** The `Look.regions` key of a layer's slot. */
export const regionKey = (layer: string, slot: string): string => `${layer}/${slot}`;
