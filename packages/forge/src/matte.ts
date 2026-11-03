// The plate matte (cast-forge task 5, Reveille: neon rings and clock hands on a lit dial). A lifted
// part is cut as an opaque polygon; on a light surface that polygon carries a patch of the surface
// with it, which a pulse then brightens (a glowing disc round a neon eye) and a turn slides over the
// plate (a cream lozenge round a clock hand). With `matte: "plate"` the part keeps only what differs
// from the fill plate painted behind it: alpha from the largest channel difference (none up to
// MATTE_LO, full from MATTE_HI), colour un-mixed against the plate, so at rest the part over the
// plate is the portrait again (exact wherever the un-mixed colour stays in 0..255). Pure.
import type { Rgba } from "./types.js";

/** Largest channel difference (0..255) at or below which a pixel is the surface: the edit's or the extension's noise. */
export const MATTE_LO = 18;
/** Largest channel difference from which a pixel is wholly the part's. */
export const MATTE_HI = 56;

/** 0..1 from the largest channel difference between portrait and plate. */
export function matteAlpha(difference: number): number {
  return Math.min(1, Math.max(0, (difference - MATTE_LO) / (MATTE_HI - MATTE_LO)));
}

/**
 * Keys a part's cut mask `m` (0..255, changed in place) against `plate` and returns the colours to
 * cut the part from: `m` times `matteAlpha`, and where it is above 0 the colour
 * `plate + (portrait - plate) * 255 / m`, clamped, so the part composited over the plate gives back
 * the portrait. Pixels the part keeps nothing of are the portrait's.
 */
export function matteToPlate(portrait: Rgba, plate: Rgba, m: Uint8ClampedArray): Rgba {
  const data = portrait.data.slice();
  for (let i = 0; i < m.length; i++) {
    const own = m[i] ?? 0;
    if (own === 0) continue;
    let difference = 0;
    for (let c = 0; c < 3; c++) difference = Math.max(difference, Math.abs((portrait.data[i * 4 + c] ?? 0) - (plate.data[i * 4 + c] ?? 0)));
    const alpha = Math.round(own * matteAlpha(difference));
    m[i] = alpha;
    if (alpha === 0) continue;
    for (let c = 0; c < 3; c++) {
      const under = plate.data[i * 4 + c] ?? 0;
      data[i * 4 + c] = under + (((portrait.data[i * 4 + c] ?? 0) - under) * 255) / alpha;
    }
  }
  return { width: portrait.width, height: portrait.height, data };
}
