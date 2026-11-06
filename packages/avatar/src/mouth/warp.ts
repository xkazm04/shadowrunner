// The art mouth (spark art-mouth): the character's own painted lips bent by a warp field instead of a
// drawn mouth. `warpParams` turns this frame's mouth params (mouth/state.ts: visemes or the speech
// level, plus the emotion's bias) and the jaw's drop into the field the GL shader applies to the head
// and the jaw (gl/warp.ts), all in rig px about the forge's measured lips (Rig.mouth.lips; a mouth
// without them is "still", mouth/anchor.ts `mouthMode`). The lips part at the seam (`lips.seam`, else
// the jaw cut `lineY`), which may lie below the cut (Moth Widow: the whole mouth is in the jaw).
// The head and the jaw read ONE field in rig px, so nothing tears at the cut:
// - corners move (width out/in, smile/skew up/down) inside a window wider than the lips;
// - above the seam the lip lifts (open, snarl), below it drops (open, the jaw), by a lens profile
//   that is zero short of the corners; between the two lines both layers show a dark interior
//   (each at its own alpha there, so whichever layer holds the mouth paints it);
// - the jaw layer, which the pose moves down by `gap`, is pinned back by `gap` above the seam and
//   across the lower lip (minus the lens), so the lips do not double-move while the chin still drops;
// - press/tight thin the lips toward the seam, round fills them.
// Every displacement fades to zero over a feather at least FEATHER_K times the displacement, so the
// map stays invertible and nothing outside the window moves. `unwarp` is the shader's inverse,
// statement for statement, so tests pin what the GPU does. Pure, no DOM.
import type { RigMouth } from "@sr/rig";
import { mouthLips } from "./anchor.js";
import type { MouthRgb } from "./colours.js";
import type { MouthParams } from "./shapes.js";

/** Full open parts the lips by this share of the lips' span; the upper lip takes UPPER_SHARE of it. */
export const OPEN_OF_SPAN = 0.28;
export const UPPER_SHARE = 0.35;
/** Snarl lifts the upper lip by this share of its thickness. */
export const SNARL_LIFT = 0.45;
/** Full smile lifts a corner by this share of the lips' span. */
export const CORNER_LIFT = 0.12;
/** The lips part over this share of the corner-to-corner span (the opening ends short of the corners). */
export const INNER_SPAN = 0.84;
/** The opening's profile exponent: < 1 rounds its ends (1 is a parabola, 0.5 an ellipse). */
export const PROFILE_POW = 0.7;
/** A feather (or window margin) is at least this many times the displacement it fades. */
export const FEATHER_K = 2.6;
/** Fixed-point steps of the inverse (shader and `unwarp`). */
export const WARP_STEPS = 8;
/** Below this many rig px everywhere the field is the identity (no warp drawn). */
export const WARP_EPS = 0.01;

/** The warp field this frame, rig px (see the header). Per-layer values (the jaw flag) are separate. */
export interface WarpField {
  cx: number;
  /** Where the lips part at rest (lips.seam, else lineY), kept inside the lips. */
  seam: number;
  /** Half widths of the lips, left and right of cx. */
  hwL: number;
  hwR: number;
  /** Window half widths, left and right of cx (> the lips'). */
  winL: number;
  winR: number;
  /** Upper lip top, lower lip bottom; the feathers above and below them. */
  upper: number;
  lower: number;
  fu: number;
  fd: number;
  /** Upper lip lift and lower lip drop at the centre (>= 0), in the head's frame. */
  lift: number;
  open: number;
  /** The jaw layer's drop below rest in the head's frame (the pose moves the jaw by it). */
  gap: number;
  /** Corner displacements (+x right, +y down). */
  dxL: number;
  dyL: number;
  dxR: number;
  dyR: number;
  /** >0 thins the lips toward the seam (press, tight), <0 fills them (round). */
  squeeze: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The field for `params` on `mouth` with the jaw `gap` rig px below rest, or undefined when there
 * is nothing to bend (no usable lips) or it moves nothing (rest params with the jaw shut).
 */
export function warpParams(params: Readonly<MouthParams>, mouth: RigMouth, gap: number): WarpField | undefined {
  const lips = mouthLips(mouth);
  if (lips === undefined) return undefined;
  const { cx } = mouth;
  const height = lips.lower - lips.upper;
  const seam = clamp(lips.seam ?? mouth.lineY, lips.upper + 0.2 * height, lips.lower - 0.2 * height);
  const hwL = cx - lips.left;
  const hwR = lips.right - cx;
  const span = hwL + hwR;
  const thickUp = seam - lips.upper;
  const thickDown = lips.lower - seam;
  const press = clamp(params.press, 0, 1);
  const keep = 1 - press;
  const tight = clamp(params.tight, 0, 1);
  const parted = clamp(params.open, 0, 1) * OPEN_OF_SPAN * span * keep;
  const lift = UPPER_SHARE * parted + clamp(params.snarl, 0, 1) * SNARL_LIFT * thickUp;
  const g = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const open = Math.max(g * keep, (1 - UPPER_SHARE) * parted);
  const widen = clamp(params.width - 1 - 0.1 * tight, -0.4, 0.3);
  const dxL = -widen * hwL;
  const dxR = widen * hwR;
  const smile = clamp(params.smile, -1, 1);
  const skew = clamp(params.skew, -1, 1);
  const dyL = -clamp(smile - skew, -1, 1) * CORNER_LIFT * span;
  const dyR = -clamp(smile + skew, -1, 1) * CORNER_LIFT * span;
  const squeeze = clamp(0.3 * press + 0.25 * tight - 0.2 * clamp(params.round, 0, 1), -0.25, 0.45);
  const dy = Math.max(Math.abs(dyL), Math.abs(dyR));
  if (Math.max(lift, open, g, Math.abs(dxL), Math.abs(dxR), dy, Math.abs(squeeze) * span) < WARP_EPS) return undefined;
  const winL = hwL + Math.max(0.5 * hwL, FEATHER_K * Math.abs(dxL), 2 * dy);
  const winR = hwR + Math.max(0.5 * hwR, FEATHER_K * Math.abs(dxR), 2 * dy);
  const fu = Math.max(thickUp, 0.1 * span, FEATHER_K * (lift + dy + Math.abs(squeeze) * thickUp));
  const fd = Math.max(thickDown, 0.1 * span, FEATHER_K * (Math.max(open, g) + dy + Math.abs(squeeze) * thickDown));
  return { cx, seam, hwL, hwR, winL, winR, upper: lips.upper, lower: lips.lower, fu, fd, lift, open, gap: g, dxL, dyL, dxR, dyR, squeeze };
}

/** The rig-px box the field can change for a layer (the jaw's spans its own columns: it is pinned). */
export function warpBox(f: WarpField, jawRect?: readonly number[]): [x0: number, y0: number, x1: number, y1: number] {
  let x0 = f.cx - f.winL;
  let x1 = f.cx + f.winR;
  let y0 = f.upper - f.fu;
  if (jawRect !== undefined) {
    x0 = Math.min(x0, jawRect[0] ?? x0);
    x1 = Math.max(x1, (jawRect[0] ?? 0) + (jawRect[2] ?? 0));
    y0 = Math.min(y0, jawRect[1] ?? y0) - f.gap - f.lift;
  }
  return [x0, y0 - 1, x1, f.lower + f.fd + 1];
}

// The field's pieces, one per GLSL function in gl/warp.ts.
const hwOf = (f: WarpField, x: number): number => (x < f.cx ? f.hwL : f.hwR);
const tOf = (f: WarpField, x: number): number => Math.abs(x - f.cx) / hwOf(f, x);
const fadeOf = (f: WarpField, x: number, t: number): number => 1 - smoothstep(1, (x < f.cx ? f.winL : f.winR) / hwOf(f, x), t);
const axOf = (f: WarpField, x: number): number => (tOf(f, x) <= 1 ? tOf(f, x) : fadeOf(f, x, tOf(f, x)));
const ayOf = (f: WarpField, x: number): number => (tOf(f, x) <= 1 ? tOf(f, x) ** 2 : fadeOf(f, x, tOf(f, x)));
const wxOf = (f: WarpField, x: number): number => (tOf(f, x) <= 1 ? 1 : fadeOf(f, x, tOf(f, x)));
const profOf = (f: WarpField, x: number): number => {
  const t = tOf(f, x) / INNER_SPAN;
  return t < 1 ? (1 - t * t) ** PROFILE_POW : 0;
};
const upOf = (f: WarpField, y: number): number => smoothstep(f.upper - f.fu, f.upper, y);
const lowOf = (f: WarpField, y: number): number => 1 - smoothstep(f.lower, f.lower + f.fd, y);
const dxOf = (f: WarpField, x: number, y: number): number => (x < f.cx ? f.dxL : f.dxR) * axOf(f, x) * upOf(f, y) * lowOf(f, y);
const dcOf = (f: WarpField, x: number, y: number): number => {
  const sq = clamp(f.seam - y, f.seam - f.lower, f.seam - f.upper);
  return ((x < f.cx ? f.dyL : f.dyR) * ayOf(f, x) + f.squeeze * sq * wxOf(f, x)) * upOf(f, y) * lowOf(f, y);
};

/**
 * The forward map of a source point (rig px) of the head (`jaw` false) or the jaw, in the layer's
 * own frame (the jaw's pose then adds `gap`). Below the seam the head drops with the lower lip
 * too (whatever of the lip, or the crease, the cut left in the head travels with it).
 */
export function warpPoint(f: WarpField, x: number, y: number, jaw: boolean): [number, number] {
  const pin = jaw ? f.gap : 0;
  const part = y < f.seam ? -f.lift * profOf(f, x) * upOf(f, y) - pin : (f.open * profOf(f, x) - pin) * lowOf(f, y);
  return [x + dxOf(f, x, y), y + dcOf(f, x, y) + part];
}

export interface Unwarped {
  /** Source point, rig px. */
  x: number;
  y: number;
  /** 0..1 share of the dark interior here (the lips parted), at the layer's own alpha. */
  inner: number;
  /** 0 at the upper lip line .. 1 at the lower one (the interior gradient). */
  s: number;
}

/** The inverse of `warpPoint` at shown point (px, py) in the layer's frame; `aa` is half a pixel in rig px. */
export function unwarp(f: WarpField, box: readonly number[], jaw: boolean, px: number, py: number, aa = 0.5): Unwarped {
  if (px < (box[0] ?? 0) || px > (box[2] ?? 0) || py < (box[1] ?? 0) || py > (box[3] ?? 0)) return { x: px, y: py, inner: 0, s: 0 };
  const pin = jaw ? f.gap : 0;
  let qx = px;
  for (let i = 0; i < WARP_STEPS; i += 1) qx = px - dxOf(f, qx, py);
  const prof = profOf(f, qx);
  const base = f.seam + (qx < f.cx ? f.dyL : f.dyR) * ayOf(f, qx) - pin;
  const yu = base - f.lift * prof;
  const yl = base + f.open * prof;
  const s = clamp((py - yu) / Math.max(yl - yu, 1e-3), 0, 1);
  const half = Math.max(aa, 1e-3);
  const inner = clamp((Math.min(yl, py + half) - Math.max(yu, py - half)) / (2 * half), 0, 1);
  let qy = py;
  if (py < 0.5 * (yu + yl)) {
    for (let i = 0; i < WARP_STEPS; i += 1) qy = Math.min(f.seam, py - dcOf(f, qx, qy) + f.lift * prof * upOf(f, qy) + pin);
  } else {
    for (let i = 0; i < WARP_STEPS; i += 1) qy = Math.max(f.seam, py - dcOf(f, qx, qy) - (f.open * prof - pin) * lowOf(f, qy));
  }
  return { x: qx, y: qy, inner, s };
}

/** The interior's two colours (0..1 rgb): near the lips and deep inside, from the lip colour. */
export function interiorOf(lip: MouthRgb | undefined): { near: [number, number, number]; deep: [number, number, number] } {
  const c = lip ?? ([120, 60, 60] as const);
  // Warmer than the lip (a mouth's inside is red-dark, not grey), floored so it is never black.
  const at = (k: number, floor: number): [number, number, number] => [Math.max(floor, (c[0] * k * 1.15) / 255), Math.max(floor * 0.6, (c[1] * k * 0.7) / 255), Math.max(floor * 0.6, (c[2] * k * 0.75) / 255)];
  return { near: at(0.85, 0.12), deep: at(0.42, 0.07) };
}
