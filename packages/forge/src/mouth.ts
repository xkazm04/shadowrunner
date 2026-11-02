// The mouth an open jaw reveals (cast-forge task 3, design.md "Mouth"). Task 9 shaded the head's
// surface under the jaw with a smooth ramp, so a dropped jaw showed a soft grey smudge; on the
// hard-edged styles the cast is drawn in that reads as a blur. Now the forge paints a cavity:
// a hard-edged lens (pointed at the corners) hanging from the lip line (the jaw's top edge), exactly as deep as the jaw
// drops, in dark tones of the character's own lip colour, with an optional inner glow in an accent.
// The jaw's top edge is the lip line itself: its lifted region grows down and sideways, never up,
// so an open jaw never carries a sliver of the upper lip with it. Pure: arrays in, fresh images out.
import { JAW_GROW } from "./cut.js";
import { type Mask, dilateMask, emptyMask } from "./mask.js";
import type { Rgba } from "./types.js";

/** The cavity's deep tone, as a share of the lip's mean colour (hue kept). */
export const CAVITY_DEEP = 0.16;
/** The shadow under the upper lip, as a share of the lip's mean colour. */
export const CAVITY_SHADOW = 0.07;
/** The shadow band's depth, as a share of the cavity's depth in that column (at least 1 px). */
export const CAVITY_SHADOW_SHARE = 0.3;
/** The glow: the lower part of the full opening, as a share of the drop, over the middle of its width. */
export const GLOW_DEPTH_SHARE = 0.4;
export const GLOW_WIDTH_SHARE = 0.6;
/** The glow's tone: this share of the accent over the deep tone. */
export const GLOW_MIX = 0.6;

export interface MouthOptions {
  /** "#rrggbb": an inner glow in this accent (characters whose mouth glows). */
  glow?: string;
  /** The art's own pixel size in canvas px (pixel art): the cavity is stepped on that grid. */
  cell?: number;
}

/** Per column, the first row of `hard` (the lip line), or -1 where the column is empty. */
export function lipLine(hard: Mask): Int32Array {
  const { width, height, data } = hard;
  const top = new Int32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if ((data[y * width + x] ?? 0) === 0) continue;
      top[x] = y;
      break;
    }
  }
  return top;
}

/** The first and last columns `top` holds, or undefined when it holds none. */
function spanOf(top: Int32Array): [number, number] | undefined {
  let x0 = -1;
  let x1 = -1;
  top.forEach((y, x) => {
    if (y < 0) return;
    if (x0 < 0) x0 = x;
    x1 = x;
  });
  return x0 < 0 ? undefined : [x0, x1];
}

/**
 * A jaw's lifted region: its hard polygon grown by `grow` px (JAW_GROW) down and sideways, but
 * nothing above the lip line (a column outside the jaw uses the nearest jaw column's line).
 */
export function liftedJaw(hard: Mask, grow: number = JAW_GROW): Mask {
  const grown = dilateMask(hard, grow);
  clearAboveLip(grown.data, hard);
  return grown;
}

/** Zeroes every pixel of `data` (a mask the size of `hard`) above the jaw's lip line; all of it when `hard` is empty. */
export function clearAboveLip(data: Uint8ClampedArray, hard: Mask): void {
  const top = lipLine(hard);
  const span = spanOf(top);
  const { width } = hard;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) continue;
    const x = i % width;
    const lip = span === undefined ? Infinity : (top[Math.min(span[1], Math.max(span[0], x))] ?? 0);
    if ((i - x) / width < lip) data[i] = 0;
  }
}

/** The mean colour of `image` under `hard` (the lip); mid grey when the mask is empty. */
function meanUnder(image: Rgba, hard: Mask): [number, number, number] {
  const sum = [0, 0, 0];
  let n = 0;
  hard.data.forEach((a, i) => {
    if (a === 0) return;
    n++;
    for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (image.data[i * 4 + c] ?? 0);
  });
  return n === 0 ? [128, 128, 128] : [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n];
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) as [number, number, number];

export interface Cavity {
  /** 255 where the cavity is painted. */
  mask: Mask;
  /** The tones used: shadow, deep, and the glow when one was asked for. */
  tones: { shadow: [number, number, number]; deep: [number, number, number]; glow?: [number, number, number] };
}

/**
 * Paints the mouth cavity into `surface` (modified) and returns its mask. For each column of the
 * jaw's hard polygon, with `u` in [-1, 1] across its width (stepped to `cell` px when given), the
 * cavity runs from the lip line down `dropPx * (1 - u^2)` px (rounded, to whole cells when
 * stepped): a lens as wide as the jaw and as deep as its drop, so the open jaw uncovers dark mouth
 * in the middle and painted surface at the corners. It is clipped to `lifted` (the region the jaw
 * covers at rest), so the rest view never shows it. Tones come from the lip's mean colour in
 * `portrait`: a shadow band under the upper lip, then the deep tone, then (with `glow`) the accent
 * over the lower middle. Every edge is hard: no pixel is blended.
 */
export function paintCavity(surface: Rgba, portrait: Rgba, hard: Mask, lifted: Mask, dropPx: number, options: MouthOptions = {}): Cavity {
  const { width, height } = surface;
  const mask = emptyMask(width, height);
  const lip = meanUnder(portrait, hard);
  const shadow = lip.map((v) => Math.round(v * CAVITY_SHADOW)) as [number, number, number];
  const deep = lip.map((v) => Math.round(v * CAVITY_DEEP)) as [number, number, number];
  const accent = options.glow === undefined ? undefined : hexRgb(options.glow);
  const glow = accent?.map((v, c) => Math.round(v * GLOW_MIX + (deep[c] ?? 0) * (1 - GLOW_MIX))) as [number, number, number] | undefined;
  const tones = { shadow, deep, ...(glow === undefined ? {} : { glow }) };
  const top = lipLine(hard);
  const span = spanOf(top);
  if (span === undefined || dropPx <= 0) return { mask, tones };
  const cell = Math.max(1, Math.round(options.cell ?? 1));
  const [x0, x1] = span;
  const half = (x1 - x0 + 1) / 2;
  // The glow lies flat along the bottom of the full opening (its middle), not under each column.
  const full = cell === 1 ? dropPx : Math.floor(dropPx / cell) * cell;
  const glowFrom = full - Math.max(cell, Math.round((full * GLOW_DEPTH_SHARE) / cell) * cell);
  const centre = x0 + half;
  for (let x = x0; x <= x1; x++) {
    const lipY = top[x] ?? -1;
    if (lipY < 0) continue;
    const at = cell === 1 ? x + 0.5 : x0 + (Math.floor((x - x0) / cell) + 0.5) * cell;
    const u = Math.min(1, Math.abs(at - centre) / half);
    const raw = dropPx * (1 - u * u);
    // Never deeper than the drop: on a stepped grid, at most the whole cells the drop holds.
    const depth = cell === 1 ? Math.min(dropPx, Math.round(raw)) : Math.min(Math.round(raw / cell), Math.floor(dropPx / cell)) * cell;
    if (depth <= 0) continue;
    const band = Math.max(1, cell === 1 ? Math.round(depth * CAVITY_SHADOW_SHARE) : Math.round((depth * CAVITY_SHADOW_SHARE) / cell) * cell);
    const glowing = glow !== undefined && u <= GLOW_WIDTH_SHARE;
    for (let k = 0; k < depth; k++) {
      const y = lipY + k;
      if (y >= height) break;
      const i = y * width + x;
      if ((lifted.data[i] ?? 0) === 0) continue;
      const tone = k < band ? shadow : glowing && k >= glowFrom ? glow : deep;
      surface.data.set([tone[0], tone[1], tone[2], 255], i * 4);
      mask.data[i] = 255;
    }
  }
  return { mask, tones };
}
