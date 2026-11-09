// step (avatar-renderer req 3, 4.2, 5.1, 5.2; task 1.5): advances the driver by `dt` seconds. Pure: it
// never mutates its arguments and draws randomness only from `state.rng`. Timing rules are in
// the header of state.ts. Face control (face-control): `inputs.face.drift` multiplies the drift, and
// on a rig with irises (`inputs.face.eyes`) the eyes lead the gaze and the head follows them
// (driver/eyes.ts); without `inputs.face` every step is exactly as before.
// Secondary motion (perfection-pass V1): `stepSpring` and `springLag` below; `step` only carries the springs.
import { GESTURE_DURATION_S, SPRING_KEYS, type SpringChannels, type SpringKey } from "@sr/rig";
import { stepEyes } from "./eyes.js";
import { lookAtOffset } from "./lookAt.js";
import { uniform } from "./rng.js";
import {
  BLINK_GAP_MAX_S,
  BLINK_GAP_MIN_S,
  BLINK_MAX_S,
  BLINK_MIN_S,
  DRIFT_RATE,
  driftAt,
  EASE_SHARE,
  GAZE_EASE_S,
  GAZE_TARGET_DEG,
  JAW_ATTACK_S,
  JAW_FLOOR,
  JAW_RELEASE_S,
  MAX_STEP_S,
  MOTION_EASE_S,
  SACCADE_GAP_MAX_S,
  SACCADE_GAP_MIN_S,
  SACCADE_MAX_DEG,
  SPRING_HZ,
  SPRING_LAG_MAX,
  SPRING_REST,
  SPRING_ZETA,
  type DriverInputs,
  type DriverState,
  type SpringState,
} from "./state.js";

/** `dt` limited to [0, MAX_STEP_S]; NaN counts as no time. */
const clampDt = (dt: number): number => (Number.isNaN(dt) ? 0 : Math.min(MAX_STEP_S, Math.max(0, dt)));

/** Share of the remaining distance an exponential ease covers in `dt`, given it covers EASE_SHARE in `ease`. */
const easeShare = (dt: number, ease: number): number => 1 - Math.pow(1 - EASE_SHARE, dt / ease);

/** Jaw target for an audio level: 0 under the floor, then linear up to 1 at full level. */
function jawTarget(level: number): number {
  if (!(level >= JAW_FLOOR)) return 0;
  return Math.min(1, (level - JAW_FLOOR) / (1 - JAW_FLOOR));
}

interface Blinks {
  rng: number;
  nextBlinkAt: number;
  blink?: { start: number; duration: number };
}

/** Starts every blink scheduled up to `t` (at its scheduled time) and ends the one that ran out. */
function stepBlinks(s: DriverState, t: number, rng: number): Blinks {
  let next = s.nextBlinkAt;
  let blink = s.blinkStart === undefined || s.blinkDuration === undefined ? undefined : { start: s.blinkStart, duration: s.blinkDuration };
  while (next <= t) {
    const [duration, r1] = uniform(rng, BLINK_MIN_S, BLINK_MAX_S);
    const [gap, r2] = uniform(r1, BLINK_GAP_MIN_S, BLINK_GAP_MAX_S);
    blink = { start: next, duration };
    next += gap;
    rng = r2;
  }
  if (blink !== undefined && t - blink.start >= blink.duration) blink = undefined;
  return blink === undefined ? { rng, nextBlinkAt: next } : { rng, nextBlinkAt: next, blink };
}

/** Motion amplitude after `elapsed` seconds: straight to the level on the first step, then a linear ramp. */
function stepMotion(s: DriverState, elapsed: number, reduced: boolean): number {
  const level = reduced ? 0 : 1;
  if (s.motion === undefined) return level;
  const ramp = elapsed / MOTION_EASE_S;
  return level > s.motion ? Math.min(level, s.motion + ramp) : Math.max(level, s.motion - ramp);
}

/** `value` at amplitude `motion`; exactly 0 (never -0) at amplitude 0. */
const scaled = (value: number, motion: number): number => (motion === 0 ? 0 : value * motion);

/**
 * Jumps the saccade offset at every scheduled time up to `t`: toward a point drawn uniformly in the
 * disk of radius SACCADE_MAX_DEG, by at most SACCADE_MAX_DEG. Both ends lie in the disk, so the
 * offset stays in it. The state holds the offset scaled by `motion`; jumps apply to the full-scale
 * offset and only while `motion` stays 1, but the schedule and its draws always run.
 */
function stepSaccade(s: DriverState, t: number, rng: number, from: number, to: number): { rng: number; saccade: DriverState["saccade"] } {
  let yaw = from === 0 ? 0 : s.saccade.yaw / from;
  let pitch = from === 0 ? 0 : s.saccade.pitch / from;
  let nextAt = s.saccade.nextAt;
  const jumps = from === 1 && to === 1;
  while (nextAt <= t) {
    const [angle, r1] = uniform(rng, 0, 2 * Math.PI);
    const [u, r2] = uniform(r1, 0, 1);
    const [gap, r3] = uniform(r2, SACCADE_GAP_MIN_S, SACCADE_GAP_MAX_S);
    if (jumps) {
      const radius = SACCADE_MAX_DEG * Math.sqrt(u);
      const dy = radius * Math.cos(angle) - yaw;
      const dp = radius * Math.sin(angle) - pitch;
      const reach = Math.min(1, SACCADE_MAX_DEG / (Math.hypot(dy, dp) || 1));
      yaw += dy * reach;
      pitch += dp * reach;
    }
    nextAt += gap;
    rng = r3;
  }
  return { rng, saccade: { yaw: scaled(yaw, to), pitch: scaled(pitch, to), nextAt } };
}

/** The driver `dt` seconds later under `inputs`. */
export function step(s: DriverState, dt: number, inputs: DriverInputs): DriverState {
  const t = s.t + clampDt(dt);
  const elapsed = t - s.t;
  const motion = stepMotion(s, elapsed, inputs.reducedMotion);

  const blinks = stepBlinks(s, t, s.rng);
  const { rng, saccade } = stepSaccade(s, t, blinks.rng, s.motion ?? motion, motion);

  const phase = s.drift.phase + DRIFT_RATE * elapsed;
  const full = driftAt(phase);
  const k = inputs.face?.drift ?? 1;
  const drift = { yaw: scaled(scaled(full.yaw, motion), k), pitch: scaled(scaled(full.pitch, motion), k), phase };

  // Look-at (costume 9) biases the gaze targets; without it the targets are the gaze's own.
  const look = inputs.lookAt === undefined ? undefined : lookAtOffset(inputs.lookAt);
  const gazeEase = easeShare(elapsed, GAZE_EASE_S);
  const gazeTarget = (GAZE_TARGET_DEG[inputs.gaze] ?? GAZE_TARGET_DEG.host) + (look?.yaw ?? 0);
  const eyes = inputs.face?.eyes === undefined ? undefined : stepEyes(s, t, elapsed, inputs, motion);
  const gazeYaw = eyes?.gazeYaw ?? s.gazeYaw + (gazeTarget - s.gazeYaw) * gazeEase;

  const target = jawTarget(inputs.level);
  const jawEase = target > s.jaw ? JAW_ATTACK_S : JAW_RELEASE_S;
  const jaw = s.jaw + (target - s.jaw) * easeShare(elapsed, jawEase);

  const next: DriverState = { t, rng, nextBlinkAt: blinks.nextBlinkAt, drift, saccade, gazeYaw, jaw, motion };
  if (eyes !== undefined) {
    next.gazePitch = eyes.gazePitch;
    next.eyes = eyes.eyes;
  } else if (look !== undefined || s.gazePitch !== undefined) {
    const from = s.gazePitch ?? 0;
    next.gazePitch = from + ((look?.pitch ?? 0) - from) * gazeEase;
  }
  if (blinks.blink !== undefined) {
    next.blinkStart = blinks.blink.start;
    next.blinkDuration = blinks.blink.duration;
  }
  if (inputs.gesture !== undefined) {
    next.gesture = { name: inputs.gesture, startedAt: t };
  } else if (s.gesture !== undefined && t - s.gesture.startedAt <= GESTURE_DURATION_S) {
    next.gesture = { name: s.gesture.name, startedAt: s.gesture.startedAt };
  }
  if (s.spring !== undefined) next.spring = s.spring;
  return next;
}

/** Index of the first act channel in SPRING_KEYS. */
const ACT_FROM = SPRING_KEYS.indexOf("actDx");
const OMEGA = 2 * Math.PI * SPRING_HZ;
const OMEGA_D = OMEGA * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA);

/**
 * The channel springs (perfection-pass V1) `dt` seconds on, toward `target` (@sr/rig
 * `springTargetOf`); `target` undefined (reduced motion, strength 0) puts them to rest: undefined.
 * Pure and exact: between two steps the target is taken as moving in a straight line, and the
 * damped spring's own motion about it is solved in closed form, so any `dt` up to MAX_STEP_S is
 * stable and a 30 fps and a 120 fps run of one motion end in the same place up to how finely the
 * target was sampled. A first step starts at rest on the target. A new act layer starts its act
 * channels at rest; the old one's are dropped.
 */
export function stepSpring(s: SpringState | undefined, dt: number, target: SpringChannels | undefined): SpringState | undefined {
  if (target === undefined) return undefined;
  const h = clampDt(dt);
  const values = SPRING_KEYS.map((key) => (Number.isFinite(target[key]) ? target[key] : 0));
  const newAct = target.actLayer !== undefined && target.actLayer !== s?.actLayer;
  const decay = Math.exp(-SPRING_ZETA * OMEGA * h);
  const cos = Math.cos(OMEGA_D * h);
  const sin = Math.sin(OMEGA_D * h);
  const lag: number[] = [];
  const vel: number[] = [];
  let acting = false;
  for (let c = 0; c < values.length; c += 1) {
    const to = values[c] ?? 0;
    const fresh = s === undefined || (newAct && c >= ACT_FROM);
    const from = fresh ? to : (s.target[c] ?? to);
    const e0 = fresh ? 0 : (s.lag[c] ?? 0);
    const v0 = fresh ? 0 : (s.vel[c] ?? 0);
    const vt = h > 0 ? (to - from) / h : 0;
    const u0 = v0 - vt;
    // The lag's own motion: e'' + 2 zeta w e' + w^2 e = 0 while the target moves in a straight line.
    let e = h > 0 ? decay * (e0 * cos + ((u0 + SPRING_ZETA * OMEGA * e0) / OMEGA_D) * sin) : e0 + from - to;
    let u = h > 0 ? decay * (u0 * cos - ((OMEGA * OMEGA * e0 + SPRING_ZETA * OMEGA * u0) / OMEGA_D) * sin) : u0;
    const max = SPRING_LAG_MAX[c] ?? 0;
    if (Math.abs(e) > max) [e, u] = [Math.sign(e) * max, 0];
    if (!(Math.abs(e) >= SPRING_REST || Math.abs(u) >= SPRING_REST * OMEGA)) [e, u] = [0, 0];
    lag.push(e);
    vel.push(u + vt);
    if (c >= ACT_FROM && e !== 0) acting = true;
  }
  const actLayer = target.actLayer ?? (acting ? s?.actLayer : undefined);
  return { lag, vel, target: values, ...(actLayer === undefined ? {} : { actLayer }) };
}

/** The `Drive.spring` of a spring state: its lags, or undefined when every one is 0 (at rest). */
export function springLag(s: SpringState | undefined): SpringChannels | undefined {
  if (s === undefined || s.lag.every((e) => e === 0)) return undefined;
  const at = (key: SpringKey): number => s.lag[SPRING_KEYS.indexOf(key)] ?? 0;
  const lag: SpringChannels = { yaw: at("yaw"), pitch: at("pitch"), roll: at("roll"), scale: at("scale"), lift: at("lift"), actDx: at("actDx"), actDy: at("actDy"), actRot: at("actRot") };
  if (s.actLayer !== undefined) lag.actLayer = s.actLayer;
  return lag;
}
