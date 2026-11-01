// Procedural driver state (avatar-renderer req 3, 4.2, 5.1; task 1.5): types, the named constants
// of design.md "Contracts", and `initialState(seed)`. Pure, no DOM.
//
// Decisions the spec leaves open (documented here so step, drive and their tests agree):
// - Every time in the state is on one clock, seconds since `initialState` (`t`), the same clock as
//   rig-core's `Drive.t` and `GestureCue.startedAt`.
// - A blink starts at its scheduled time `nextBlinkAt` (not at the frame that notices it), so the
//   start-to-start gaps are exactly the drawn gaps. Its drawn length is kept in `blinkDuration`,
//   present exactly when `blinkStart` is (the design's state lists no field for it).
// - The ease times (gaze, jaw attack and release) are the time to cover 95% of the distance to the
//   target with an exponential ease, so a constant input settles regardless of the frame rate.
// - A micro-saccade jumps at most SACCADE_MAX_DEG, toward a point drawn in the disk of that
//   radius, so the saccade offset itself also never exceeds SACCADE_MAX_DEG from rest.
// - `dt` is clamped to [0, MAX_STEP_S]: a tab that was asleep resumes from where it paused
//   instead of skipping blinks, and no frame can jump past a whole blink.
// - Reduced motion scales drift and saccade by `motion` (task 1.5), which ramps linearly toward 0
//   (reduced) or 1 (full) by MOTION_EASE_S per second, so a mid-session toggle eases out over
//   400 ms and then is exactly 0 (req 5.1) instead of cutting the head offset (up to 5 deg) in one
//   frame. The first step sets `motion` straight to its level, so a session that starts reduced
//   never drifts. Linear, not exponential: it ends at exactly 0, and for frames up to ~80 ms each
//   ramp frame moves the offset no more than a full-motion frame can (drift slope x dt + 1 deg).
//   Saccade jumps wait while `motion` is below 1 (their schedule and draws still run, so the rng
//   stays in step with full motion); a jump on a ramp frame could exceed that bound.
import type { Gesture } from "@sr/rig";
import type { LookAtPoint } from "./lookAt.js";
import { seedRng, uniform } from "./rng.js";

export type Gaze = "host" | "content" | "chat";

export interface DriverInputs {
  /** Speech level 0..1 from `attachAudio` (`speechLevel` of the RMS; 0 when no audio). */
  level: number;
  gaze: Gaze;
  /** Edge-triggered: present only on the frame it starts. */
  gesture?: Gesture;
  reducedMotion: boolean;
  /**
   * A point to look toward, in normalised view space (driver/lookAt.ts). Biases the gaze yaw and
   * pitch targets by `lookAtOffset`; absent, the driver behaves exactly as without it (costume 9).
   */
  lookAt?: LookAtPoint;
}

export interface DriverState {
  /** Seconds since start. */
  t: number;
  /** mulberry32 state (uint32). */
  rng: number;
  /** Seconds; when the next blink starts. Always later than `t` after a step. */
  nextBlinkAt: number;
  /** Seconds; start of the running blink. Present only while a blink runs. */
  blinkStart?: number;
  /** Seconds; length of the running blink. Present exactly when `blinkStart` is. */
  blinkDuration?: number;
  /** Degrees; `phase` in radians of the base drift frequency. */
  drift: { yaw: number; pitch: number; phase: number };
  /** Degrees; `nextAt` in seconds. */
  saccade: { yaw: number; pitch: number; nextAt: number };
  /** Degrees, eased toward the gaze target. */
  gazeYaw: number;
  /**
   * Degrees, eased toward the look-at pitch (0 without one). Absent until a step has a `lookAt`,
   * so a driver that never looks at a point keeps the state it always had.
   */
  gazePitch?: number;
  /** Smoothed 0..1. */
  jaw: number;
  gesture?: { name: Gesture; startedAt: number };
  /**
   * 0..1, amplitude of drift and micro-saccades: 1 full motion, 0 reduced, ramping between them
   * for MOTION_EASE_S after a toggle. Absent until the first step, which sets it to the level of
   * its `reducedMotion` input.
   */
  motion?: number;
}

/** Blink start-to-start gap, seconds (req 3.2). */
export const BLINK_GAP_MIN_S = 2;
export const BLINK_GAP_MAX_S = 6;
/** Blink length, seconds (req 3.2). */
export const BLINK_MIN_S = 0.12;
export const BLINK_MAX_S = 0.18;

/** Drift amplitude, degrees (req 3.3). */
export const DRIFT_YAW_DEG = 4;
export const DRIFT_PITCH_DEG = 2;
/** Drift base frequency, radians per second (a period of about 9 s). */
export const DRIFT_RATE = 0.7;

/** Largest micro-saccade jump and offset, degrees (req 3.3). */
export const SACCADE_MAX_DEG = 1;
/** Gap between micro-saccades, seconds (req 3.3). */
export const SACCADE_GAP_MIN_S = 0.4;
export const SACCADE_GAP_MAX_S = 1.2;

/** Head yaw target per gaze, degrees (req 3.4). */
export const GAZE_TARGET_DEG: Readonly<Record<Gaze, number>> = Object.freeze({ host: 0, content: -8, chat: 10 });
/** Time to cover 95% of the way to a new gaze target, seconds (req 3.4). */
export const GAZE_EASE_S = 0.3;

/** Levels below this are silence (req 4.2). */
export const JAW_FLOOR = 0.04;
/** Time to cover 95% of the way to a higher jaw target, seconds (req 4.2). */
export const JAW_ATTACK_S = 0.04;
/** Time to cover 95% of the way to a lower jaw target, seconds (req 4.2). */
export const JAW_RELEASE_S = 0.12;

/** Time for drift and saccade amplitude to reach a new reduced-motion level, seconds (task 1.5). */
export const MOTION_EASE_S = 0.4;

/** Share of the distance an ease time covers. */
export const EASE_SHARE = 0.95;
/** Longest step, seconds; larger `dt` values are clamped to it. */
export const MAX_STEP_S = 0.1;

/**
 * Drift offsets at `phase`: two sines per axis with incommensurate frequencies, weights summing to
 * 1, so each axis stays within its amplitude and never repeats exactly.
 */
export function driftAt(phase: number): { yaw: number; pitch: number } {
  return {
    yaw: DRIFT_YAW_DEG * (0.7 * Math.sin(phase) + 0.3 * Math.sin(2.618 * phase + 1.1)),
    pitch: DRIFT_PITCH_DEG * (0.6 * Math.sin(1.303 * phase + 0.4) + 0.4 * Math.sin(0.513 * phase + 2.3)),
  };
}

/** The driver at rest at t = 0, its blink, drift phase and saccade schedule drawn from `seed`. */
export function initialState(seed: number): DriverState {
  const [nextBlinkAt, r1] = uniform(seedRng(seed), BLINK_GAP_MIN_S, BLINK_GAP_MAX_S);
  const [phase, r2] = uniform(r1, 0, 2 * Math.PI);
  const [nextAt, rng] = uniform(r2, SACCADE_GAP_MIN_S, SACCADE_GAP_MAX_S);
  return {
    t: 0,
    rng,
    nextBlinkAt,
    drift: { ...driftAt(phase), phase },
    saccade: { yaw: 0, pitch: 0, nextAt },
    gazeYaw: GAZE_TARGET_DEG.host,
    jaw: 0,
  };
}
