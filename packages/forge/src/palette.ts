// Palette sampling (forge-pipeline requirement 6.3; task 5 ruling (b)): the rig's colours come
// from the portrait, never from a fixed table. The eye is the brightest saturated colour inside
// the eye polygons; when the eyes hold none, the head region's dominant saturated hue is used and
// a `palette_fallback` warning says so. Glow, rim and mouth are derived from the eye colour.
// Pure: an image and parts in, four "#rrggbb" strings and any warnings out.
import type { Palette } from "@sr/rig";
import { rasterizeMask } from "./mask.js";
import { toCanvas } from "./parts.js";
import type { Part, PartName, Rgba } from "./types.js";

/** A pixel is a light candidate when its HSV saturation and value reach these (0..1). */
export const SATURATION_MIN = 0.35;
export const VALUE_MIN = 0.25;
/** The eye colour is the mean of this share of the candidates, brightest first (at least one pixel). */
export const TOP_SHARE = 0.05;
/** The dominant hue is the fullest of this many equal hue bins (10 degrees each). */
export const HUE_BINS = 36;
/** Ruling (b): the fallback eye light is the dominant hue at this saturation and value. */
export const FALLBACK_SATURATION = 0.7;
export const FALLBACK_VALUE = 1;

const EYES: readonly PartName[] = ["eye_l", "eye_r"];

type Rgb = [r: number, g: number, b: number];

export interface Hsv {
  /** Hue in degrees, 0 <= h < 360 (0 for greys). */
  h: number;
  /** Saturation, 0..1. */
  s: number;
  /** Value (brightest channel / 255), 0..1. */
  v: number;
}

export interface PaletteWarning {
  code: "palette_fallback";
  message: string;
}

export interface SampledPalette {
  palette: Palette;
  /** Empty when the eye colour came from the eyes. */
  warnings: PaletteWarning[];
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
 * (a dark, tinted mouth interior), or a dark grey when the light is grey.
 */
function derive(light: Rgb): Palette {
  const { h, s, v } = hsv(light);
  const eye = hex(light);
  return {
    glow: hex(rgb({ h, s: s + (1 - s) / 3, v: v * 0.85 })),
    eye,
    rim: eye,
    mouth: hex(rgb({ h, s: s === 0 ? 0 : Math.max(s, 0.5), v: 0.15 })),
  };
}

const pixelHsv = (portrait: Rgba, i: number): Hsv =>
  hsv([portrait.data[i * 4] ?? 0, portrait.data[i * 4 + 1] ?? 0, portrait.data[i * 4 + 2] ?? 0]);

const isCandidate = ({ s, v }: Hsv): boolean => s >= SATURATION_MIN && v >= VALUE_MIN;

/** The mean colour of the brightest TOP_SHARE of `pixels` that pass `keep`, or undefined when none does. */
function brightest(portrait: Rgba, pixels: readonly number[], keep: (c: Hsv) => boolean): Rgb | undefined {
  const lights: { i: number; s: number; v: number }[] = [];
  for (const i of pixels) {
    const c = pixelHsv(portrait, i);
    if (keep(c)) lights.push({ i, s: c.s, v: c.v });
  }
  if (lights.length === 0) return undefined;
  lights.sort((a, b) => b.v - a.v || b.s - a.s || a.i - b.i);
  const top = lights.slice(0, Math.max(1, Math.ceil(lights.length * TOP_SHARE)));
  const mean = (c: number): number => Math.round(top.reduce((sum, { i }) => sum + (portrait.data[i * 4 + c] ?? 0), 0) / top.length);
  return [mean(0), mean(1), mean(2)];
}

/**
 * The mean hue of the fullest HUE_BINS bin among `pixels` that pass `keep` (ties go to the lower
 * bin), or undefined when none does.
 */
function dominantHue(portrait: Rgba, pixels: readonly number[], keep: (c: Hsv) => boolean): number | undefined {
  const count = new Array<number>(HUE_BINS).fill(0);
  const sum = new Array<number>(HUE_BINS).fill(0);
  for (const i of pixels) {
    const c = pixelHsv(portrait, i);
    if (!keep(c)) continue;
    const bin = Math.min(HUE_BINS - 1, Math.floor((c.h * HUE_BINS) / 360));
    count[bin] = (count[bin] ?? 0) + 1;
    sum[bin] = (sum[bin] ?? 0) + c.h;
  }
  let best = -1;
  count.forEach((n, bin) => {
    if (n > 0 && (best < 0 || n > (count[best] ?? 0))) best = bin;
  });
  return best < 0 ? undefined : (sum[best] ?? 0) / (count[best] ?? 1);
}

/** Indices of the pixels whose centre lies inside any polygon of the named parts (non-zero rule), ascending. */
function region(portrait: Rgba, parts: readonly Part[], names: readonly PartName[]): number[] {
  const { width, height } = portrait;
  const pixels = new Set<number>();
  for (const part of parts) {
    if (!names.includes(part.name)) continue;
    rasterizeMask(toCanvas(part.poly, width, height), width, height, 0).data.forEach((a, i) => {
      if (a !== 0) pixels.add(i);
    });
  }
  return [...pixels].sort((a, b) => a - b);
}

/**
 * Portrait + parts -> palette (requirement 6.3, ruling (b)). Candidates are pixels inside the eye
 * polygons (eye_l, eye_r) with HSV saturation >= SATURATION_MIN and value >= VALUE_MIN; the eye
 * colour is the mean of the brightest TOP_SHARE of them (ranked by value, then saturation), and
 * no warning is given.
 * With no candidate in the eyes, the search moves to the head polygon (the whole portrait when the
 * head covers no pixel centre) and a `palette_fallback` warning is returned. There the eye light
 * is the dominant hue of the saturated pixels (fullest HUE_BINS bin, its mean hue) at
 * FALLBACK_SATURATION and FALLBACK_VALUE; with no saturated pixel, the dominant hue of every pixel
 * with any colour; with no colour at all, the brightest grey of the region. So every colour comes
 * from the portrait. Glow, rim and mouth are derived from the eye colour (see `derive`). Every
 * value is lower-case "#rrggbb".
 */
export function samplePalette(portrait: Rgba, parts: readonly Part[]): SampledPalette {
  const light = brightest(portrait, region(portrait, parts, EYES), isCandidate);
  if (light !== undefined) return { palette: derive(light), warnings: [] };

  let pixels = region(portrait, parts, ["head"]);
  const where = pixels.length > 0 ? "head" : "portrait";
  if (pixels.length === 0) pixels = Array.from({ length: portrait.width * portrait.height }, (_, i) => i);
  const hue = dominantHue(portrait, pixels, isCandidate) ?? dominantHue(portrait, pixels, ({ s, v }) => s > 0 && v > 0);
  const fallback: Rgb =
    hue === undefined
      ? (brightest(portrait, pixels, () => true) ?? [0, 0, 0])
      : rgb({ h: hue, s: FALLBACK_SATURATION, v: FALLBACK_VALUE });
  const from = hue === undefined ? `the brightest grey of the ${where}` : `the ${where}'s dominant hue (${Math.round(hue)} degrees)`;
  return {
    palette: derive(fallback),
    warnings: [{ code: "palette_fallback", message: `no saturated light inside the eye polygons; eye colour from ${from}` }],
  };
}
