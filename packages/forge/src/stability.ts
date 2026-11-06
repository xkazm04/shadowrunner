// Face stability (face-control, WP-B): how far an expression face strays from its base. An
// expression may move the brows and the lids, nothing else: `browLidBand` is where it may, and
// `faceStability` measures the iris drift (the iris found again in the edit, `trackIris`), the mean
// change inside the face outside the band, and the mean change inside the band. Over the limits the
// face is refused (scripts/cast/expressions.mjs --import, the live forge's expression step). The
// limits come from the cast faces of 2026-11-03 (docs/provenance.md "face-control"). Pure.
import type { Layer, Rig } from "@sr/rig";
import { featherMask, emptyMask, type Mask } from "./mask.js";
import { measureIris, type EyeLook, type Iris } from "./eyes.js";
import type { Rgba } from "./types.js";

/** The brow+lid band around the eyes, as shares of the widest eye's width: above, below, to the sides. */
export const LID_BAND_ABOVE = 0.9;
export const LID_BAND_BELOW = 0.3;
export const LID_BAND_SIDE = 0.4;
/** The band's inward feather, px. */
export const LID_BAND_FEATHER = 12;

/**
 * Refusal limits (see the header), set from the cast faces of 2026-11-06 (docs/provenance.md
 * "face-control"): an iris drift over IRIS_DRIFT_LIMIT px (the tracker's own noise on unmoved irises
 * is 0-3 px; the drifts the owner saw were 8-20 px); a mean |RGB| change outside the band over the
 * re-render floor + OUTSIDE_BAND_MARGIN, the floor being the same editor's iris-free edit of the same
 * portrait (an edit that changes nothing outside the eyes: 5.1-6.7 on the four), else over
 * OUTSIDE_BAND_LIMIT (the highest floor seen, rounded up).
 */
export const IRIS_DRIFT_LIMIT = 4;
export const OUTSIDE_BAND_MARGIN = 1.5;
export const OUTSIDE_BAND_LIMIT = 7;

/** How far trackIris searches (px, each way), and the mean truncated error over which it is unsure. */
export const TRACK_SEARCH = 16;
export const TRACK_TRUNCATE = 80;
export const TRACK_UNSURE = 36;
/** A move counts only when it matches at least this share better than no move (else the iris stayed). */
export const TRACK_GAIN = 0.15;

const isBrow = (name: string): boolean => /^brow(_|$)/.test(name);

/** A character's own band reach (shares of the widest eye's width), over LID_BAND_ABOVE / BELOW / SIDE. */
export interface BandReach {
  above?: number;
  below?: number;
  side?: number;
}

/**
 * The brow+lid band, canvas-size: the box around every eye layer grown by LID_BAND_ABOVE / LID_BAND_BELOW /
 * LID_BAND_SIDE (or `reach`) of the widest eye's width (one box over both eyes, so the crease between
 * the brows is in it) and every brow layer's box, at full weight; the feather (LID_BAND_FEATHER px)
 * lies outside the box, so a stroke inside it (a line-art brow) is never half drawn. Empty without eye layers.
 */
export function browLidBand(rig: Pick<Rig, "width" | "height" | "layers">, reach: BandReach = {}): Mask {
  const shape = emptyMask(rig.width, rig.height);
  const eyes = rig.layers.filter((l) => l.kind === "eye");
  const fill = ([x, y, w, h]: Layer["bbox"]) => {
    for (let cy = Math.max(0, Math.floor(y)); cy < Math.min(rig.height, Math.ceil(y + h)); cy++) {
      for (let cx = Math.max(0, Math.floor(x)); cx < Math.min(rig.width, Math.ceil(x + w)); cx++) shape.data[cy * rig.width + cx] = 255;
    }
  };
  if (eyes.length > 0) {
    const ew = Math.max(...eyes.map((e) => e.bbox[2]));
    const f = LID_BAND_FEATHER;
    const x0 = Math.min(...eyes.map((e) => e.bbox[0])) - (reach.side ?? LID_BAND_SIDE) * ew - f;
    const x1 = Math.max(...eyes.map((e) => e.bbox[0] + e.bbox[2])) + (reach.side ?? LID_BAND_SIDE) * ew + f;
    const y0 = Math.min(...eyes.map((e) => e.bbox[1])) - (reach.above ?? LID_BAND_ABOVE) * ew - f;
    const y1 = Math.max(...eyes.map((e) => e.bbox[1] + e.bbox[3])) + (reach.below ?? LID_BAND_BELOW) * ew + f;
    fill([x0, y0, x1 - x0, y1 - y0]);
  }
  for (const [x, y, w, h] of rig.layers.filter((l) => isBrow(l.name)).map((l) => l.bbox)) fill([x - LID_BAND_FEATHER, y - LID_BAND_FEATHER, w + 2 * LID_BAND_FEATHER, h + 2 * LID_BAND_FEATHER]);
  return featherMask(shape, LID_BAND_FEATHER);
}

/** A canvas-size crop helper: the `[x, y, w, h]` box of `image` (outside pixels transparent). */
export function cropImage(image: Rgba, [x, y, w, h]: readonly [number, number, number, number]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      const sy = y + j;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      data.set(image.data.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), (j * w + i) * 4);
    }
  }
  return { width: w, height: h, data };
}

/** Where the iris of `base` (disc in `base`'s px) went in `edited`, with the mean truncated error of the match and of no move (`still`). */
export function trackIris(base: Rgba, iris: Iris, edited: Rgba, search = TRACK_SEARCH): { cx: number; cy: number; error: number; still: number } {
  const pts: [number, number][] = [];
  for (let y = Math.floor(iris.cy - iris.r); y <= Math.ceil(iris.cy + iris.r); y++) {
    for (let x = Math.floor(iris.cx - iris.r); x <= Math.ceil(iris.cx + iris.r); x++) {
      if (x < 0 || y < 0 || x >= base.width || y >= base.height) continue;
      if (Math.hypot(x + 0.5 - iris.cx, y + 0.5 - iris.cy) <= iris.r) pts.push([x, y]);
    }
  }
  let best = { dx: 0, dy: 0, error: Infinity, d: Infinity };
  let still = Infinity;
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      let sum = 0;
      for (const [x, y] of pts) {
        const tx = x + dx;
        const ty = y + dy;
        const s = (y * base.width + x) * 4;
        if (tx < 0 || ty < 0 || tx >= edited.width || ty >= edited.height) {
          sum += TRACK_TRUNCATE;
          continue;
        }
        const t = (ty * edited.width + tx) * 4;
        let e = 0;
        for (let c = 0; c < 3; c++) e += Math.abs((base.data[s + c] ?? 0) - (edited.data[t + c] ?? 0));
        sum += Math.min(TRACK_TRUNCATE, e / 3);
      }
      const error = pts.length === 0 ? Infinity : sum / pts.length;
      const d = Math.hypot(dx, dy);
      if (dx === 0 && dy === 0) still = error;
      // A tie keeps the smaller move: a flat iris never drifts by accident.
      if (error < best.error - 1e-9 || (Math.abs(error - best.error) <= 1e-9 && d < best.d)) best = { dx, dy, error, d };
    }
  }
  return { cx: iris.cx + best.dx, cy: iris.cy + best.dy, error: best.error, still };
}

/** An eye to check: its layer's bbox, its iris in canvas px and how it is drawn. */
export interface StabilityEye {
  bbox: Layer["bbox"];
  iris: Iris;
  look: EyeLook;
  /** A glowing eye's colour. */
  tint?: readonly [number, number, number];
}

export interface FaceStability {
  /** The largest iris move over the eyes it could follow, px (0 when it could follow none). */
  irisDriftPx: number;
  /** Mean |RGB| change, 0..255, inside the face outside the brow+lid band. */
  outsideBandMean: number;
  /** Mean |RGB| change, 0..255, inside the band (and the face). */
  bandMean: number;
  /** Per eye name, its iris move (px), or "unsure" when the edit hides it. */
  eyes: Record<string, number | "unsure">;
}

/**
 * The stability of `variant` (an edited portrait, or the rig composited with a face's patches)
 * against `base` (the portrait, or the rig at rest), both canvas-size: see the header. `face` is the
 * hard face shape (`faceShape`), `eyes` the irises to follow (white and dark eyes by `trackIris`,
 * glowing ones by measuring the light again).
 */
export function faceStability(variant: Rgba, base: Rgba, rig: Pick<Rig, "width" | "height" | "layers">, face: Mask, eyes: Readonly<Record<string, StabilityEye>>, reach: BandReach = {}): FaceStability {
  if (variant.width !== base.width || variant.height !== base.height || base.width !== rig.width || base.height !== rig.height) {
    throw new RangeError(`faceStability: variant ${variant.width}x${variant.height}, base ${base.width}x${base.height}, rig ${rig.width}x${rig.height}`);
  }
  const band = browLidBand(rig, reach);
  let inSum = 0;
  let inN = 0;
  let outSum = 0;
  let outN = 0;
  for (let i = 0; i < rig.width * rig.height; i++) {
    if ((face.data[i] ?? 0) === 0) continue;
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs((variant.data[i * 4 + c] ?? 0) - (base.data[i * 4 + c] ?? 0));
    if ((band.data[i] ?? 0) > 0) {
      inSum += d / 3;
      inN++;
    } else {
      outSum += d / 3;
      outN++;
    }
  }
  const out: Record<string, number | "unsure"> = {};
  for (const [name, eye] of Object.entries(eyes)) {
    const { iris } = eye;
    if (eye.look === "glow") {
      // The light's largest disc, sideways only (it sinks as the upper lid lowers), in the base and the face alike.
      const a = glowMiddle(cropImage(base, eye.bbox), eye.tint);
      const b = glowMiddle(cropImage(variant, eye.bbox), eye.tint);
      out[name] = a === undefined || b === undefined ? "unsure" : Math.abs(b - a);
      continue;
    }
    const found = trackIris(base, iris, variant);
    // Unsure when nothing matches, or when the match is barely better than no move (lids over the iris).
    out[name] = found.error > TRACK_UNSURE || found.still - found.error < TRACK_GAIN * found.still ? (found.error <= TRACK_UNSURE && found.still - found.error < TRACK_GAIN * found.still ? 0 : "unsure") : Math.hypot(found.cx - iris.cx, found.cy - iris.cy);
  }
  const moves = Object.values(out).filter((v): v is number => typeof v === "number");
  return {
    irisDriftPx: moves.length === 0 ? 0 : Math.max(...moves),
    outsideBandMean: outN === 0 ? 0 : outSum / outN,
    bandMean: inN === 0 ? 0 : inSum / inN,
    eyes: out,
  };
}

/** The x (px) of the largest disc in the light of a glowing eye's crop, or undefined without light. */
function glowMiddle(crop: Rgba, tint?: readonly [number, number, number]): number | undefined {
  return measureIris({ ...crop, data: crop.data.map((v, i) => (i % 4 === 3 ? 255 : v)) }, { look: "glow", ...(tint === undefined ? {} : { tint }) })?.cx;
}

/** The outside-band limit for an editor whose re-render floor is `floor` (see IRIS_DRIFT_LIMIT). */
export const outsideLimit = (floor?: number): number => (floor === undefined ? OUTSIDE_BAND_LIMIT : floor + OUTSIDE_BAND_MARGIN);

/** Whether a face passes the limits (IRIS_DRIFT_LIMIT, `outsideLimit(floor)`). */
export const isStable = (s: Pick<FaceStability, "irisDriftPx" | "outsideBandMean">, floor?: number): boolean => s.irisDriftPx <= IRIS_DRIFT_LIMIT && s.outsideBandMean <= outsideLimit(floor);

/** registerEdit's search: scales (share either way, step) and moves (canvas px either way). */
export const REGISTER_SCALE = 0.06;
export const REGISTER_SCALE_STEP = 0.005;
export const REGISTER_MOVE = 24;

/** `image` scaled by `s` about (cx, cy) and moved by (dx, dy), bilinear, canvas-size (outside: edge pixels). */
export function warpEdit(image: Rgba, s: number, dx: number, dy: number, cx: number, cy: number): Rgba {
  const { width: w, height: h } = image;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1.001, Math.max(0, (x + 0.5 - cx - dx) / s + cx - 0.5));
      const sy = Math.min(h - 1.001, Math.max(0, (y + 0.5 - cy - dy) / s + cy - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 4; c++) {
        const at = (xx: number, yy: number) => image.data[(yy * w + xx) * 4 + c] ?? 0;
        data[(y * w + x) * 4 + c] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      }
    }
  }
  return { width: w, height: h, data };
}

/**
 * The image editors re-render the whole picture, often a few px off and a few percent larger: the
 * scale (about the face's centre) and move that best lay `edited` back on `portrait` over the face
 * outside the brow+lid band (mean |RGB|, every 2nd px, then refined per px), and the edit so warped.
 * Measured and cut after this, a face's numbers are its own change, not the re-render's offset.
 */
export function registerEdit(edited: Rgba, portrait: Rgba, rig: Pick<Rig, "width" | "height" | "layers">, face: Mask, reach: BandReach = {}): { image: Rgba; scale: number; dx: number; dy: number } {
  const band = browLidBand(rig, reach);
  const pts: number[] = [];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < rig.width * rig.height; i++) {
    if ((face.data[i] ?? 0) === 0 || (band.data[i] ?? 0) > 0) continue;
    const x = i % rig.width;
    const y = (i - x) / rig.width;
    sx += x;
    sy += y;
    if (x % 2 === 0 && y % 2 === 0) pts.push(i);
  }
  if (pts.length === 0) return { image: edited, scale: 1, dx: 0, dy: 0 };
  const n = pts.length * 4;
  const cx = sx / n + 0.5;
  const cy = sy / n + 0.5;
  const cost = (s: number, dx: number, dy: number, step: number): number => {
    let sum = 0;
    let k = 0;
    for (let j = 0; j < pts.length; j += step) {
      const i = pts[j] ?? 0;
      const x = i % rig.width;
      const y = (i - x) / rig.width;
      const ex = Math.round((x + 0.5 - cx - dx) / s + cx - 0.5);
      const ey = Math.round((y + 0.5 - cy - dy) / s + cy - 0.5);
      if (ex < 0 || ey < 0 || ex >= edited.width || ey >= edited.height) continue;
      const e = (ey * edited.width + ex) * 4;
      for (let c = 0; c < 3; c++) sum += Math.abs((portrait.data[i * 4 + c] ?? 0) - (edited.data[e + c] ?? 0));
      k++;
    }
    return k === 0 ? Infinity : sum / k;
  };
  let best = { s: 1, dx: 0, dy: 0, c: cost(1, 0, 0, 4) };
  for (let s = 1 - REGISTER_SCALE; s <= 1 + REGISTER_SCALE + 1e-9; s += REGISTER_SCALE_STEP) {
    for (let dy = -REGISTER_MOVE; dy <= REGISTER_MOVE; dy += 3) {
      for (let dx = -REGISTER_MOVE; dx <= REGISTER_MOVE; dx += 3) {
        const c = cost(s, dx, dy, 4);
        if (c < best.c) best = { s, dx, dy, c };
      }
    }
  }
  const coarse = best;
  best = { ...coarse, c: cost(coarse.s, coarse.dx, coarse.dy, 1) };
  for (let s = coarse.s - REGISTER_SCALE_STEP; s <= coarse.s + REGISTER_SCALE_STEP + 1e-9; s += REGISTER_SCALE_STEP / 2) {
    for (let dy = coarse.dy - 2; dy <= coarse.dy + 2; dy++) {
      for (let dx = coarse.dx - 2; dx <= coarse.dx + 2; dx++) {
        const c = cost(s, dx, dy, 1);
        if (c < best.c) best = { s, dx, dy, c };
      }
    }
  }
  if (best.s === 1 && best.dx === 0 && best.dy === 0) return { image: edited, scale: 1, dx: 0, dy: 0 };
  return { image: warpEdit(edited, best.s, best.dx, best.dy, cx, cy), scale: best.s, dx: best.dx, dy: best.dy };
}
