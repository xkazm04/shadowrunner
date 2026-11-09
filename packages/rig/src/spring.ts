// Secondary motion (perfection-pass V1): loose parts lag the head and settle. Pure, no DOM.
//
// Decisions:
// - The spring runs on a few CHANNELS, not per layer: what the head group does this frame (yaw and
//   pitch parallax, the gesture/mood roll, the gesture scale and lift) and the move of a playing
//   act's layer. The driver (avatar driver/step.ts `stepSpring`) holds one damped spring per channel
//   and hands the pose its LAG (spring minus target) as `Drive.spring`. Every rigid motion here is
//   linear in the channels, so per-layer springs with one shared dynamic would give exactly this lag
//   times the layer's own lever: a fixed-size carrier, no per-layer record per frame.
// - Per layer (`springParts`, from rig data alone, no re-forging): the lag moves the layer's bbox
//   centre by `e` canvas px. A part pinned at one end (anchor far from its centre: a tag, a plume, a
//   serpent) answers by SWINGING about its anchor, the part of `e` across its lever, so its
//   attachment never moves. A part pinned at its centre answers by a small MOVE, and only when the
//   forge made it float (it is already loose). `swing`/`move` scale that answer:
//   - only accessory and crown layers, never a brow, nothing under or above a jaw, eye or iris (the
//     mouth warp, sockets and lids stay registered), and less the more the part covers the face box
//     (the union of eye, iris and jaw boxes; gone at FACE_OVERLAP_MAX of its area);
//   - lighter (smaller against the canvas) parts answer more, a part with no float of its own swings
//     at RIGID_SHARE (a crown pinned at its middle does not move at all), and not at all off the
//     head (a collar or cage on the torso is clothing);
//   - a move only for a part pinned near its middle (a bulb pinned off-centre would leave its pin);
//   - the swing is the lag across the lever over max(lever, SPRING_LEVER of the rig height), so a
//     short part does not whip round;
//   - the answer is clamped: a swing to ROT_MAX radians, a move to MOVE_MAX of the layer's shorter side.
// - Followers inherit a parent's swing (pose carries it like a float), so a bulb rides its stalk's
//   tip, and answer only the lag their springing parent's swing has not already taken up at them.
// - `Rig.motion.spring` / `Look.motion.spring` scale every answer (look wins; 0 disables).
import { isBrowLayer } from "./mood.js";
import type { PosePlan } from "./posePlan.js";
import type { Layer, Look, Rig } from "./types.js";
import { SPRING_STRENGTH_MAX } from "./validateMotion.js";

/**
 * The spring channels (perfection-pass V1). As `Drive.spring` they are the LAG, spring minus target;
 * as a target (`springTargetOf`), the value this frame. Absent on a drive: no secondary motion.
 */
export interface SpringChannels {
  /** Head yaw as a share of its limit (the parallax, per unit depth, over YAW_SHIFT * width). */
  yaw: number;
  /** Head pitch (nod and mood included) as a share of its limit. */
  pitch: number;
  /** Head-group roll (gesture tilt and mood tilt), radians, about the head group's anchor. */
  roll: number;
  /** Head-group gesture scale offset (lean in, recoil). */
  scale: number;
  /** Head-group gesture lift, a fraction of rig height (negative is up). */
  lift: number;
  /** The playing act's own move of `actLayer`: fractions of rig height, and radians. */
  actDx: number;
  actDy: number;
  actRot: number;
  /** The layer whose act the act channels follow; its followers answer them. */
  actLayer?: string;
}

/** The numeric channels, in a fixed order (the driver steps each). */
export const SPRING_KEYS = ["yaw", "pitch", "roll", "scale", "lift", "actDx", "actDy", "actRot"] as const;
export type SpringKey = (typeof SPRING_KEYS)[number];

/** A part's swing, radians, is clamped to this. */
export const SPRING_ROT_MAX = 0.2;
/** A part's move is clamped to this share of its bbox's shorter side. */
export const SPRING_MOVE_MAX = 0.06;
/** A part's swing when it has no float of its own (it is less loose). */
export const SPRING_RIGID_SHARE = 0.35;
/**
 * The swing is the lag across the lever over max(lever, this times rig height): a short part (a bulb,
 * a bell) turns as far as a part this long would, not further (a quasi-static pendulum deflects by
 * its pin's acceleration, whatever its length).
 */
export const SPRING_LEVER = 0.12;
/** A part covering this share of its area of the face box gets no spring. */
export const SPRING_FACE_OVERLAP_MAX = 0.3;

/** The strength in force: the look's, else the rig's, else 1; clamped to [0, SPRING_STRENGTH_MAX]. */
export function springStrength(rig: Pick<Rig, "motion">, look: Pick<Look, "motion">): number {
  const value = look.motion?.spring ?? rig.motion?.spring ?? 1;
  return Number.isFinite(value) ? Math.min(SPRING_STRENGTH_MAX, Math.max(0, value)) : 1;
}

/** One layer's static spring data (`springParts`). */
export interface SpringPart {
  /** Weights of the swing and the move, 0 when none. */
  swing: number;
  move: number;
  /** The layer's depth, its bbox centre, its lever (centre minus anchor), and the lever times max(lever, SPRING_LEVER * height). */
  depth: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  l2: number;
  /** The anchor of its head group's root (roll and scale turn about it); NaN when not in a head group. */
  hx: number;
  hy: number;
  /** The largest move, canvas px. */
  moveMax: number;
}

/** The rig's springs: per layer index its part, and the indices of the springing parts, parents first. */
export interface SpringRig {
  parts: readonly SpringPart[];
  order: Int32Array;
}

const NONE: SpringPart = Object.freeze({ swing: 0, move: 0, depth: 0, cx: 0, cy: 0, rx: 0, ry: 0, l2: 0, hx: NaN, hy: NaN, moveMax: 0 });
const REGISTERED: ReadonlySet<Layer["kind"]> = new Set(["jaw", "eye", "iris"]);
const smooth = (lo: number, hi: number, x: number): number => {
  const m = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return m * m * (3 - 2 * m);
};
type Box = readonly [number, number, number, number];
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

const rigs = new WeakMap<readonly Layer[], SpringRig>();

/** Per layer index, its spring data (module header), built once per layers array. */
export function springParts(rig: Pick<Rig, "layers" | "width" | "height">, depthOf: (layer: Layer) => number): SpringRig {
  const known = rigs.get(rig.layers);
  if (known !== undefined) return known;
  const byName = new Map<string, Layer>();
  for (const layer of rig.layers) if (!byName.has(layer.name)) byName.set(layer.name, layer);
  // Up the follow chain (cycles stop at the first repeat).
  const chain = (layer: Layer): Layer[] => {
    const up: Layer[] = [];
    for (let p = layer.follow === undefined ? undefined : byName.get(layer.follow); p !== undefined && !up.includes(p) && p !== layer; p = p.follow === undefined ? undefined : byName.get(p.follow)) up.push(p);
    return up;
  };
  const registered = rig.layers.filter((l) => REGISTERED.has(l.kind));
  const face = registered.reduce<[number, number, number, number] | undefined>((u, l) => {
    const [x, y, w, h] = l.bbox;
    return u === undefined ? [x, y, x + w, y + h] : [Math.min(u[0], x), Math.min(u[1], y), Math.max(u[2], x + w), Math.max(u[3], y + h)];
  }, undefined);
  const faceBox: Box | undefined = face === undefined ? undefined : [face[0], face[1], face[2] - face[0], face[3] - face[1]];
  const anchorsRegistered = new Set(registered.flatMap((l) => chain(l)));
  const reach = Math.hypot(rig.width, rig.height) / 2;
  const lever = SPRING_LEVER * rig.height;
  const parts = rig.layers.map((layer): SpringPart => {
    const up = chain(layer);
    if (layer.kind !== "accessory" && layer.kind !== "crown") return NONE;
    if (isBrowLayer(layer) || anchorsRegistered.has(layer) || up.some((p) => REGISTERED.has(p.kind))) return NONE;
    const [x, y, w, h] = layer.bbox;
    if (!(w > 0 && h > 0)) return NONE;
    const [ax, ay] = layer.anchor;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const pinned = Math.min(1, Math.max(Math.abs(cx - ax) / (w / 2), Math.abs(cy - ay) / (h / 2)));
    const s = smooth(0.2, 0.75, pinned);
    const light = Math.min(1, Math.max(0.2, (0.6 - Math.hypot(w, h) / 2 / reach) / 0.4));
    const covered = faceBox === undefined ? 0 : overlap(layer.bbox, faceBox) / (w * h);
    const k = light * Math.max(0, 1 - covered / SPRING_FACE_OVERLAP_MAX);
    const loose = layer.motion?.float !== undefined;
    const swing = s * k * (loose ? 1 : SPRING_RIGID_SHARE);
    // A move only for a part pinned near its middle: one pinned off-centre (a bulb on a stalk's tip) would leave its pin.
    const move = loose ? (1 - smooth(0.1, 0.35, pinned)) * k : 0;
    let root: Layer | undefined;
    for (const p of [layer, ...up]) if (p.kind === "head") root = p;
    // Off the head, a part with no float of its own is clothing (a collar, a cage): it stays put.
    if ((swing === 0 && move === 0) || (!loose && root === undefined)) return NONE;
    const rx = cx - ax;
    const ry = cy - ay;
    return { swing, move, depth: depthOf(layer), cx, cy, rx, ry, l2: Math.hypot(rx, ry) * Math.max(Math.hypot(rx, ry), lever), hx: root?.anchor[0] ?? NaN, hy: root?.anchor[1] ?? NaN, moveMax: SPRING_MOVE_MAX * Math.min(w, h) };
  });
  const depthIn = (layer: Layer): number => chain(layer).length;
  const order = Int32Array.from(parts.flatMap((part, i) => (part === NONE ? [] : [i])).sort((a, b) => depthIn(rig.layers[a] as Layer) - depthIn(rig.layers[b] as Layer) || a - b));
  const out = { parts, order };
  rigs.set(rig.layers, out);
  return out;
}

/** Whether the layer at `index` follows (strictly, down its chain) a layer named `name`. */
function under(rig: Pick<Rig, "layers">, plan: PosePlan, index: number, name: string): boolean {
  let p = plan.parent[index] ?? -1;
  for (let hops = 0; p >= 0 && hops < plan.parent.length; hops += 1) {
    if (rig.layers[p]?.name === name) return true;
    p = plan.parent[p] ?? -1;
  }
  return false;
}

/**
 * Per slot into `plan.springs` (dx, dy, rotation), each part's answer to `lag` at `strength`; `ux`,
 * `uy` are the canvas px of one unit of the yaw and pitch channels at depth 1 (pose.ts: YAW_SHIFT *
 * width, PITCH_SHIFT * height). Returns whether any is non-zero; when false the scratch is all zero.
 */
export function springsOf(rig: Pick<Rig, "layers" | "width" | "height">, lag: SpringChannels, strength: number, ux: number, uy: number, plan: PosePlan, depthOf: (layer: Layer) => number): boolean {
  const { parts, order } = springParts(rig, depthOf);
  const out = plan.springs;
  const act = lag.actLayer;
  const acting = act !== undefined && (lag.actDx !== 0 || lag.actDy !== 0 || lag.actRot !== 0);
  const actor = acting ? rig.layers.find((l) => l.name === act)?.anchor : undefined;
  let any = false;
  for (let n = 0; n < order.length; n += 1) {
    const i = order[n] ?? -1;
    const part = parts[i];
    if (part === undefined || plan.slot[i] !== i) continue;
    let ex = lag.yaw * ux * part.depth;
    let ey = lag.pitch * uy * part.depth;
    if (!Number.isNaN(part.hx)) {
      const vx = part.cx - part.hx;
      const vy = part.cy - part.hy;
      ex += -lag.roll * vy + lag.scale * vx;
      ey += lag.roll * vx + lag.scale * vy + lag.lift * rig.height;
    }
    if (actor !== undefined && act !== undefined && under(rig, plan, i, act)) {
      ex += lag.actDx * rig.height - lag.actRot * (part.cy - actor[1]);
      ey += lag.actDy * rig.height + lag.actRot * (part.cx - actor[0]);
    }
    // What a springing parent's swing already did here (parents come first): the part lags its pin, not the head.
    for (let p = plan.parent[i] ?? -1, hops = 0; p >= 0 && hops < plan.parent.length; p = plan.parent[p] ?? -1, hops += 1) {
      const pin = rig.layers[p]?.anchor;
      const r = out[3 * p + 2] ?? 0;
      if (pin === undefined) continue;
      ex -= (out[3 * p] ?? 0) - r * (part.cy - pin[1]);
      ey -= (out[3 * p + 1] ?? 0) + r * (part.cx - pin[0]);
    }
    const turn = part.l2 > 1 ? (strength * part.swing * (part.rx * ey - part.ry * ex)) / part.l2 : 0;
    const rot = Math.min(SPRING_ROT_MAX, Math.max(-SPRING_ROT_MAX, turn));
    let dx = strength * part.move * ex;
    let dy = strength * part.move * ey;
    const d = Math.hypot(dx, dy);
    if (d > part.moveMax) {
      dx *= part.moveMax / d;
      dy *= part.moveMax / d;
    }
    const k = 3 * i;
    out[k] = Number.isFinite(dx) ? dx : 0;
    out[k + 1] = Number.isFinite(dy) ? dy : 0;
    out[k + 2] = Number.isFinite(rot) ? rot : 0;
    any ||= out[k] !== 0 || out[k + 1] !== 0 || out[k + 2] !== 0;
  }
  return any;
}
