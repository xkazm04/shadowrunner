// Look-at (costume requirement 9; design.md "Shared seams"): the face follows a point. Pure, no DOM.
//
// Decisions the spec leaves open:
// - "Normalised view space" is the avatar's box mapped to [-1, 1] on each axis: (0, 0) is the
//   centre, x grows to the right, y grows downward (as client coordinates do). A caller maps a
//   pointer with `x = 2 * (clientX - left) / width - 1` (and likewise y). Points outside the box
//   clamp to its edge; NaN counts as the centre.
// - Rig-core's `Drive` has no eye field: the eyes are layers that follow the head with parallax, so
//   the bias goes into head yaw and pitch, and the eyes move with them. The offsets are added to
//   the driver's gaze target (`step`) and eased like gaze; `toDrive` still clamps the sum to
//   rig-core's YAW_LIMIT_DEG / PITCH_LIMIT_DEG, so the rig's limits always hold.
// - The mapping is linear inside the box: monotone in each axis, each axis independent of the
//   other, zero at the centre and at most `limits` at the edge.

export interface LookAtPoint {
  /** -1 (left edge) .. 1 (right edge); 0 is the centre. */
  x: number;
  /** -1 (top edge) .. 1 (bottom edge); 0 is the centre. */
  y: number;
}

/** Largest bias, degrees, at the edge of the view; each >= 0. */
export interface LookAtLimits {
  yaw: number;
  pitch: number;
}

/** Degrees of head turn toward the point: positive yaw turns right, positive pitch looks down. */
export interface LookAtOffset {
  yaw: number;
  pitch: number;
}

/**
 * Default limits: a little over half of rig-core's head range (22 deg yaw, 12 deg pitch), so a
 * gaze target (up to 10 deg) plus the bias plus drift stays mostly inside it before the clamp.
 */
export const LOOK_AT_LIMITS: Readonly<LookAtLimits> = Object.freeze({ yaw: 12, pitch: 6 });

/** `value` limited to [-1, 1]; NaN becomes 0. */
const unit = (value: number): number => (Number.isNaN(value) ? 0 : Math.min(1, Math.max(-1, value)));

/** A limit as a usable magnitude: negative or NaN is 0, infinity is kept out by the caller. */
const magnitude = (limit: number): number => (Number.isFinite(limit) && limit > 0 ? limit : 0);

/** `value` with -0 folded into 0, so the centre maps to exactly 0. */
const plain = (value: number): number => (value === 0 ? 0 : value);

/** Pure: the head offset toward `point`, within `limits`. The centre maps to { yaw: 0, pitch: 0 }. */
export function lookAtOffset(point: LookAtPoint, limits: LookAtLimits = LOOK_AT_LIMITS): LookAtOffset {
  return {
    yaw: plain(unit(point.x) * magnitude(limits.yaw)),
    pitch: plain(unit(point.y) * magnitude(limits.pitch)),
  };
}
