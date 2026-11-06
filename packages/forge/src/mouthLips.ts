// Where the painted lips are (art-mouth): the corners and the upper/lower lip's outer edges of the
// rest art around the measured mouth (`Rig.mouth`), so the art-preserving (warp) mouth bends the
// character's own lips and not the cheek. Pure: layers in, numbers out; undefined when unsure.
import type { RigLips, RigMouth } from "@sr/rig";
import type { Rgba } from "./types.js";

type Box = readonly [x: number, y: number, w: number, h: number];
type Mouth = Pick<RigMouth, "cx" | "lineY" | "width">;
type Art = readonly { bbox: Box; image: Rgba }[];

/** The search window, as shares of the mouth's width: each side of cx, above and below lineY. */
export const LIPS_SEARCH_X = 0.85;
export const LIPS_SEARCH_UP = 0.45;
export const LIPS_SEARCH_DOWN = 0.6;
/** The lips' span (right - left) must lie in [LIPS_SPAN_MIN, LIPS_SPAN_MAX] x the mouth's width. */
export const LIPS_SPAN_MIN = 0.5;
export const LIPS_SPAN_MAX = 1.4;
/** How far (robust z: skin spreads) the middle of the mouth must stand out from the skin. */
export const LIPS_MIN_CONTRAST = 1.5;
/** A cue's spread (MAD, 0-255 scale) is at least this: flat skin is not infinitely sure. */
export const LIPS_MAD_FLOOR = 2;
/** A pixel is lip from this share of the way from the skin's level (0) to the lips' (1). */
export const LIPS_THRESHOLD = 0.5;
/** Lip runs bridge misses shorter than this share of the mouth's width (a highlight, a crease). */
export const LIPS_GAP = 0.08;
/** A column is lip when this share of the mouth's width of its rows (at least 2) is: the corners taper to a line. */
export const LIPS_COLUMN_MIN = 0.03;
/** The lower lip reaches at most this share of the mouth's width below the parting. */
export const LIPS_LOWER_MAX = 0.45;
/** The jaw's cut may sit this share of the width above the upper lip: `upper` is then lineY - 1. */
export const LIPS_LINE_SLACK = 0.1;
/** The seam must sit this share of the lips' luminance range below their median row. */
export const LIPS_SEAM_CONTRAST = 0.25;
/** A pixel of the composited art counts from this alpha. */
const OPAQUE = 128;

/** The lip-vs-skin score of the window about the mouth (window px; NaN where the art is transparent). */
export interface LipScore {
  x0: number;
  y0: number;
  w: number;
  h: number;
  score: Float32Array;
  /** Luminance (0-255, box-smoothed), NaN where transparent. */
  lum: Float32Array;
  /** The skin's level (0: the window's median). */
  skin: number;
  /** The score the lips reach about the mouth's middle. */
  lips: number;
  /** The other cue's score and level (a lip corner in shadow is darker, not redder). */
  other: { score: Float32Array; lips: number };
}

/** Source-over composite of `layers` (bottom first) into the window: box-smoothed R, G, B and an opaque flag. */
function composite(layers: Art, x0: number, y0: number, w: number, h: number): { rgb: Float32Array[]; opaque: Uint8Array } {
  const rgb = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  const alpha = new Float32Array(w * h);
  for (const { bbox, image } of layers) {
    for (let y = 0; y < h; y++) {
      const iy = Math.floor(y0 + y - bbox[1]);
      if (iy < 0 || iy >= image.height) continue;
      for (let x = 0; x < w; x++) {
        const ix = Math.floor(x0 + x - bbox[0]);
        if (ix < 0 || ix >= image.width) continue;
        const k = (iy * image.width + ix) * 4;
        const a = (image.data[k + 3] ?? 0) / 255;
        if (a === 0) continue;
        const i = y * w + x;
        rgb.forEach((ch, c) => {
          ch[i] = (image.data[k + c] ?? 0) * a + (ch[i] ?? 0) * (1 - a);
        });
        alpha[i] = a + (alpha[i] ?? 0) * (1 - a);
      }
    }
  }
  const opaque = new Uint8Array(w * h);
  alpha.forEach((a, i) => (opaque[i] = a * 255 >= OPAQUE ? 1 : 0));
  return { rgb: rgb.map((ch) => smooth(ch, w, h)), opaque };
}

/** 3x3 box blur (an edge averages what exists): the paint's brush texture is not lip evidence. */
function smooth(ch: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          sum += ch[yy * w + xx] ?? 0;
          n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

function quantile(values: readonly number[], q: number): number {
  const sorted = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.round(q * (sorted.length - 1))] ?? Number.NaN;
}

/**
 * The lip-vs-skin score about `mouth`. Two cues, each a robust z-score over the window's opaque
 * pixels (median, MAD floored at LIPS_MAD_FLOOR): redder (R - G: painted lips on skin) and darker
 * (luminance: ink or greyscale lips). The cue whose middle of the mouth stands out more is the
 * score. Undefined when the window has fewer than 8 opaque pixels.
 */
export function lipScore(layers: Art, mouth: Mouth): LipScore | undefined {
  const { cx, lineY, width: mw } = mouth;
  if (!(mw > 0)) return undefined;
  const x0 = Math.floor(cx - LIPS_SEARCH_X * mw);
  const y0 = Math.floor(lineY - LIPS_SEARCH_UP * mw);
  const w = Math.ceil(cx + LIPS_SEARCH_X * mw) - x0;
  const h = Math.ceil(lineY + LIPS_SEARCH_DOWN * mw) - y0;
  const { rgb, opaque } = composite(layers, x0, y0, w, h);
  const [r, g, b] = rgb as [Float32Array, Float32Array, Float32Array];
  const pixels: number[] = [];
  for (let i = 0; i < w * h; i++) if (opaque[i] === 1) pixels.push(i);
  if (pixels.length < 8) return undefined;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = opaque[i] === 1 ? ((r[i] ?? 0) + (g[i] ?? 0) + (b[i] ?? 0)) / 3 : Number.NaN;
  const middle: number[] = [];
  for (let y = Math.max(0, Math.round(lineY - y0 - 0.15 * mw)); y < Math.min(h, Math.round(lineY - y0 + 0.35 * mw)); y++) {
    for (let x = Math.round(cx - x0 - 0.2 * mw); x < Math.round(cx - x0 + 0.2 * mw); x++) middle.push(y * w + x);
  }
  const cue = (of: (i: number) => number): { score: Float32Array; lips: number } => {
    const values = pixels.map(of);
    const median = quantile(values, 0.5);
    const spread = Math.max(LIPS_MAD_FLOOR, quantile(values.map((v) => Math.abs(v - median)), 0.5)) * 1.4826;
    const score = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) score[i] = opaque[i] === 1 ? (of(i) - median) / spread : Number.NaN;
    const lips = quantile(middle.map((i) => score[i] ?? Number.NaN), 0.9);
    return { score, lips };
  };
  const red = cue((i) => (r[i] ?? 0) - (g[i] ?? 0));
  const dark = cue((i) => -(lum[i] ?? 0));
  const [best, other] = red.lips >= dark.lips ? [red, dark] : [dark, red];
  return { x0, y0, w, h, score: best.score, lum, skin: 0, lips: best.lips, other };
}

/** The run of indices in [from, to] where `on` holds (bridging misses up to `gap`) that contains or is nearest `seed`. */
function run(on: (i: number) => boolean, from: number, to: number, seed: number, gap: number): [number, number] | undefined {
  const runs: [number, number][] = [];
  let start = -1;
  let last = -1;
  for (let i = from; i <= to; i++) {
    if (!on(i)) continue;
    if (start >= 0 && i - last > gap) runs.push([start, last]);
    if (start < 0 || i - last > gap) start = i;
    last = i;
  }
  if (start >= 0) runs.push([start, last]);
  const distance = ([a, b]: [number, number]): number => (seed < a ? a - seed : seed > b ? seed - b : 0);
  runs.sort((p, q) => distance(p) - distance(q) || q[1] - q[0] - (p[1] - p[0]));
  return runs[0];
}

/** Row y's median luminance over the columns lx +- half (window px). */
function rowLum(s: LipScore, lx: number, half: number): (y: number) => number {
  const n = Math.max(1, Math.round(half));
  return (y) => {
    const v: number[] = [];
    for (let x = lx - n; x <= lx + n; x++) v.push(s.lum[y * s.w + x] ?? Number.NaN);
    return quantile(v, 0.5);
  };
}

/**
 * The parting (seam) between the lips at cx: the darkest row of the middle columns' luminance
 * (cx +- 0.1 width) strictly inside the lips' rows. Window rows; undefined when it is no darker
 * than the lips' median row by LIPS_SEAM_CONTRAST of their range (at least 8 levels): no ink or
 * dark line parts them.
 */
function seamRow(s: LipScore, lx: number, top: number, bottom: number, mw: number): number | undefined {
  const row = rowLum(s, lx, 0.1 * mw);
  const rows: number[] = [];
  for (let y = top; y <= bottom; y++) rows.push(row(y));
  let at = -1;
  rows.forEach((v, k) => {
    if (k > 0 && k < rows.length - 1 && (at < 0 || v < (rows[at] ?? Infinity))) at = k;
  });
  if (at < 0) return undefined;
  const lo = rows[at] ?? Number.NaN;
  const range = quantile(rows, 1) - quantile(rows, 0);
  if (!(quantile(rows, 0.5) - lo >= Math.max(8, LIPS_SEAM_CONTRAST * range))) return undefined;
  return top + at;
}

/**
 * The lower lip's bottom by shading, for a lower lip the cue does not see (lit, unpainted): down
 * the middle columns' luminance from the parting (the darkest row of the lips), past the lower
 * lip's brightest row, to the first row darker than halfway between the two (the shadow or ink
 * line under the lip). Window rows; undefined when the profile never darkens again.
 */
function shadedBottom(s: LipScore, lx: number, top: number, bottom: number, mw: number): number | undefined {
  const row = rowLum(s, lx, 0.15 * mw);
  let parting = top;
  for (let y = top; y <= bottom; y++) if (row(y) < row(parting)) parting = y;
  const end = Math.min(s.h - 1, Math.round(parting + LIPS_LOWER_MAX * mw));
  let peak = parting;
  for (let y = parting; y <= Math.min(end, Math.round(parting + 0.3 * mw)); y++) if (row(y) > row(peak)) peak = y;
  const mid = (row(parting) + row(peak)) / 2;
  for (let y = peak; y <= end; y++) if (row(y) < mid) return y - 1;
  return undefined;
}

/**
 * The painted lips around `mouth` on the rest art (`layers`: the head and jaw layers, bottom first,
 * each an Rgba the size of its bbox placed at it; or one plate at [0, 0, w, h]). A pixel is lip when
 * its `lipScore` clears LIPS_THRESHOLD of the way from the skin's level to the lips'. Per column of
 * the middle of the mouth (cx +- 0.25 width), the run of lip nearest the lip line: `upper` is the
 * higher quartile of their tops (the cupid's bow peaks), the bottom the lower quartile of their
 * bottoms or, lower, the shaded bottom (`shadedBottom`: a lower lip only shading shows). Walking out
 * from the middle over those rows, the run of columns with LIPS_COLUMN_MIN x width (at least 2) lip
 * rows gives `left` and `right`. Canvas px; `right` and `lower` are pixel edges. A jaw cut at most
 * LIPS_LINE_SLACK x width above the lips puts `upper` at lineY - 1. Undefined when the lips do not
 * stand out by LIPS_MIN_CONTRAST, an edge is the window's, the span is not within [LIPS_SPAN_MIN,
 * LIPS_SPAN_MAX] x width or the box does not hold (cx, lineY) inside the canvas's top-left. `seam`
 * (the parting at cx, `seamRow`) is omitted when no dark line parts the lips.
 */
export function measureLips(layers: Art, mouth: Mouth): RigLips | undefined {
  const s = lipScore(layers, mouth);
  if (s === undefined || !(s.lips - s.skin >= LIPS_MIN_CONTRAST)) return undefined;
  const { x0, y0, w, h, score } = s;
  const thr = s.skin + LIPS_THRESHOLD * (s.lips - s.skin);
  const lip = (x: number, y: number): boolean => (score[y * w + x] ?? Number.NaN) >= thr;
  const mw = mouth.width;
  const lx = Math.round(mouth.cx - x0);
  const ly = Math.round(mouth.lineY - y0);
  const gap = Math.max(1, Math.round(LIPS_GAP * mw));

  // The other cue joins (a dark parting between red lips) but the lips' own cue ends the run.
  const otherThr = Math.max(LIPS_MIN_CONTRAST, LIPS_THRESHOLD * s.other.lips);
  const either = (x: number, y: number): boolean => lip(x, y) || (s.other.score[y * w + x] ?? Number.NaN) >= otherThr;
  const tops: number[] = [];
  const bottoms: number[] = [];
  const half = Math.round(0.25 * mw);
  for (let x = lx - half; x <= lx + half; x++) {
    const rows = run((y) => either(x, y), 0, h - 1, ly, gap);
    if (rows === undefined || rows[0] === 0 || rows[1] === h - 1) continue;
    let [a, b] = rows;
    while (a < b && !lip(x, a)) a++;
    while (b > a && !lip(x, b)) b--;
    if (!lip(x, a)) continue;
    tops.push(a);
    bottoms.push(b);
  }
  if (tops.length < half) return undefined;
  const top = Math.round(quantile(tops, 0.25));
  const seen = Math.round(quantile(bottoms, 0.75));
  const bottom = Math.max(seen, shadedBottom(s, lx, top, seen, mw) ?? seen);

  const least = Math.max(2, Math.round(LIPS_COLUMN_MIN * mw));
  const isColumn = (x: number): boolean => {
    let n = 0;
    for (let y = top; y <= bottom; y++) if (either(x, y)) n++;
    return n >= least;
  };
  const cols = run(isColumn, 0, w - 1, lx, gap);
  if (cols === undefined || cols[0] === 0 || cols[1] === w - 1) return undefined;
  let upper = y0 + top;
  if (upper >= mouth.lineY && upper - mouth.lineY <= LIPS_LINE_SLACK * mw) upper = Math.ceil(mouth.lineY) - 1;
  const seam = seamRow(s, lx, top, bottom, mw);
  const lips = { left: x0 + cols[0], right: x0 + cols[1] + 1, upper, lower: y0 + bottom + 1, ...(seam === undefined ? {} : { seam: Math.max(upper, y0 + seam) }) };
  const span = lips.right - lips.left;
  if (span < LIPS_SPAN_MIN * mw || span > LIPS_SPAN_MAX * mw) return undefined;
  if (!(lips.left >= 0 && lips.left < mouth.cx && mouth.cx < lips.right && lips.upper >= 0 && lips.upper < mouth.lineY && mouth.lineY < lips.lower)) return undefined;
  return lips;
}
