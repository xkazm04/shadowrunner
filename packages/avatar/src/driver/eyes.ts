// The eyes lead the gaze (face-control, WP-A "Gaze driver"): on a rig with iris layers the gaze
// targets, the look-at point, idle glances and micro-saccades move the irises inside their sockets
// first, and the head follows the eyes' target slowly (damped), with the idle drift on top. Pure,
// like step.ts: no mutation, randomness only from the eyes' own rng.
//
// Decisions the brief leaves open:
// - Units: the gaze is -1..1 per axis of the socket's half extents (x right, y down); pose.ts turns
//   it into canvas px with the socket size and gaze.range.
// - Targets: a look-at point (normalised view space, driver/lookAt.ts) is the eye target itself
//   (clamped to the socket); else the caller's gaze "content" or "chat" (EYE_TARGETS, the sides
//   GAZE_TARGET_DEG turns the head to); else, at "host", the idle glances: every GLANCE_GAP_* s the
//   eyes pick chat, content or host (stay) by the gaze.habits weights, and a glance away holds for
//   GLANCE_HOLD_* s before the eyes come back. All habits 0 means the eyes stay on the viewer.
// - Saccades: gaze.saccadeRate jumps per second on average (gaps uniform in [0.5, 1.5] / rate), each
//   toward a point in the disk of radius EYE_SACCADE, by at most EYE_SACCADE (as the head's).
// - Reduced motion: glances and saccade jumps wait while the driver's `motion` is below 1 (their
//   schedules still run) and the saccade offset is scaled by `motion`, as the head's drift and
//   saccades; a target the caller asks for (look-at, content, chat) is still looked at.
// - The head follows the eyes' target (not their saccades) by HEAD_FOLLOW_DEG per unit, eased over
//   HEAD_FOLLOW_S; the drift (times motion.drift) is added in toDrive. The head's own saccades are
//   not added on such a rig: the eyes make them.
// - The eyes' rng is seeded from the head's at the first eye step and never draws from it, so the
//   head's blinks, drift and saccade schedule are exactly those of a rig without irises.
import { uniform } from "./rng.js";
import { EASE_SHARE, type DriverInputs, type DriverState, type EyeState, type Gaze } from "./state.js";

/** Eye target per gaze, socket units: content to the left and down, chat to the right (GAZE_TARGET_DEG sides). */
export const EYE_TARGETS: Readonly<Record<Gaze, { x: number; y: number }>> = Object.freeze({ host: { x: 0, y: 0 }, content: { x: -0.8, y: 0.35 }, chat: { x: 0.8, y: 0.25 } });
/** Time for the eyes to cover 95% of the way to a new target, seconds (a saccade is quick). */
export const EYE_EASE_S = 0.06;
/** Head turn per unit of eye target, degrees, and its ease (95%), seconds. */
export const HEAD_FOLLOW_DEG = Object.freeze({ yaw: 8, pitch: 4 });
export const HEAD_FOLLOW_S = 0.9;
/** Largest micro-saccade jump and offset, socket units. */
export const EYE_SACCADE = 0.12;
/** Gap between idle glance choices, and how long a glance away holds, seconds. */
export const GLANCE_GAP_MIN_S = 2;
export const GLANCE_GAP_MAX_S = 5;
export const GLANCE_HOLD_MIN_S = 0.6;
export const GLANCE_HOLD_MAX_S = 1.6;

/** Seeds the eyes' rng from the head's state without drawing from it. */
const EYE_SEED_MIX = 0x5bd1e995;

const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0);
const easeShare = (dt: number, ease: number): number => 1 - Math.pow(1 - EASE_SHARE, dt / ease);

/** The eyes at rest at `t`, looking at the viewer, their first glance and saccade drawn. */
export function initialEyes(seed: number, t: number): EyeState {
  const [gap, r1] = uniform((seed ^ EYE_SEED_MIX) >>> 0, GLANCE_GAP_MIN_S, GLANCE_GAP_MAX_S);
  const [next, rng] = uniform(r1, 0.4, 1.2);
  return { rng, x: 0, y: 0, saccade: { x: 0, y: 0, nextAt: t + next }, glance: "host", glanceUntil: t + gap };
}

type Habits = NonNullable<NonNullable<DriverInputs["face"]>["eyes"]>["habits"];

/** A glance drawn by weight from `u` in [0, 1): chat, content or host (stay); host when every weight is 0. */
export function pickGlance(habits: Habits, u: number): Gaze {
  const w = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
  const [chat, content, host] = [w(habits.chat), w(habits.content), w(habits.host)];
  const total = chat + content + host;
  if (!(total > 0)) return "host";
  const at = u * total;
  return at < chat ? "chat" : at < chat + content ? "content" : "host";
}

/** Runs the glance schedule up to `t`; glances away start only while `free` (full motion). */
function stepGlance(e: EyeState, t: number, habits: Habits, free: boolean): Pick<EyeState, "rng" | "glance" | "glanceUntil"> {
  let { rng, glance, glanceUntil } = e;
  while (glanceUntil <= t) {
    const [u, r1] = uniform(rng, 0, 1);
    const [hold, r2] = uniform(r1, GLANCE_HOLD_MIN_S, GLANCE_HOLD_MAX_S);
    const [gap, r3] = uniform(r2, GLANCE_GAP_MIN_S, GLANCE_GAP_MAX_S);
    rng = r3;
    const pick = glance === "host" && free ? pickGlance(habits, u) : "host";
    glance = pick;
    glanceUntil += pick === "host" ? gap : hold;
  }
  return { rng, glance, glanceUntil };
}

/** Jumps the saccade offset at every scheduled time up to `t` (only while `free`); rate 0 holds it at rest. */
function stepEyeSaccade(e: EyeState, t: number, rng: number, rate: number, free: boolean): { rng: number; saccade: EyeState["saccade"] } {
  if (!(rate > 0)) return { rng, saccade: { x: 0, y: 0, nextAt: t } };
  let { x, y, nextAt } = e.saccade;
  while (nextAt <= t) {
    const [angle, r1] = uniform(rng, 0, 2 * Math.PI);
    const [u, r2] = uniform(r1, 0, 1);
    const [gap, r3] = uniform(r2, 0.5 / rate, 1.5 / rate);
    if (free) {
      const radius = EYE_SACCADE * Math.sqrt(u);
      const dx = radius * Math.cos(angle) - x;
      const dy = radius * Math.sin(angle) - y;
      const reach = Math.min(1, EYE_SACCADE / (Math.hypot(dx, dy) || 1));
      x += dx * reach;
      y += dy * reach;
    }
    nextAt += gap;
    rng = r3;
  }
  return { rng, saccade: { x, y, nextAt } };
}

/** The eye target for this step: a look-at point, the caller's gaze, or the idle glance. */
function targetOf(inputs: DriverInputs, glance: Gaze): { x: number; y: number } {
  if (inputs.lookAt !== undefined) return { x: unit(inputs.lookAt.x), y: unit(inputs.lookAt.y) };
  return EYE_TARGETS[inputs.gaze === "host" ? glance : inputs.gaze] ?? EYE_TARGETS.host;
}

export interface EyeStep {
  eyes: EyeState;
  /** The head's gaze (degrees) eased toward following the eyes' target. */
  gazeYaw: number;
  gazePitch: number;
}

/** The eyes `elapsed` seconds later (at `t`), and the head following them; `motion` is the driver's this step. */
export function stepEyes(s: DriverState, t: number, elapsed: number, inputs: DriverInputs, motion: number): EyeStep {
  const profile = inputs.face?.eyes ?? { saccadeRate: 0, habits: { chat: 0, content: 0, host: 1 } };
  const e = s.eyes ?? initialEyes(s.rng, s.t);
  const free = motion === 1 && (s.motion ?? motion) === 1;
  const glance = stepGlance(e, t, profile.habits, free);
  const { rng, saccade } = stepEyeSaccade(e, t, glance.rng, profile.saccadeRate, free);
  const target = targetOf(inputs, glance.glance);
  const k = easeShare(elapsed, EYE_EASE_S);
  const eyes: EyeState = { rng, x: e.x + (target.x - e.x) * k, y: e.y + (target.y - e.y) * k, saccade, glance: glance.glance, glanceUntil: glance.glanceUntil };
  const h = easeShare(elapsed, HEAD_FOLLOW_S);
  const pitchFrom = s.gazePitch ?? 0;
  return {
    eyes,
    gazeYaw: s.gazeYaw + (target.x * HEAD_FOLLOW_DEG.yaw - s.gazeYaw) * h,
    gazePitch: pitchFrom + (target.y * HEAD_FOLLOW_DEG.pitch - pitchFrom) * h,
  };
}

/** The gaze the irises show: the eased target plus the saccade at `motion`, clamped to the socket. */
export function eyeGaze(s: Pick<DriverState, "eyes" | "motion">): { x: number; y: number } | undefined {
  const e = s.eyes;
  if (e === undefined) return undefined;
  const m = s.motion ?? 1;
  return { x: unit(e.x + (m === 0 ? 0 : e.saccade.x * m)), y: unit(e.y + (m === 0 ? 0 : e.saccade.y * m)) };
}
