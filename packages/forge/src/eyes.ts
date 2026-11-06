// Eye anatomy (face-control, WP-B): where an eye layer's lids open (`openingBits`, `socketBits`) and
// where its iris sits (`measureIris`), from the eye layer's own pixels. Three kinds of painted eye:
//   white  sclera around a painted iris (Saint Cardia, Sister Vesper): the iris is what is not white
//          inside the opening (or what the iris-free edit repainted), a disc by its widest rows;
//   glow   a lit opening with no iris drawn (Auntie Asp's orange slits): the iris is the largest
//          disc inside the light;
//   dark   a dark eyeball filling the opening (the Moth Widow's compound eyes): the largest disc
//          inside the eyeball.
// The iris-free edit of the same eye (`clean`), when there is one, shows the opening exactly: the
// white it painted. Every measure returns undefined when it is unsure; that eye then stays one
// painted piece. Coordinates are the eye image's own pixels, pixel centres at +0.5. Pure.
import { fillHoles, inscribedDisc, keepComponent, medianColour, opaqueAt, px, spanFill, type Bits, type Disc } from "./eyeBits.js";
import { luma } from "./mask.js";
import type { Rgba } from "./types.js";

export { EYE_OPAQUE, bitsToImage, imageToBits, medianColour } from "./eyeBits.js";

export type EyeLook = "white" | "glow" | "dark";

/** An iris disc in eye-image px. */
export type Iris = Disc;

/** Cues for reading an eye: its kind, the iris-free edit, the light's colour, the base's references. */
export interface EyeCues {
  look?: EyeLook;
  /** The same eye with the iris painted out (the iris-free edit), same size. */
  clean?: Rgba;
  /** A glowing eye's colour (the palette's eye colour), [r, g, b]. */
  tint?: readonly [number, number, number];
  /** The white's colour in the eye as painted (a face reads its base's). */
  sclera?: readonly [number, number, number];
  /** A dark eye's eyeball colour (a face reads its base's). */
  eyeball?: readonly [number, number, number];
  /** A face: whether its pixel (x, y) shows iris (matches the base's iris where it moved to). */
  irisAt?: (x: number, y: number) => boolean;
  /**
   * A mask edit of the same eye (the cast's: scripts/cast/eyes.mjs), same size: the opening painted
   * pure green, the iris pure magenta (`markOf`). It replaces the measures it covers.
   */
  marks?: Rgba;
}

/** What a mask edit painted at pixel i: "open" (green), "iris" (magenta) or undefined. */
export function markOf(marks: Rgba, i: number): "open" | "iris" | undefined {
  const [r, g, b] = px(marks, i);
  if (g >= 170 && r <= 110 && b <= 110) return "open";
  if (r >= 170 && b >= 170 && g <= 110) return "iris";
  return undefined;
}

/** The least summed |RGB| difference from the iris-free edit that marks the edit's repaint. */
export const OPEN_DIFF = 30;
/** The opening in the edit: repainted pixels within this RGB distance of the edit's white. */
export const WHITE_DIST = 50;
/** Sclera: chroma (max - min) at most this, luma at least SCLERA_LUMA_FLOOR. */
export const SCLERA_CHROMA = 45;
export const SCLERA_LUMA_FLOOR = 100;
/** A face's pixel is sclera within this RGB distance of the sclera colour, eyeball within EYEBALL_DIST. */
export const SCLERA_DIST = 70;
export const EYEBALL_DIST = 45;
/** Glow: chromaticity distance to the tint at most this, luma at least GLOW_LUMA of the tint's. */
export const GLOW_CHROMA_DIST = 0.12;
export const GLOW_LUMA = 0.45;
/** The opening's largest share of the eye's opaque pixels: measured, and named by a mask edit. */
export const OPEN_MAX = 0.7;
export const OPEN_MAX_MARKED = 0.9;
/** The smallest iris radius (px) worth a layer. */
export const IRIS_MIN_R = 2.5;
/** A pixel the iris-free edit changed by more than this summed |RGB| was iris. */
export const IRIS_DIFF = 90;

const chroma = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b);
const dist3 = (a: readonly number[], b: readonly number[]): number => Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
const lumaOf = (c: readonly number[]): number => luma(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
const count = (bits: Bits): number => bits.reduce((s, v) => s + v, 0);

/** Pixels of a glowing eye that are its light: near the tint's chromaticity and bright enough. */
export function glowBits(eye: Rgba, tint?: readonly [number, number, number]): Bits {
  const n = eye.width * eye.height;
  const out = new Uint8Array(n);
  const sum = tint === undefined ? 0 : tint[0] + tint[1] + tint[2];
  for (let i = 0; i < n; i++) {
    if (!opaqueAt(eye, i)) continue;
    const [r, g, b] = px(eye, i);
    if (tint === undefined || sum === 0) {
      out[i] = chroma(r, g, b) > 80 && luma(r, g, b) > 80 ? 1 : 0;
      continue;
    }
    const s = Math.max(1, r + g + b);
    const d = Math.hypot(r / s - tint[0] / sum, g / s - tint[1] / sum, b / s - tint[2] / sum);
    out[i] = d <= GLOW_CHROMA_DIST && luma(r, g, b) >= GLOW_LUMA * luma(tint[0], tint[1], tint[2]) ? 1 : 0;
  }
  return out;
}

/** Otsu's threshold of the opaque pixels' luma. */
export function otsuLuma(eye: Rgba): number {
  const hist = new Array<number>(256).fill(0);
  let n = 0;
  for (let i = 0; i < eye.width * eye.height; i++) {
    if (!opaqueAt(eye, i)) continue;
    const [r, g, b] = px(eye, i);
    const v = Math.round(luma(r, g, b));
    hist[v] = (hist[v] ?? 0) + 1;
    n++;
  }
  let total = 0;
  hist.forEach((c, v) => (total += c * v));
  let best = 0;
  let at = 128;
  let wB = 0;
  let sumB = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] ?? 0;
    if (wB === 0 || wB === n) continue;
    sumB += t * (hist[t] ?? 0);
    const between = wB * (n - wB) * (sumB / wB - (total - sumB) / (n - wB)) ** 2;
    if (between > best) {
      best = between;
      at = t + 0.5;
    }
  }
  return at;
}

/** The sclera of a white eye: light, unsaturated, opaque pixels (luma floor from the eye's brightest). */
function scleraBits(eye: Rgba): Bits {
  const n = eye.width * eye.height;
  const lumas: number[] = [];
  for (let i = 0; i < n; i++) if (opaqueAt(eye, i)) lumas.push(lumaOf(px(eye, i)));
  lumas.sort((a, b) => a - b);
  const floor = Math.max(SCLERA_LUMA_FLOOR, (lumas[Math.floor(lumas.length * 0.95)] ?? 255) - 45);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = px(eye, i);
    out[i] = opaqueAt(eye, i) && luma(r, g, b) >= floor && chroma(r, g, b) <= SCLERA_CHROMA ? 1 : 0;
  }
  return out;
}

/** Bits set where any 4-neighbour of a set pixel is set (`grow`) or where all are (`!grow`). */
function morph(bits: Bits, w: number, h: number, grow: boolean): Bits {
  return bits.map((v, i) => {
    const x = i % w;
    const y = (i - x) / w;
    const n = [x > 0 ? bits[i - 1] : 0, x < w - 1 ? bits[i + 1] : 0, y > 0 ? bits[i - w] : 0, y < h - 1 ? bits[i + w] : 0];
    return grow ? (v === 1 || n.some((k) => k === 1) ? 1 : 0) : v === 1 && n.every((k) => k === 1) ? 1 : 0;
  });
}

/**
 * The opening as the iris-free edit shows it: its pixels within WHITE_DIST of its white (the median
 * edit colour where it repainted most, over Otsu's threshold of the differences), opened by one pixel
 * (thin noise falls away), the component the edit repainted (OPEN_DIFF) most of, grown back.
 */
function editOpening(eye: Rgba, clean: Rgba): Bits | undefined {
  const { width: w, height: h } = eye;
  const diff = new Uint8ClampedArray(w * h * 4);
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px(eye, i);
    const b = px(clean, i);
    d[i] = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    diff.fill(Math.min(255, (d[i] ?? 0) / 3), i * 4, i * 4 + 3);
    diff[i * 4 + 3] = a[3];
  }
  const most = otsuLuma({ width: w, height: h, data: diff });
  const white = medianColour(clean, (i) => opaqueAt(eye, i) && (diff[i * 4] ?? 0) >= most);
  if (white === undefined) return undefined;
  const like = new Uint8Array(w * h).map((_, i) => (opaqueAt(eye, i) && dist3(px(clean, i), white) <= WHITE_DIST ? 1 : 0));
  const core = keepComponent(morph(like, w, h, false), w, h, (i) => (d[i] ?? 0) >= OPEN_DIFF);
  return core.some((v) => v === 1) ? morph(core, w, h, true).map((v, i) => v & (like[i] ?? 0)) : undefined;
}

/**
 * The lid opening of an eye as 0/1 bits, from the eye alone (no iris needed): the light of a glowing
 * eye; with `clean`, the edit's white; else the white's row/column spans (white) or the dark under
 * Otsu's threshold (dark). Holes and spans filled; undefined under 12 px or over OPEN_MAX of the eye
 * (OPEN_MAX_MARKED with a mask edit).
 */
export function openingBits(eye: Rgba, cues: EyeCues = {}): Bits | undefined {
  const { width: w, height: h } = eye;
  const look = cues.look ?? "white";
  let region: Bits | undefined;
  const marks = cues.marks;
  if (marks !== undefined) {
    // Closed by one pixel: the resized mask blends a seam between green and magenta that is neither.
    const painted = new Uint8Array(w * h).map((_, i) => (opaqueAt(eye, i) && markOf(marks, i) !== undefined ? 1 : 0));
    region = keepComponent(morph(morph(painted, w, h, true), w, h, false), w, h);
  }
  else if (look === "glow") region = keepComponent(glowBits(eye, cues.tint), w, h);
  else if (cues.clean !== undefined) region = editOpening(eye, cues.clean);
  else if (look === "white") region = keepComponent(spanFill(scleraBits(eye), w, h), w, h);
  else {
    const below = otsuLuma(eye);
    const dark = new Uint8Array(w * h).map((_, i) => (opaqueAt(eye, i) && lumaOf(px(eye, i)) < below ? 1 : 0));
    region = keepComponent(dark, w, h, (i) => Math.abs((i % w) - w / 2) < w / 4 && Math.abs(Math.floor(i / w) - h / 2) < h / 4);
  }
  if (region === undefined) return undefined;
  const bits = spanFill(fillHoles(region, w, h), w, h);
  for (let i = 0; i < w * h; i++) if (!opaqueAt(eye, i)) bits[i] = 0;
  // An opening is part of the eye, never the whole of it (a skin-coloured eye found no white); a mask
  // edit names it, so a tightly cut eye may be mostly opening (cast-face-pass: Lot Ninety's 73%).
  const opaque = [...Array(w * h).keys()].filter((i) => opaqueAt(eye, i)).length;
  return count(bits) < 12 || count(bits) > (marks === undefined ? OPEN_MAX : OPEN_MAX_MARKED) * opaque ? undefined : bits;
}

/** The white's colour in `eye`: the median of the brighter half of the opening. */
export function scleraColour(eye: Rgba, opening: Bits): [number, number, number] | undefined {
  const lumas = [...opening.keys()].filter((i) => opening[i] === 1).map((i) => lumaOf(px(eye, i))).sort((a, b) => a - b);
  const mid = lumas[Math.floor(lumas.length / 2)] ?? 0;
  return medianColour(eye, (i) => opening[i] === 1 && lumaOf(px(eye, i)) >= mid);
}

/** A dark eye's eyeball colour: the median of the darker half of the opening. */
export function eyeballColour(eye: Rgba, opening: Bits): [number, number, number] | undefined {
  const lumas = [...opening.keys()].filter((i) => opening[i] === 1).map((i) => lumaOf(px(eye, i))).sort((a, b) => a - b);
  const mid = lumas[Math.floor(lumas.length / 2)] ?? 0;
  return medianColour(eye, (i) => opening[i] === 1 && lumaOf(px(eye, i)) <= mid);
}

/**
 * The iris of a white eye inside its opening: what the iris-free edit repainted (summed |RGB| over
 * IRIS_DIFF), else what is not white (beyond SCLERA_DIST of the white's colour); the largest piece,
 * holes filled (pupil highlights).
 */
function whiteIris(eye: Rgba, opening: Bits, white: readonly number[], clean?: Rgba): Bits {
  const { width: w, height: h } = eye;
  const bits = new Uint8Array(w * h).map((_, i) => {
    if (opening[i] !== 1) return 0;
    const a = px(eye, i);
    if (clean === undefined) return dist3(a, white) > SCLERA_DIST ? 1 : 0;
    const b = px(clean, i);
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > IRIS_DIFF ? 1 : 0;
  });
  return fillHoles(keepComponent(bits, w, h), w, h);
}

/** A disc from its widest rows: an iris cut by its lids keeps its full width across its middle. */
function widestRows(bits: Bits, w: number, h: number): Iris | undefined {
  const rows: { y: number; a: number; b: number }[] = [];
  for (let y = 0; y < h; y++) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < w; x++) if (bits[y * w + x] === 1) {
        a = a < 0 ? x : a;
        b = x;
      }
    if (a >= 0) rows.push({ y, a, b });
  }
  const widest = Math.max(0, ...rows.map((r) => r.b - r.a + 1));
  const top = rows.filter((r) => r.b - r.a + 1 >= widest - 1);
  if (widest === 0) return undefined;
  return { cx: top.reduce((s, r) => s + (r.a + r.b + 1) / 2, 0) / top.length, cy: top.reduce((s, r) => s + r.y, 0) / top.length + 0.5, r: widest / 2 };
}

/**
 * The iris disc of an eye layer (see the header), or undefined when unsure: no opening, no iris
 * edge, a radius under IRIS_MIN_R or wider than 0.9 of the eye.
 */
export function measureIris(eye: Rgba, cues: EyeCues = {}): Iris | undefined {
  const opening = openingBits(eye, cues);
  if (opening === undefined) return undefined;
  const look = cues.look ?? "white";
  let iris: Iris | undefined;
  const marks = cues.marks;
  if (look === "white" && marks !== undefined) {
    const painted = new Uint8Array(eye.width * eye.height).map((_, i) => (opening[i] === 1 && markOf(marks, i) === "iris" ? 1 : 0));
    iris = widestRows(fillHoles(keepComponent(painted, eye.width, eye.height), eye.width, eye.height), eye.width, eye.height);
  } else if (look === "white") {
    const white = cues.sclera ?? scleraColour(eye, opening);
    iris = white === undefined ? undefined : widestRows(whiteIris(eye, opening, white, cues.clean), eye.width, eye.height);
  } else iris = inscribedDisc(opening, eye.width, eye.height);
  if (iris === undefined || iris.r < IRIS_MIN_R || 2 * iris.r > 0.9 * Math.max(eye.width, eye.height)) return undefined;
  return iris;
}

/** Whether eye pixel i (pixel centre) lies within `r + grow` of the disc's centre. */
export const inDisc = (iris: Iris, w: number, i: number, grow = 0): boolean => Math.hypot((i % w) + 0.5 - iris.cx, Math.floor(i / w) + 0.5 - iris.cy) <= iris.r + grow;

/**
 * The lid opening around `iris` as 0/1 bits. A base eye: `openingBits`. A face (`irisAt` given):
 * its pixels like the base's white (white), eyeball (dark) or light (glow), joined to the moved
 * iris where it shows, spans and holes filled (a face's may be empty: shut lids). Undefined when a
 * base eye's is smaller than 0.3 of the iris disc, or either covers more than 0.95 of the eye.
 */
export function socketBits(eye: Rgba, iris: Iris, cues: EyeCues = {}): Bits | undefined {
  const { width: w, height: h } = eye;
  const look = cues.look ?? "white";
  let bits: Bits | undefined;
  if (cues.irisAt === undefined) bits = openingBits(eye, cues);
  else {
    const like = look === "glow" ? glowBits(eye, cues.tint) : new Uint8Array(w * h);
    const ref = look === "white" ? cues.sclera : cues.eyeball;
    for (let i = 0; look !== "glow" && i < w * h; i++) {
      if (!opaqueAt(eye, i) || ref === undefined) continue;
      const c = px(eye, i);
      like[i] = look === "white" ? (dist3(c, ref) <= SCLERA_DIST && lumaOf(c) >= lumaOf(ref) - SCLERA_DIST ? 1 : 0) : dist3(c, ref) <= EYEBALL_DIST ? 1 : 0;
    }
    for (let i = 0; i < w * h; i++) if (inDisc(iris, w, i) && opaqueAt(eye, i) && cues.irisAt(i % w, Math.floor(i / w))) like[i] = 1;
    // Opened by one pixel (a lid's dark edge touching the opening falls away), holes filled; no spans (a lowered lid cuts across).
    const opened = morph(morph(like, w, h, false), w, h, true);
    bits = fillHoles(keepComponent(opened, w, h, (i) => inDisc(iris, w, i)), w, h);
    for (let i = 0; i < w * h; i++) if (!opaqueAt(eye, i)) bits[i] = 0;
  }
  if (bits === undefined) return undefined;
  const opaque = [...Array(w * h).keys()].filter((i) => opaqueAt(eye, i)).length;
  const area = count(bits);
  // A face may close its lids (an empty opening is an answer); a base eye must open around its iris.
  const least = cues.irisAt === undefined ? 0.3 * Math.PI * iris.r * iris.r : 0;
  return area < least || area > 0.95 * opaque ? undefined : bits;
}
