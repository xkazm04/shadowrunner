// toDrive (avatar-renderer req 3.1, 3.6): maps driver state to rig-core's `Drive`. `Drive` has no
// gaze field, so gaze, drift and micro-saccades fold into `headYaw`/`headPitch`, clamped to
// rig-core's limits; jaw and blink are clamped to [0, 1]. Pure.
import { PITCH_LIMIT_DEG, YAW_LIMIT_DEG, type Drive } from "@sr/rig";
import type { DriverState } from "./state.js";

/** `value` limited to [lo, hi]; NaN becomes 0. */
const clamp = (value: number, lo: number, hi: number): number => (Number.isNaN(value) ? 0 : Math.min(hi, Math.max(lo, value)));

/** Eye closure at `s.t`: a half-sine over the running blink (shut at its middle), 0 outside one. */
function blinkAt(s: DriverState): number {
  if (s.blinkStart === undefined || s.blinkDuration === undefined) return 0;
  const progress = (s.t - s.blinkStart) / s.blinkDuration;
  if (!(progress >= 0 && progress < 1)) return 0;
  return clamp(Math.sin(Math.PI * progress), 0, 1);
}

/** The `Drive` for this frame; shares no objects with `s`. */
export function toDrive(s: DriverState): Drive {
  const drive: Drive = {
    t: s.t,
    headYaw: clamp(s.gazeYaw + s.drift.yaw + s.saccade.yaw, -YAW_LIMIT_DEG, YAW_LIMIT_DEG),
    headPitch: clamp(s.drift.pitch + s.saccade.pitch, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG),
    jawOpen: clamp(s.jaw, 0, 1),
    blink: blinkAt(s),
  };
  if (s.gesture !== undefined) drive.gesture = { name: s.gesture.name, startedAt: s.gesture.startedAt };
  return drive;
}
