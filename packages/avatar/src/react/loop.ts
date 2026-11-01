// One frame of the avatar loop (avatar-renderer req 5.3, 6.2, 6.3), pure so it is testable without
// a browser: step the driver by the frame's dt (the driver clamps it), take its Drive (or the
// override), and under reduced motion turn a running gesture into a cut held for its duration.
//
// Decisions the spec leaves open:
// - Every time the frame uses is the driver's clock (`DriverState.t`): blinks, gesture starts and
//   the glow pulse. The browser clock only supplies the gap between frames, which `step` clamps.
// - Reduced-motion gesture cuts (req 5.3) are made by posing the running gesture at the peak of
//   rig-core's envelope (`t = startedAt + GESTURE_DURATION_S / 2`) for its whole duration, so the
//   pose jumps to the gesture, holds, and jumps back; rig-core's curve itself is untouched.
// - Reduced motion is on when `prefers-reduced-motion: reduce` matches OR the nearest `data-motion`
//   attribute (the shell's) says "reduced".
import { GESTURE_DURATION_S, type Drive, type Gesture } from "@sr/rig";
import { toDrive } from "../driver/drive.js";
import type { LookAtPoint } from "../driver/lookAt.js";
import type { DriverState, Gaze } from "../driver/state.js";
import { step } from "../driver/step.js";

export interface FrameInputs {
  /** Seconds since the previous frame (browser clock); `step` clamps it. */
  dt: number;
  level: number;
  gaze: Gaze;
  /** Present only on the frame a gesture starts. */
  gesture?: Gesture;
  reducedMotion: boolean;
  /** A point to look toward, normalised view space (costume 9). */
  lookAt?: LookAtPoint;
  /** Overrides the driver's Drive (tests, screenshots). */
  drive?: Drive;
}

export interface Frame {
  state: DriverState;
  /** The Drive to pose with (reduced-motion gestures already cut). */
  drive: Drive;
}

/** Reduced motion from the media query and the shell's `data-motion` value. */
export function isReducedMotion(mediaReduces: boolean, dataMotion: string | null | undefined): boolean {
  return mediaReduces || dataMotion === "reduced";
}

/** Under reduced motion, a running gesture is posed at its peak for its whole duration (a cut). */
export function cutGesture(drive: Drive, reducedMotion: boolean): Drive {
  const cue = drive.gesture;
  if (!reducedMotion || cue === undefined) return drive;
  const elapsed = drive.t - cue.startedAt;
  if (!(elapsed >= 0 && elapsed <= GESTURE_DURATION_S)) return drive;
  return { ...drive, t: cue.startedAt + GESTURE_DURATION_S / 2 };
}

/** Advances the driver one frame and returns the Drive to pose with. */
export function advanceFrame(state: DriverState, inputs: FrameInputs): Frame {
  const next = step(state, inputs.dt, {
    level: inputs.level,
    gaze: inputs.gaze,
    reducedMotion: inputs.reducedMotion,
    ...(inputs.gesture === undefined ? {} : { gesture: inputs.gesture }),
    ...(inputs.lookAt === undefined ? {} : { lookAt: inputs.lookAt }),
  });
  const drive = inputs.drive ?? toDrive(next);
  return { state: next, drive: cutGesture(drive, inputs.reducedMotion) };
}
