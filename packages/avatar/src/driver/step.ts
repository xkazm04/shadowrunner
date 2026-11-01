// step (avatar-renderer req 3, 4.2, 5.1, 5.2): advances the driver by `dt` seconds. Pure: it
// never mutates its arguments and draws randomness only from `state.rng`. Timing rules are in
// the header of state.ts.
import { GESTURE_DURATION_S } from "../../../rig/src/index.js";
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
  SACCADE_GAP_MAX_S,
  SACCADE_GAP_MIN_S,
  SACCADE_MAX_DEG,
  type DriverInputs,
  type DriverState,
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

/**
 * Jumps the saccade offset at every scheduled time up to `t`: toward a point drawn uniformly in the
 * disk of radius SACCADE_MAX_DEG, by at most SACCADE_MAX_DEG. Both ends lie in the disk, so the
 * offset stays in it. The schedule runs under reduced motion too; only the offset is zeroed.
 */
function stepSaccade(s: DriverState, t: number, rng: number, reduced: boolean): { rng: number; saccade: DriverState["saccade"] } {
  let { yaw, pitch, nextAt } = s.saccade;
  while (nextAt <= t) {
    const [angle, r1] = uniform(rng, 0, 2 * Math.PI);
    const [u, r2] = uniform(r1, 0, 1);
    const [gap, r3] = uniform(r2, SACCADE_GAP_MIN_S, SACCADE_GAP_MAX_S);
    const radius = SACCADE_MAX_DEG * Math.sqrt(u);
    const dy = radius * Math.cos(angle) - yaw;
    const dp = radius * Math.sin(angle) - pitch;
    const reach = Math.min(1, SACCADE_MAX_DEG / (Math.hypot(dy, dp) || 1));
    yaw += dy * reach;
    pitch += dp * reach;
    nextAt += gap;
    rng = r3;
  }
  return { rng, saccade: reduced ? { yaw: 0, pitch: 0, nextAt } : { yaw, pitch, nextAt } };
}

/** The driver `dt` seconds later under `inputs`. */
export function step(s: DriverState, dt: number, inputs: DriverInputs): DriverState {
  const t = s.t + clampDt(dt);
  const elapsed = t - s.t;
  const reduced = inputs.reducedMotion;

  const blinks = stepBlinks(s, t, s.rng);
  const { rng, saccade } = stepSaccade(s, t, blinks.rng, reduced);

  const phase = s.drift.phase + DRIFT_RATE * elapsed;
  const drift = reduced ? { yaw: 0, pitch: 0, phase } : { ...driftAt(phase), phase };

  const gazeTarget = GAZE_TARGET_DEG[inputs.gaze] ?? GAZE_TARGET_DEG.host;
  const gazeYaw = s.gazeYaw + (gazeTarget - s.gazeYaw) * easeShare(elapsed, GAZE_EASE_S);

  const target = jawTarget(inputs.level);
  const jawEase = target > s.jaw ? JAW_ATTACK_S : JAW_RELEASE_S;
  const jaw = s.jaw + (target - s.jaw) * easeShare(elapsed, jawEase);

  const next: DriverState = { t, rng, nextBlinkAt: blinks.nextBlinkAt, drift, saccade, gazeYaw, jaw };
  if (blinks.blink !== undefined) {
    next.blinkStart = blinks.blink.start;
    next.blinkDuration = blinks.blink.duration;
  }
  if (inputs.gesture !== undefined) {
    next.gesture = { name: inputs.gesture, startedAt: t };
  } else if (s.gesture !== undefined && t - s.gesture.startedAt <= GESTURE_DURATION_S) {
    next.gesture = { name: s.gesture.name, startedAt: s.gesture.startedAt };
  }
  return next;
}
