// Palette sampling (forge-pipeline requirement 6.3): the rig's colours come from the portrait.
// The eye is the brightest saturated colour inside the eye polygons; glow, rim and mouth are
// derived from it. Pure: an image and parts in, four "#rrggbb" strings out.
import type { Palette } from "@sr/rig";
import { rasterizeMask } from "./mask.js";
import { toCanvas } from "./parts.js";
import type { Part, PartName, Rgba } from "./types.js";

/** A pixel is a light candidate when its HSV saturation and value reach these (0..1). */
export const SATURATION_MIN = 0.35;
export const VALUE_MIN = 0.25;
/** The eye colour is the mean of this share of the candidates, brightest first (at least one pixel). */
export const TOP_SHARE = 0.05;

/** Where the light is looked for, in order; the first region holding a candidate wins. */
const REGIONS: readonly (readonly PartName[])[] = [["eye_l", "eye_r"], ["head"]];

type Rgb = [r: number, g: number, b: number];

export interface Hsv {
  /** Hue in degrees, 0 <= h < 360 (0 for greys). */
  h: number;
  /** Saturation, 0..1. */
  s: number;
  /** Value (brightest channel / 255), 0..1. */
  v: number;
}

/** 8-bit RGB -> HSV. */
export function hsv([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  let h = 0;
  if (span > 0) {
    if (max === r) h = ((g - b) / span) * 60;
    else if (max === g) h = ((b - r) / span + 2) * 60;
    else h = ((r - g) / span + 4) * 60;
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : span / max, v: max / 255 };
}

/** HSV -> 8-bit RGB, rounded. */
function rgb({ h, s, v }: Hsv): Rgb {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

const hex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * The palette for an eye light. eye = the light; rim = the light too (the line core, as in
 * Malakor's own colours); glow = the same hue, a third of the way to full saturation and at 85%
 * of the value (a deeper halo); mouth = the same hue at value 0.15 and saturation at least 0.5
 * (a dark, tinted mouth interior).
 */
function derive(light: Rgb): Palette {
  const { h, s, v } = hsv(light);
  const eye = hex(light);
  return {
    glow: hex(rgb({ h, s: s + (1 - s) / 3, v: v * 0.85 })),
    eye,
    rim: eye,
    mouth: hex(rgb({ h, s: Math.max(s, 0.5), v: 0.15 })),
  };
}

/** Used when the portrait has no saturated light where one is looked for: Malakor's orange eye. */
export const FALLBACK_PALETTE: Palette = Object.freeze(derive([255, 158, 56]));

/** The mean of the brightest candidates among `pixels`, or undefined when none is a candidate. */
function brightest(portrait: Rgba, pixels: readonly number[]): Rgb | undefined {
  const lights: { i: number; s: number; v: number }[] = [];
  for (const i of pixels) {
    const { s, v } = hsv([portrait.data[i * 4] ?? 0, portrait.data[i * 4 + 1] ?? 0, portrait.data[i * 4 + 2] ?? 0]);
    if (s >= SATURATION_MIN && v >= VALUE_MIN) lights.push({ i, s, v });
  }
  if (lights.length === 0) return undefined;
  lights.sort((a, b) => b.v - a.v || b.s - a.s || a.i - b.i);
  const top = lights.slice(0, Math.max(1, Math.ceil(lights.length * TOP_SHARE)));
  const mean = (c: number): number => Math.round(top.reduce((sum, { i }) => sum + (portrait.data[i * 4 + c] ?? 0), 0) / top.length);
  return [mean(0), mean(1), mean(2)];
}

/**
 * Portrait + parts -> palette (requirement 6.3). Candidates are pixels whose centre lies inside
 * the eye polygons (eye_l, eye_r; non-zero rule) with HSV saturation >= SATURATION_MIN and value
 * >= VALUE_MIN. They are ranked by value, then saturation, and the eye colour is the mean of the
 * top TOP_SHARE of them. With no candidate in the eyes the head polygon is searched the same way,
 * and with none there either the result is FALLBACK_PALETTE. Glow, rim and mouth are derived from
 * the eye colour (see `derive`). Every value is lower-case "#rrggbb".
 */
export function samplePalette(portrait: Rgba, parts: readonly Part[]): Palette {
  const { width, height } = portrait;
  for (const names of REGIONS) {
    const pixels = new Set<number>();
    for (const part of parts) {
      if (!names.includes(part.name)) continue;
      rasterizeMask(toCanvas(part.poly, width, height), width, height, 0).data.forEach((a, i) => {
        if (a !== 0) pixels.add(i);
      });
    }
    const light = brightest(portrait, [...pixels].sort((a, b) => a - b));
    if (light !== undefined) return derive(light);
  }
  return { ...FALLBACK_PALETTE };
}
