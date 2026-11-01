// The filled plate (forge-pipeline task 9, director rulings of 2026-11-01 on the 1.2 composites).
// The plate is the portrait with the parts that move (FILL_PARTS) painted out. It equals the
// portrait everywhere except inside the lifted region grown by PLATE_DILATE px, where the fill
// (the Gemini edit, or the pure `blurExtend` fallback) is blended in over PLATE_FEATHER px. So a
// fill edit that redraws more than it was asked to (the Announcer's void face came back as a skull)
// cannot reach the rest of the face: drift is cut off by construction. Pure: arrays in, images out.
import { CUT_FEATHER, PLATE_DILATE, blendBy } from "./cut.js";
import { blurExtend } from "./fill.js";
import { type Mask, dilateMask, featherMask } from "./mask.js";
import type { Rgba } from "./types.js";

/** Width of the blend from the portrait to the fill at the edge of the grown region, px. */
export const PLATE_FEATHER = 6;

function sameSize(a: { width: number; height: number }, b: { width: number; height: number }, where: string): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError(`${where}: size ${b.width}x${b.height} does not match ${a.width}x${a.height}`);
  }
}

/**
 * How much of the fill the plate takes per pixel: 0 outside `lifted` grown by PLATE_DILATE px,
 * rising to 255 over PLATE_FEATHER px inward from that edge, 255 deeper in.
 */
export function plateWeight(lifted: Mask): Mask {
  return featherMask(dilateMask(lifted, PLATE_DILATE), PLATE_FEATHER);
}

/**
 * The plate: `portrait` where `plateWeight(lifted)` is 0 (bit for bit), `fill` where it is 255,
 * and a linear blend of all four channels between. `lifted` is `liftedRegion(parts, w, h)`.
 */
export function composePlate(portrait: Rgba, fill: Rgba, lifted: Mask): Rgba {
  sameSize(portrait, fill, "composePlate fill");
  sameSize(portrait, lifted, "composePlate lifted");
  return blendBy(portrait, fill, plateWeight(lifted));
}

/** Masked blur passes of the fallback fill: enough to melt the ring-by-ring streaks of a large hole. */
export const FALLBACK_BLUR_PASSES = 24;

/**
 * The pure fill (requirement 5.3): `blurExtend` over the lifted region grown past the cut feather,
 * so the hole's border is surface just outside the moving parts, not their own soft edge.
 */
export function fallbackFill(portrait: Rgba, lifted: Mask): Rgba {
  sameSize(portrait, lifted, "fallbackFill lifted");
  return blurExtend(portrait, dilateMask(lifted, CUT_FEATHER), { passes: FALLBACK_BLUR_PASSES });
}
