// Eye art (face-control, WP-B): from an eye layer, its measured iris and socket (eyes.ts), the
// pieces a socketed eye is drawn from: the iris-free eye (`cleanEye`: the iris-free edit inside the
// socket, or a procedural fill), the iris layer image (`irisImage`: the iris pixels in a feathered
// disc, completed where the lids hid them), the closed-lid art (`closedArt`: the plate under the eye,
// or the upper lid drawn down when the plate is no lid). One prompt (`irisFreePrompt`) serves the
// cast (Codex CLI) and the live forge (Gemini). Pure: images in, fresh images out.
import { luma } from "./mask.js";
import { EYE_OPAQUE, inDisc, medianColour, type EyeLook, type Iris } from "./eyes.js";
import type { Rgba } from "./types.js";

const withStyle = (frame: string, style?: string): string => (style === undefined || style.trim() === "" ? frame : `${frame} The art style is ${style.trim()}.`);

/**
 * The iris-free edit: paint the whites where the irises are, nothing else. forge-creator C3:
 * `material` (eyesMaterial's sentence, from the brief's "Its eyes are ..." line) swaps the human
 * frame for one in the character's own material: the central light or spot is filled with the eye's
 * own material, no whites, no eyeballs. Without it the prompt is byte-identical to before C3.
 */
export function irisFreePrompt(name: string, style?: string, material?: string): string {
  const said = material?.trim() ?? "";
  const frame =
    said === ""
      ? `Edit this portrait of ${name}. In both eyes, remove the irises and pupils and paint the white of the eye in their place, so each eye opening shows only its white, shaded like the rest of that white. Keep the eyelids, lashes, lid lines, the eye openings' shape and size, and every other pixel of the image exactly as it is: do not close, move or reshape the eyes, and do not change the brows, face, hair, colours, lighting or background.`
      : `Edit this portrait of ${name}. ${said} In both eyes, remove only the small central light, pupil or spot and fill its place with the same material, colour and shading as the rest of that eye, so each eye keeps its outline and reads as empty. Keep the eye openings' shape and size, and every other pixel of the image exactly as it is: do not close, move or reshape the eyes, and do not change the face, hair, colours, lighting or background.`;
  return withStyle(frame, style);
}

/**
 * The closed-eyes edit: the closed-lid art a blink crossfades to. forge-creator C3: `material`
 * closes the eyes in that material, as the offline CLOSED prompts do (scripts/cast/five/prompts.mjs:
 * a candle gone out, a neon ring's lower arc, a glass pane over the disc): no skin lids, no lashes.
 */
export function closedEyesPrompt(name: string, style?: string, material?: string): string {
  const said = material?.trim() ?? "";
  const frame =
    said === ""
      ? `Edit this portrait of ${name}. Close both eyes: paint the upper eyelids lowered all the way down to meet the lower lids, with the lashes along the closed lid line, in the same skin, shading and art style as the lids around them. Keep the brows, the lid creases above, the face and every other pixel of the image exactly as it is.`
      : `Edit this portrait of ${name}. ${said} Close both eyes in that same material, the way such a thing shuts or goes dark (a light switched off, a hole covered, a slit narrowed to a line, a pane drawn over), with no eyelids of skin, no lashes and no eyeballs. Keep the exact place and outline of both eyes, and every other pixel of the image exactly as it is, including the mouth.`;
  return withStyle(frame, style);
}

/** Near the iris (1.8 radii), a pixel the iris-free edit changed by more than this summed |RGB| was iris light. */
export const STRAY_DIFF = 120;
/** A glowing eye's socket, iris-free: its light dimmed to this share (the iris carries the glow). */
export const GLOW_DIM = 0.45;
/** The iris image's edge feather (px) and margin around the disc. */
export const IRIS_FEATHER = 1.5;
/** How far (px) past the iris disc a procedural fill reaches, feathered over IRIS_FEATHER. */
export const FILL_GROW = 1.5;
/** The closed art is no lid when its socket is darker than this share of the eye's lid luma. */
export const CLOSED_MIN_LUMA = 0.55;

type Bits = Uint8Array;

const copy = (img: Rgba): Rgba => ({ width: img.width, height: img.height, data: img.data.slice() });
const lumaAt = (img: Rgba, i: number): number => luma(img.data[i * 4] ?? 0, img.data[i * 4 + 1] ?? 0, img.data[i * 4 + 2] ?? 0);

function blend(out: Rgba, i: number, rgb: readonly number[], w: number): void {
  for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round((out.data[i * 4 + c] ?? 0) * (1 - w) + (rgb[c] ?? 0) * w);
}

/** Weight of a fill at pixel i: 1 inside the disc grown by FILL_GROW, ramping to 0 over IRIS_FEATHER. */
const discWeight = (iris: Iris, w: number, i: number): number => {
  const d = Math.hypot((i % w) + 0.5 - iris.cx, Math.floor(i / w) + 0.5 - iris.cy);
  return Math.max(0, Math.min(1, (iris.r + FILL_GROW + IRIS_FEATHER - d) / IRIS_FEATHER));
};

/** The colour of the sclera on row y (rows y-2..y+2, socket pixels outside the disc), else `fallback`. */
function rowSclera(eye: Rgba, iris: Iris, socket: Bits, y: number, fallback?: readonly number[]): readonly number[] | undefined {
  const w = eye.width;
  const row = medianColour(eye, (i) => Math.abs(Math.floor(i / w) - y) <= 2 && socket[i] === 1 && !inDisc(iris, w, i, FILL_GROW + 1));
  return row ?? fallback;
}

export interface CleanCues {
  look: EyeLook;
  /** The iris-free edit cropped to the eye (white eyes): used across the whole socket. */
  clean?: Rgba;
  /** A variant: its base's iris-free eye and socket, used inside the disc where the base socket was open. */
  base?: { eye: Rgba; socket: Bits };
  /** The sclera colour when a row has none of its own. */
  sclera?: readonly number[];
}

/**
 * The eye with its iris painted out. White with `clean`: the edit's pixels across the socket (the
 * lids stay the layer's own). White without: inside the disc (grown, feathered) and the socket, the
 * base's iris-free pixels where the base socket was open, else each row's sclera colour. Glow: the
 * socket's light times GLOW_DIM. Dark: inside the disc, the eyeball's darkest quartile colour.
 */
export function cleanEye(eye: Rgba, iris: Iris, socket: Bits, cues: CleanCues): Rgba {
  const out = copy(eye);
  const w = eye.width;
  const n = w * eye.height;
  if (cues.look === "glow") {
    for (let i = 0; i < n; i++) if (socket[i] === 1) for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round((eye.data[i * 4 + c] ?? 0) * GLOW_DIM);
    return out;
  }
  if (cues.look === "white" && cues.clean !== undefined) {
    // The socket, and near the iris whatever the edit repainted hard (a pupil's glow running onto the lid).
    const clean = cues.clean;
    for (let i = 0; i < n; i++) {
      const d = Math.abs((eye.data[i * 4] ?? 0) - (clean.data[i * 4] ?? 0)) + Math.abs((eye.data[i * 4 + 1] ?? 0) - (clean.data[i * 4 + 1] ?? 0)) + Math.abs((eye.data[i * 4 + 2] ?? 0) - (clean.data[i * 4 + 2] ?? 0));
      const near = Math.hypot((i % w) + 0.5 - iris.cx, Math.floor(i / w) + 0.5 - iris.cy) <= 1.8 * iris.r;
      if (socket[i] === 1 || (near && d > STRAY_DIFF)) blend(out, i, [clean.data[i * 4] ?? 0, clean.data[i * 4 + 1] ?? 0, clean.data[i * 4 + 2] ?? 0], 1);
    }
    return out;
  }
  let dark: readonly number[] | undefined;
  if (cues.look === "dark") {
    const lumas = [...Array(n).keys()].filter((i) => socket[i] === 1).map((i) => lumaAt(eye, i)).sort((a, b) => a - b);
    const q = lumas[Math.floor(lumas.length * 0.25)] ?? 0;
    dark = medianColour(eye, (i) => socket[i] === 1 && lumaAt(eye, i) <= q);
  }
  const rows = new Map<number, readonly number[] | undefined>();
  for (let i = 0; i < n; i++) {
    if (socket[i] !== 1) continue;
    const k = discWeight(iris, w, i);
    if (k === 0) continue;
    if (dark !== undefined) {
      blend(out, i, dark, k);
      continue;
    }
    const base = cues.base;
    if (base !== undefined && base.socket[i] === 1) {
      blend(out, i, [base.eye.data[i * 4] ?? 0, base.eye.data[i * 4 + 1] ?? 0, base.eye.data[i * 4 + 2] ?? 0], k);
      continue;
    }
    const y = Math.floor(i / w);
    if (!rows.has(y)) rows.set(y, rowSclera(eye, iris, socket, y, cues.sclera));
    const rgb = rows.get(y);
    if (rgb !== undefined) blend(out, i, rgb, k);
  }
  return out;
}

/** An iris layer's image: `image` placed at `box` (eye-local [x, y, w, h]), its centre the iris centre. */
export interface IrisArt {
  image: Rgba;
  box: [x: number, y: number, w: number, h: number];
}

/**
 * The iris pixels in a disc feathered over IRIS_FEATHER. A disc pixel the lids hid (outside the
 * socket) takes its mirror across the centre row, else across the centre column, when that one shows,
 * else the median of the showing iris at its radius (1 px rings), else of the whole showing iris.
 */
export function irisImage(eye: Rgba, iris: Iris, socket: Bits): IrisArt {
  const w = eye.width;
  const h = eye.height;
  const x0 = Math.floor(iris.cx - iris.r - IRIS_FEATHER);
  const y0 = Math.floor(iris.cy - iris.r - IRIS_FEATHER);
  const bw = Math.ceil(iris.cx + iris.r + IRIS_FEATHER) - x0;
  const bh = Math.ceil(iris.cy + iris.r + IRIS_FEATHER) - y0;
  const shows = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && socket[y * w + x] === 1 && Math.hypot(x + 0.5 - iris.cx, y + 0.5 - iris.cy) <= iris.r && (eye.data[(y * w + x) * 4 + 3] ?? 0) >= EYE_OPAQUE;
  const ring = new Map<number, readonly number[] | undefined>();
  const ringColour = (k: number): readonly number[] | undefined => {
    if (!ring.has(k)) ring.set(k, medianColour(eye, (i) => shows(i % w, Math.floor(i / w)) && Math.round(Math.hypot((i % w) + 0.5 - iris.cx, Math.floor(i / w) + 0.5 - iris.cy)) === k));
    return ring.get(k);
  };
  const all = medianColour(eye, (i) => shows(i % w, Math.floor(i / w))) ?? [0, 0, 0];
  const data = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const ex = x0 + x;
      const ey = y0 + y;
      const d = Math.hypot(ex + 0.5 - iris.cx, ey + 0.5 - iris.cy);
      const a = Math.max(0, Math.min(1, (iris.r + IRIS_FEATHER / 2 - d) / IRIS_FEATHER));
      if (a === 0) continue;
      const my = Math.round(2 * iris.cy - ey - 1);
      const mx = Math.round(2 * iris.cx - ex - 1);
      const from = shows(ex, ey) ? [ex, ey] : shows(ex, my) ? [ex, my] : shows(mx, ey) ? [mx, ey] : undefined;
      const rgb = from === undefined ? (ringColour(Math.round(d)) ?? all) : [0, 1, 2].map((c) => eye.data[((from[1] ?? 0) * w + (from[0] ?? 0)) * 4 + c] ?? 0);
      const o = (y * bw + x) * 4;
      data[o] = rgb[0] ?? 0;
      data[o + 1] = rgb[1] ?? 0;
      data[o + 2] = rgb[2] ?? 0;
      data[o + 3] = Math.round(255 * a);
    }
  }
  return { image: { width: bw, height: bh, data }, box: [x0, y0, bw, bh] };
}

/** The upper lid drawn down over the socket: each column's lid colour, shaded toward a lash line. */
export function paintedLids(eye: Rgba, socket: Bits): Rgba {
  const out = copy(eye);
  const w = eye.width;
  const h = eye.height;
  const lidAll = medianColour(eye, (i) => socket[i] === 0) ?? [128, 128, 128];
  const lumas = [...Array(w * h).keys()].filter((i) => socket[i] === 0 && (eye.data[i * 4 + 3] ?? 0) >= EYE_OPAQUE).map((i) => lumaAt(eye, i)).sort((a, b) => a - b);
  const q = lumas[Math.floor(lumas.length * 0.1)] ?? 0;
  const lash = medianColour(eye, (i) => socket[i] === 0 && lumaAt(eye, i) <= q) ?? [20, 20, 20];
  for (let x = 0; x < w; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) if (socket[y * w + x] === 1) {
        top = top < 0 ? y : top;
        bottom = y;
      }
    if (top < 0) continue;
    const above = [top - 2, top - 3, top - 1].find((y) => y >= 0 && socket[y * w + x] === 0 && (eye.data[(y * w + x) * 4 + 3] ?? 0) >= EYE_OPAQUE);
    const lid = above === undefined ? lidAll : [0, 1, 2].map((c) => eye.data[(above * w + x) * 4 + c] ?? 0);
    for (let y = top; y <= bottom; y++) {
      const t = bottom === top ? 1 : (y - top) / (bottom - top);
      const shade = lid.map((v) => v * (1 - 0.2 * t));
      const i = y * w + x;
      blend(out, i, shade, 1);
      if (bottom - y < 2) blend(out, i, lash, 0.7);
    }
  }
  return out;
}

/**
 * The closed-lid art (same size as the eye, its alpha): `below` (the layers under the eye, cropped to
 * the eye's bbox: the fill plate painted shut lids there) when its socket reads as lid, else
 * `paintedLids`. It reads as lid unless its socket's mean luma is under CLOSED_MIN_LUMA of the eye's
 * pixels outside the socket (a plate painted an empty dark socket). `fromPlate` says which.
 */
export function closedArt(eye: Rgba, below: Rgba, socket: Bits): { image: Rgba; fromPlate: boolean } {
  const n = eye.width * eye.height;
  let inside = 0;
  let ni = 0;
  let outside = 0;
  let no = 0;
  for (let i = 0; i < n; i++) {
    if ((eye.data[i * 4 + 3] ?? 0) < EYE_OPAQUE) continue;
    if (socket[i] === 1) {
      inside += lumaAt(below, i);
      ni++;
    } else {
      outside += lumaAt(eye, i);
      no++;
    }
  }
  const lid = ni > 0 && no > 0 && inside / ni >= CLOSED_MIN_LUMA * (outside / no);
  if (!lid) return { image: paintedLids(eye, socket), fromPlate: false };
  const out = copy(below);
  for (let i = 0; i < n; i++) out.data[i * 4 + 3] = eye.data[i * 4 + 3] ?? 0;
  return { image: out, fromPlate: true };
}

/** The closed art reaches CLOSED_GROW px past the socket, then fades into the eye art over CLOSED_FADE px. */
export const CLOSED_GROW = 2;
export const CLOSED_FADE = 4;

/**
 * `closed` laid into `eye`: the closed art over the socket grown by CLOSED_GROW, fading to the eye's
 * own pixels over CLOSED_FADE px, so a blink changes the opening and never the eye's outline.
 */
export function featherClosed(eye: Rgba, closed: Rgba, socket: Bits): Rgba {
  const w = eye.width;
  const h = eye.height;
  const out = copy(eye);
  let ring = socket;
  const weight = new Float32Array(w * h).map((_, i) => (socket[i] === 1 ? 1 : 0));
  for (let step = 1; step <= CLOSED_GROW + CLOSED_FADE; step++) {
    const from = ring;
    ring = from.map((v, i) => {
      if (v === 1) return 1;
      const x = i % w;
      return (x > 0 && from[i - 1] === 1) || (x < w - 1 && from[i + 1] === 1) || (i >= w && from[i - w] === 1) || (i + w < from.length && from[i + w] === 1) ? 1 : 0;
    });
    const k = step <= CLOSED_GROW ? 1 : 1 - (step - CLOSED_GROW) / (CLOSED_FADE + 1);
    for (let i = 0; i < w * h; i++) if (ring[i] === 1 && weight[i] === 0) weight[i] = k;
  }
  for (let i = 0; i < w * h; i++) {
    const k = weight[i] ?? 0;
    if (k > 0) blend(out, i, [closed.data[i * 4] ?? 0, closed.data[i * 4 + 1] ?? 0, closed.data[i * 4 + 2] ?? 0], k);
  }
  return out;
}
