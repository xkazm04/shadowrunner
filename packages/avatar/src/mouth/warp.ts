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
// - press/tight thin the lips toward the seam, round fills them;
// - the opening's size comes from the pose (open, jaw) times the lips' span, not from the jaw's own
//   drop, and the interior also covers a thin crease band on each side so the art's dark parting
//   line reads as one opening.
// Every displacement fades to zero over a feather at least FEATHER_K times the displacement, so the
// map stays invertible and nothing outside the window moves. `unwarp` is the shader's inverse,
// statement for statement, so tests pin what the GPU does. Pure, no DOM.
// The maw (cast-face-pass, `lips.maw`): the painted mouth is already open, teeth rows around a dark
// gap with the seam along it. The same field parts the rows (the upper row lifts, the lower drops,
// rigidly, by the lens profile), sized from the teeth rows' height as well as the span (MAW_*); the
// opening shows the art's own gap stretched, no drawn interior: per column the shader takes the
// mean of the dark opaque texels of MAW_TAPS rows within `reach` of the seam (`mawTaps`), as a painted
// gap curves with the grin and a straight seam row crosses teeth tips toward the corners; press and
// tight never squeeze the rows (teeth do not thin) and the corners bend by MAW_BEND of the lips'.
// A maw's jaw layer is the lower row whole (its cut is in or at the gap): every jaw row moves with
// it, also those above the straight seam where a curved grin's rim rises toward the corners.
// Pixel art (`mouth.cell`): `sampleAt` takes one displacement per cell of the canvas grid (its
// centre's), rounded to whole cells, so the art's own pixels move by whole art pixels and stay
// blocky; the interior covers whole cells. The point is not resampled at a cell centre: a forged
// pixel portrait's grid is neither on the canvas origin nor regular (the Redactor: period 7.0-7.3
// px, phase drifting across the face), so centre samples land on its soft cell borders.
import type { RigMouth } from "@sr/rig";
import { mouthLips } from "./anchor.js";
import type { MouthRgb } from "./colours.js";
import type { MouthParams } from "./shapes.js";

/**
 * The pose's opening a (its open, or its jaw) parts the lips by OPEN_OF_SPAN x span x a / (1 +
 * OPEN_EASE x a): about a sixth of the span mid-open, a quarter wide open (a wide mouth must not
 * swallow its lips), whatever the jaw layer's own drop; the upper lip takes UPPER_SHARE.
 */
export const OPEN_OF_SPAN = 0.4;
export const OPEN_EASE = 0.6;
/**
 * The lower lip never drops more than this share of the span below the seam: a deep jaw drop (the
 * default JAW_DROP on a tall jaw) moves the chin, not an ever-rounder hole.
 */
export const LOWER_MAX_OF_SPAN = 0.26;
/** The jaw param's weight in the parting (a jaw-only mix still parts the lips). */
export const JAW_PART = 0.9;
/**
 * The interior also covers this share of the span on each side of the opening, with a soft edge, so
 * the art's dark parting line (split onto both lips by the opening) is absorbed, not doubled.
 */
export const CREASE_OF_SPAN = 0.025;
/** Openings shorter than this share of the span stay deep-dark (a slit reads dark, not lit). */
export const TALL_OF_SPAN = 0.15;
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
/**
 * Maw: the opening is at most MAW_OPEN_OF_HEIGHT of the teeth rows' height (lips.lower - upper) and
 * the lower row drops at most MAW_LOWER_OF_HEIGHT of it; a wide grin's span would otherwise open it
 * like lips a quarter of the span (a carved or toothed mouth is wider than tall: about 3-5 to 1).
 */
export const MAW_OPEN_OF_HEIGHT = 0.7;
export const MAW_LOWER_OF_HEIGHT = 0.5;
/**
 * Maw: corners and width move MAW_BEND of the lips' amount. A full smile lifts a lip corner by
 * CORNER_LIFT x span = 0.24 half widths, so the row's end (the t^2 profile) tilts by 2 x 0.24 = 0.48
 * (about 26 deg); a row of teeth or a carved edge reads as bent past about 8 deg (tan 0.14), and
 * 0.3 x 0.48 = 0.144 keeps it there.
 */
export const MAW_BEND = 0.3;
/**
 * Maw: the gap is searched within MAW_TAP_REACH of the thinner teeth row's thickness about the seam
 * (the gap of a measured maw is inside its rows: the forge's seam is the gap's middle at the centre,
 * and the gap rises or falls toward the corners by less than half a row), over MAW_TAPS rows.
 */
export const MAW_TAP_REACH = 0.5;
export const MAW_TAPS = 9;
/**
 * Maw: a tap counts as the gap only below this luminance (0..1, straight colour): a gap is dark by
 * definition (the scout's maw gaps: 0.03-0.15; lit teeth and carved flesh: 0.3+). The opening shows
 * the mean of the dark taps; where none is that dark it shows the stretched seam row as it is.
 */
export const MAW_DARK_LUMA = 0.3;
/** pixel art: `sampleAt`'s half-pixel in rig px (the interior's edge is hard on the cell grid). */
export const SNAP_AA = 1e-3;
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
  /** An already-open painted mouth (`lips.maw`): no drawn interior, the art's own gap stretches. */
  maw: boolean;
  /** Maw: how far about the seam the gap is searched, rig px (0 on lips). */
  reach: number;
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
  const maw = lips.maw === true;
  const bend = maw ? MAW_BEND : 1;
  const press = clamp(params.press, 0, 1);
  const keep = 1 - press;
  const tight = clamp(params.tight, 0, 1);
  const a = Math.max(clamp(params.open, 0, 1), JAW_PART * clamp(params.jaw, 0, 1));
  const shaped = ((OPEN_OF_SPAN * a) / (1 + OPEN_EASE * a)) * span * keep;
  const parted = maw ? Math.min(shaped, MAW_OPEN_OF_HEIGHT * height * keep) : shaped;
  const lift = UPPER_SHARE * parted + clamp(params.snarl, 0, 1) * SNARL_LIFT * thickUp;
  const g = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const lowerMax = maw ? Math.min(LOWER_MAX_OF_SPAN * span, MAW_LOWER_OF_HEIGHT * height) : LOWER_MAX_OF_SPAN * span;
  const open = Math.min(Math.max(g * keep, (1 - UPPER_SHARE) * parted), lowerMax);
  const widen = bend * clamp(params.width - 1 - 0.1 * tight, -0.4, 0.3);
  const dxL = -widen * hwL;
  const dxR = widen * hwR;
  const smile = clamp(params.smile, -1, 1);
  const skew = clamp(params.skew, -1, 1);
  const dyL = -clamp(smile - skew, -1, 1) * CORNER_LIFT * bend * span;
  const dyR = -clamp(smile + skew, -1, 1) * CORNER_LIFT * bend * span;
  const squeeze = maw ? 0 : clamp(0.3 * press + 0.25 * tight - 0.2 * clamp(params.round, 0, 1), -0.25, 0.45);
  const dy = Math.max(Math.abs(dyL), Math.abs(dyR));
  if (Math.max(lift, open, g, Math.abs(dxL), Math.abs(dxR), dy, Math.abs(squeeze) * span) < WARP_EPS) return undefined;
  const winL = hwL + Math.max(0.5 * hwL, FEATHER_K * Math.abs(dxL), 2 * dy);
  const winR = hwR + Math.max(0.5 * hwR, FEATHER_K * Math.abs(dxR), 2 * dy);
  const fu = Math.max(thickUp, 0.1 * span, FEATHER_K * (lift + dy + Math.abs(squeeze) * thickUp));
  const fd = Math.max(thickDown, 0.1 * span, FEATHER_K * (Math.max(open, g) + dy + Math.abs(squeeze) * thickDown));
  return { cx, seam, hwL, hwR, winL, winR, upper: lips.upper, lower: lips.lower, fu, fd, lift, open, gap: g, dxL, dyL, dxR, dyR, squeeze, maw, reach: maw ? MAW_TAP_REACH * Math.min(thickUp, thickDown) : 0 };
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
  const lower = y >= f.seam || (f.maw && jaw);
  const part = lower ? (f.open * profOf(f, x) - pin) * lowOf(f, y) : -f.lift * profOf(f, x) * upOf(f, y) - pin;
  return [x + dxOf(f, x, y), y + dcOf(f, x, y) + part];
}

export interface Unwarped {
  /** Source point, rig px. */
  x: number;
  y: number;
  /** 0..1 share of the dark interior here (the lips parted, plus the crease band), at the layer's own alpha. */
  inner: number;
  /** The interior's shade: 0 deep .. 1 near (lit toward the lips and the bottom; a slit stays deep). */
  s: number;
  /** Maw: 0..1 share of the opening here, where the art's own gap (`mawTaps`) is shown; 0 on lips. */
  gap: number;
}

/** Maw: the rows searched for the gap's darkest texel about row `y` (the seam, in the layer's rest frame). */
export function mawTaps(f: WarpField, y: number): number[] {
  return Array.from({ length: MAW_TAPS }, (_, i) => y + f.reach * ((2 * i) / (MAW_TAPS - 1) - 1));
}

/** The inverse of `warpPoint` at shown point (px, py) in the layer's frame; `aa` is half a pixel in rig px. */
export function unwarp(f: WarpField, box: readonly number[], jaw: boolean, px: number, py: number, aa = 0.5): Unwarped {
  if (px < (box[0] ?? 0) || px > (box[2] ?? 0) || py < (box[1] ?? 0) || py > (box[3] ?? 0)) return { x: px, y: py, inner: 0, s: 0, gap: 0 };
  const pin = jaw ? f.gap : 0;
  let qx = px;
  for (let i = 0; i < WARP_STEPS; i += 1) qx = px - dxOf(f, qx, py);
  const prof = profOf(f, qx);
  const base = f.seam + (qx < f.cx ? f.dyL : f.dyR) * ayOf(f, qx) - pin;
  const yu = base - f.lift * prof;
  const yl = base + f.open * prof;
  const span = f.hwL + f.hwR;
  const h = yl - yu;
  const v = clamp((py - yu) / Math.max(h, 1e-3), 0, 1);
  const edge = Math.abs(2 * v - 1);
  const s = smoothstep(0, TALL_OF_SPAN * span, h) * clamp(0.5 * edge * edge + 0.25 * v, 0, 1);
  const half = Math.max(aa, 1e-3);
  const core = clamp((Math.min(yl, py + half) - Math.max(yu, py - half)) / (2 * half), 0, 1);
  const crease = CREASE_OF_SPAN * span;
  const band = crease * smoothstep(0, 3 * crease, h);
  const inner = f.maw ? 0 : Math.max(core, band > 1e-3 ? 1 - smoothstep(0, band + half, Math.max(yu - py, py - yl)) : 0);
  let qy = py;
  if (f.maw && jaw) {
    for (let i = 0; i < WARP_STEPS; i += 1) qy = py - dcOf(f, qx, qy) - (f.open * prof - pin) * lowOf(f, qy);
  } else if (py < 0.5 * (yu + yl)) {
    for (let i = 0; i < WARP_STEPS; i += 1) qy = Math.min(f.seam, py - dcOf(f, qx, qy) + f.lift * prof * upOf(f, qy) + pin);
  } else {
    for (let i = 0; i < WARP_STEPS; i += 1) qy = Math.max(f.seam, py - dcOf(f, qx, qy) - (f.open * prof - pin) * lowOf(f, qy));
  }
  return { x: qx, y: qy, inner, s, gap: f.maw ? core : 0 };
}

const inBox = (box: readonly number[], px: number, py: number): boolean => px >= (box[0] ?? 0) && px <= (box[2] ?? 0) && py >= (box[1] ?? 0) && py <= (box[3] ?? 0);

/**
 * The sample for shown point (px, py): `unwarp`, or on pixel art (`cell` > 0) the point moved by
 * its cell's displacement: the unwarp of the cell's centre (canvas grid from 0, as the drawn
 * mouth's `cellCrop`) less that centre, rounded to whole cells; the interior covers a cell whole
 * or not at all. Outside the box the point is its own sample, as in `unwarp`. The shader's
 * `wSample` (gl/warp.ts), statement for statement.
 */
export function sampleAt(f: WarpField, box: readonly number[], jaw: boolean, px: number, py: number, cell: number | undefined, aa = 0.5): Unwarped {
  if (cell === undefined || !(cell > 0) || !inBox(box, px, py)) return unwarp(f, box, jaw, px, py, aa);
  const cx = (Math.floor(px / cell) + 0.5) * cell;
  const cy = (Math.floor(py / cell) + 0.5) * cell;
  const u = unwarp(f, box, jaw, cx, cy, SNAP_AA);
  return { x: px + Math.floor((u.x - cx) / cell + 0.5) * cell, y: py + Math.floor((u.y - cy) / cell + 0.5) * cell, inner: u.inner >= 0.5 ? 1 : 0, s: u.s, gap: u.gap >= 0.5 ? 1 : 0 };
}

/** The interior's luminance (0..1): deep inside and near the lips. Absolute, so a dark or pale lip sample reads alike. */
export const INTERIOR_LUMA = { deep: 0.085, near: 0.19 } as const;

/**
 * The interior's two colours (0..1 rgb): the lip colour's hue, a little warmer (a mouth's inside is
 * red-dark, not grey, but not a red band either), brought to INTERIOR_LUMA. Never black.
 */
export function interiorOf(lip: MouthRgb | undefined): { near: [number, number, number]; deep: [number, number, number] } {
  const c = lip ?? ([120, 80, 80] as const);
  const warm: [number, number, number] = [Math.max(1, c[0]) * 1.12, Math.max(1, c[1]) * 0.9, Math.max(1, c[2]) * 0.92];
  const luma = 0.2126 * warm[0] + 0.7152 * warm[1] + 0.0722 * warm[2];
  const at = (target: number): [number, number, number] => [Math.min(1, (warm[0] * target) / luma), Math.min(1, (warm[1] * target) / luma), Math.min(1, (warm[2] * target) / luma)];
  return { near: at(INTERIOR_LUMA.near), deep: at(INTERIOR_LUMA.deep) };
}
