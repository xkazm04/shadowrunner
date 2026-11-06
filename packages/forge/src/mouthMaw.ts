// Where a painted maw is (cast-face-pass): an already-open mouth of teeth around a dark gap (a grin
// of teeth, a skull's teeth over a void, a carved lantern grin) has no lips to part, so the warp
// widens the gap and moves the teeth rows (`RigLips.maw`). `measureMaw` reads it from the rest art
// around the measured mouth: the seam (the darkest row between the upper and lower teeth), the upper
// teeth's top and the lower teeth's bottom at the middle, and the corners where the gap's dark line,
// followed outward from the middle between lighter art, ends (in a dark void: where the teeth end).
// Levels: the teeth (the core's bright percentile), the skin (the window's median), the ink; teeth are
// over halfway from skin to teeth, the gap's ink under halfway from skin to ink. Pure: layers in,
// numbers out; undefined when unsure.
import type { RigLips, RigMouth } from "@sr/rig";
import type { Rgba } from "./types.js";

type Box = readonly [x: number, y: number, w: number, h: number];
type Mouth = Pick<RigMouth, "cx" | "lineY" | "width">;

/** The search window, shares of the mouth's width: each side of cx (a grin is wider than the jaw), above and below lineY. */
export const MAW_SEARCH_X = 1.3;
export const MAW_SEARCH_UP = 0.8;
export const MAW_SEARCH_DOWN = 0.8;
/** The seam lies within this share of the width of lineY, with teeth within MAW_TEETH_NEAR above and below it. */
export const MAW_SEAM_REACH = 0.3;
export const MAW_TEETH_NEAR = 0.45;
/** The middle columns (share of the width about cx) that vote for the seam and the teeth rows. */
export const MAW_MIDDLE = 0.3;
/** A teeth run may skip this many non-bright rows (a tooth's edge, a highlight's ring). */
export const MAW_RUN_GAP = 2;
/** Following the gap outward, it may climb or sink this many rows per column (a grin's corners curve up). */
export const MAW_TRACK_STEP = 3;
/** At least this share of the middle columns must show teeth above and below the seam. */
export const MAW_MIN_VOTES = 0.5;
/** The maw's span (right - left) lies in [MAW_SPAN_MIN, MAW_SPAN_MAX] x the mouth's width. */
export const MAW_SPAN_MIN = 0.5;
export const MAW_SPAN_MAX = 3;
/** The teeth's level is this percentile of the core (the middle columns about lineY), the ink's this one of the core or the window (the darker). */
export const MAW_TEETH_PCT = 0.85;
export const MAW_INK_PCT = 0.02;
/** The teeth stand at least this far (luma 0-255) over the skin (the window's median). */
export const MAW_TONE_STEP = 30;
const OPAQUE = 128;

/** Source-over luminance of `layers` (bottom first) over the window; NaN where nothing is opaque. */
function lumaWindow(layers: readonly { bbox: Box; image: Rgba }[], x0: number, y0: number, w: number, h: number): Float32Array {
  const rgb = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  const alpha = new Float32Array(w * h);
  for (const { bbox, image } of layers) {
    for (let y = 0; y < h; y++) {
      const iy = Math.floor(y0 + y - bbox[1]);
      if (iy < 0 || iy >= image.height) continue;
      for (let x = 0; x < w; x++) {
        const ix = Math.floor(x0 + x - bbox[0]);
        if (ix < 0 || ix >= image.width) continue;
        const o = (iy * image.width + ix) * 4;
        const a = (image.data[o + 3] ?? 0) / 255;
        if (a === 0) continue;
        const i = y * w + x;
        for (let c = 0; c < 3; c++) (rgb[c] as Float32Array)[i] = (image.data[o + c] ?? 0) * a + ((rgb[c] as Float32Array)[i] ?? 0) * (1 - a);
        alpha[i] = a + (alpha[i] ?? 0) * (1 - a);
      }
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i] ?? 0;
    out[i] = a * 255 < OPAQUE ? NaN : (0.2126 * (rgb[0]?.[i] ?? 0) + 0.7152 * (rgb[1]?.[i] ?? 0) + 0.0722 * (rgb[2]?.[i] ?? 0)) / a;
  }
  return out;
}

const pct = (v: readonly number[], q: number): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))] ?? NaN;
};

const median = (v: number[]): number | undefined => {
  if (v.length === 0) return undefined;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/**
 * The maw around `mouth` (canvas px) in the rest art `layers` (bottom first), as RigLips with
 * `maw: true` (see the header), or undefined when unsure: no teeth above and below a seam in at
 * least MAW_MIN_VOTES of the middle columns, a span outside [MAW_SPAN_MIN, MAW_SPAN_MAX] x width,
 * or a box that does not hold cx and lineY (the validator's rule).
 */
export function measureMaw(layers: readonly { bbox: Box; image: Rgba }[], mouth: Mouth): RigLips | undefined {
  const { cx, lineY, width } = mouth;
  const x0 = Math.floor(cx - MAW_SEARCH_X * width);
  const y0 = Math.floor(lineY - MAW_SEARCH_UP * width);
  const w = Math.ceil(cx + MAW_SEARCH_X * width) - x0;
  const h = Math.ceil(lineY + MAW_SEARCH_DOWN * width) - y0;
  if (w < 4 || h < 4) return undefined;
  const lum = lumaWindow(layers, x0, y0, w, h);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? NaN : (lum[y * w + x] ?? NaN));
  const values: number[] = [];
  lum.forEach((v) => Number.isNaN(v) || values.push(v));
  if (values.length < 16) return undefined;
  // Three levels: the teeth (the core's MAW_TEETH_PCT percentile: the middle columns about lineY are
  // mostly teeth), the skin (the window's median: a face, a hood, a void) and the ink (MAW_INK_PCT).
  const ly = Math.round(lineY - y0);
  const reach = Math.max(2, Math.round(MAW_SEAM_REACH * width));
  const mid = Math.round(cx - x0);
  const half = Math.max(1, Math.round((MAW_MIDDLE * width) / 2));
  const core: number[] = [];
  for (let y = ly - reach; y <= ly + reach; y++) for (let x = mid - half; x <= mid + half; x++) if (!Number.isNaN(at(x, y))) core.push(at(x, y));
  const teeth = pct(core, MAW_TEETH_PCT);
  const skin = pct(values, 0.5);
  const ink = Math.min(pct(values, MAW_INK_PCT), pct(core, MAW_INK_PCT));
  // Teeth stand MAW_TONE_STEP over the skin (lips on skin, flat skin: no maw).
  if (!(teeth - skin >= MAW_TONE_STEP)) return undefined;
  const t2 = (teeth + skin) / 2;
  const t1 = (skin + ink) / 2;
  const bright = (x: number, y: number) => at(x, y) >= t2;
  const dark = (x: number, y: number) => at(x, y) < t1;
  const near = Math.max(2, Math.round(MAW_TEETH_NEAR * width));
  /** Column x's seam: near lineY, the row with the most teeth within `near` on its fewer side (then the darkest), the middle of its gap; -1 when none. */
  const seamOf = (x: number, from = ly - reach, to = ly + reach): number => {
    let best = -1;
    let bestLum = Infinity;
    let bestTeeth = 0;
    for (let y = Math.max(1, from); y <= Math.min(h - 2, to); y++) {
      const v = at(x, y);
      if (Number.isNaN(v) || bright(x, y)) continue;
      // Teeth on both sides: the fewer side's teeth rows within `near`; the most, then the darkest, wins.
      let up = 0;
      let down = 0;
      for (let k = 1; k <= near; k++) {
        up += bright(x, y - k) ? 1 : 0;
        down += bright(x, y + k) ? 1 : 0;
      }
      const teethRows = Math.min(up, down);
      if (teethRows > 0 && (teethRows > bestTeeth || (teethRows === bestTeeth && v < bestLum))) {
        best = y;
        bestLum = v;
        bestTeeth = teethRows;
      }
    }
    if (best < 0) return -1;
    // The middle of the gap's run of non-teeth rows through the darkest one (a wide gap is not its darkest noise).
    let a = best;
    let b = best;
    while (a > 0 && !bright(x, a - 1) && !Number.isNaN(at(x, a - 1))) a--;
    while (b < h - 1 && !bright(x, b + 1) && !Number.isNaN(at(x, b + 1))) b++;
    return Math.round((a + b) / 2);
  };
  /** From the seam, the last row of the teeth run going `dir` (-1 up, +1 down), skipping the gap first; -1 when none. */
  const runEnd = (x: number, seam: number, dir: number): number => {
    let y = seam + dir;
    let skipped = 0;
    while (y >= 0 && y < h && !bright(x, y) && skipped <= near) {
      y += dir;
      skipped++;
    }
    if (y < 0 || y >= h || !bright(x, y)) return -1;
    let last = y;
    let miss = 0;
    for (y += dir; y >= 0 && y < h && miss <= MAW_RUN_GAP; y += dir) {
      if (bright(x, y)) {
        last = y;
        miss = 0;
      } else miss++;
    }
    return last;
  };
  const seams: number[] = [];
  const uppers: number[] = [];
  const lowers: number[] = [];
  for (let x = mid - half; x <= mid + half; x++) {
    const s = seamOf(x);
    if (s < 0) continue;
    const u = runEnd(x, s, -1);
    const l = runEnd(x, s, 1);
    if (u < 0 || l < 0) continue;
    seams.push(s);
    uppers.push(u);
    lowers.push(l);
  }
  if (seams.length < MAW_MIN_VOTES * (2 * half + 1)) return undefined;
  const seam = median(seams) ?? 0;
  const upper = median(uppers) ?? 0;
  const lower = median(lowers) ?? 0;
  /** Follows the gap's dark line outward from the middle; the last column it is dark in (or shows teeth beside). */
  const corner = (dir: number): number => {
    let y = Math.round(seam);
    let last = mid;
    for (let x = mid + dir; x >= 0 && x < w; x += dir) {
      let best = -1;
      let bestLum = Infinity;
      // Nearest first: on a flat run of ink the line keeps its row.
      for (const k of [0, ...Array.from({ length: MAW_TRACK_STEP }, (_, i) => [-(i + 1), i + 1]).flat()]) {
        const v = at(x, y + k);
        if (!Number.isNaN(v) && v < bestLum) {
          best = y + k;
          bestLum = v;
        }
      }
      if (best < 0 || bright(x, best)) break;
      // On the gap's line: ink, or between teeth (a tooth's edge, a separator) within `near` above and below.
      let up = false;
      let down = false;
      for (let k = 1; k <= near && !(up && down); k++) {
        up ||= bright(x, best - k);
        down ||= bright(x, best + k);
      }
      if (!dark(x, best) && !(up && down)) break;
      // The gap's line runs between lighter art (teeth, skin) above and below; in a dark void it ends with the teeth.
      let above = false;
      let below = false;
      for (let k = 1; k <= near && !(above && below); k++) {
        above ||= at(x, best - k) >= t1;
        below ||= at(x, best + k) >= t1;
      }
      if (!(above && below)) break;
      y = best;
      last = x;
    }
    return last;
  };
  const left = x0 + corner(-1);
  const right = x0 + corner(1) + 1;
  const box = { left, right, upper: y0 + Math.round(upper), lower: y0 + Math.round(lower) + 1, seam: y0 + Math.round(seam) };
  if (box.right - box.left < MAW_SPAN_MIN * width || box.right - box.left > MAW_SPAN_MAX * width) return undefined;
  if (!(box.left < cx && cx < box.right && box.upper < lineY && lineY < box.lower && box.upper <= box.seam && box.seam <= box.lower)) return undefined;
  return { ...box, maw: true };
}
