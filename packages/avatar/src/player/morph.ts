// A morph rig's keys per frame (companion-lanes design "Tracks", "Sway"): the frame body
// (player/frame.ts) hands this the final drive, the face profile, the mouth's shape mix and the
// spring lag, and gets the frame clock's `morph` (render/types.ts `MorphFrame`), or undefined when no
// key is active and nothing sways (the morph layer then draws exactly as any layer).
//
// Decisions the spec leaves open:
// - Blink is `Drive.blink`: the morph layer is a head layer, which carries no blink of its own
//   (validateRig allows `motion.blink` on eye layers only).
// - Sway signal (design "Sway"): the channel springs (@sr/rig spring.ts, stepped by the frame body
//   for every rig, with or without accessory layers) give the head group's lag behind its own motion.
//   A hanging pixel trails the head: the yaw and the roll lags move it sideways, the pitch and the
//   lift lags up and down, each normalised by SWAY_FULL (the lag at which a weight-1 pixel moves by
//   the full `amp`), summed, times the rig's spring strength, plus a slow idle drift of at most
//   SWAY_IDLE (two incommensurate sines per axis), clamped to [-1, 1]. A roll turns the head about
//   its pivot above the hanging hair, so a positive (clockwise) roll lag swings it to the left.
// - Reduced motion (`still`), a `drive` override (a frozen screenshot: no springs) at the frame body,
//   or spring strength 0: L = 0 and no drift.
// - Speak (round 3): how much the mouth is speaking, the mouth mix's non-rest total (capped at 1),
//   followed with a fast attack (95 % in SPEAK_ATTACK_S) and a slow release (SPEAK_RELEASE_S),
//   exponential in dt, so it does not depend on the frame rate and a smile's lower face does not
//   flicker back between words. 0 without mouth shapes (no mouth keys). A frozen frame takes the
//   total as it is; `speak` in the inputs (a capture's override) wins over both.
// - Allocation: one MorphFrame and one sway vector per frame body, refilled; the plan is @sr/rig's.
import { FACE_DEFAULTS, morphPlan, springStrength, type Drive, type Look, type MorphInputs, type ResolvedFace, type Rig, type SpringChannels } from "@sr/rig";
import type { ShapeWeights } from "../mouth/shapes.js";
import type { MorphFrame } from "../render/types.js";

/** The spring lag per channel at which a weight-1 pixel moves by the full sway `amp` (L = 1). */
export const SWAY_FULL = Object.freeze({ yaw: 0.08, pitch: 0.08, roll: 0.03, lift: 0.006 });
/** The idle drift's largest |L| per axis. */
export const SWAY_IDLE = 0.15;
/** Seconds to cover 95 % of the way to a higher / a lower speak. */
export const SPEAK_ATTACK_S = 0.06;
export const SPEAK_RELEASE_S = 0.35;

/** The mouth mix's non-rest total, 0..1 (non-positive and non-finite weights count 0). */
export function speakOf(shapes: Readonly<Partial<Record<string, number>>> | undefined): number {
  if (shapes === undefined) return 0;
  let total = 0;
  for (const [shape, w] of Object.entries(shapes)) if (shape !== "rest" && w !== undefined && w > 0 && Number.isFinite(w)) total += w;
  return Math.min(1, total);
}

/** `from` eased toward `to` over `dt` s: attack when rising, release when falling (95 % in each time). */
export function easeSpeak(from: number, to: number, dt: number): number {
  const s = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const ease = to > from ? SPEAK_ATTACK_S : SPEAK_RELEASE_S;
  return from + (to - from) * (1 - Math.pow(0.05, s / ease));
}

const clampUnit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0);

/** The sway lag L for a spring lag at `t`, into `out` (module header); (0, 0) when `still` or strength 0. */
export function swayLag(lag: SpringChannels | undefined, t: number, strength: number, still: boolean, out: { x: number; y: number }): { x: number; y: number } {
  out.x = 0;
  out.y = 0;
  const k = Number.isFinite(strength) ? Math.max(0, strength) : 0;
  if (still || k === 0) return out;
  const s = Number.isFinite(t) ? t : 0;
  const idleX = SWAY_IDLE * (0.6 * Math.sin(2 * Math.PI * 0.13 * s) + 0.4 * Math.sin(2 * Math.PI * 0.071 * s + 1.3));
  const idleY = SWAY_IDLE * 0.5 * Math.sin(2 * Math.PI * 0.09 * s + 0.7);
  const x = lag === undefined ? 0 : lag.yaw / SWAY_FULL.yaw - lag.roll / SWAY_FULL.roll;
  const y = lag === undefined ? 0 : lag.pitch / SWAY_FULL.pitch + lag.lift / SWAY_FULL.lift;
  out.x = clampUnit(k * (x + idleX));
  out.y = clampUnit(k * (y + idleY));
  return out;
}

export interface MorphFrameInputs {
  /** The dressed rig (its `morph` is the rig's own object). */
  rig: Rig;
  look: Look;
  /** The frame's final drive (blink, gaze, mood, t, still). */
  drive: Drive;
  face: ResolvedFace;
  /** The mouth's emotion-free shape mix when the rig's mouth mode is "morph"; else undefined (rest). */
  shapes: Readonly<ShapeWeights> | undefined;
  /** The spring lag (`Drive.spring`); undefined at rest or when the springs are off. */
  lag: SpringChannels | undefined;
  /** A `drive` override (a frozen frame): no sway, not even the idle drift; speak is the mix's total. */
  frozen: boolean;
  /** Seconds since the previous frame (the speak's ease). Omitted: 0. */
  dt?: number;
  /** A capture's speak, 0..1, overriding the followed one. */
  speak?: number | undefined;
}

/** A per-mount morph step: the frame clock's `morph` for this frame, or undefined (none). */
export function createMorphFrame(): (inputs: MorphFrameInputs) => MorphFrame | undefined {
  const sway = { x: 0, y: 0 };
  const inputs: MorphInputs = { blink: 0, emotion: "neutral", face: FACE_DEFAULTS };
  let out: MorphFrame | undefined;
  let speak = 0;
  return (p) => {
    const morph = p.rig.morph;
    if (morph === undefined) return undefined;
    inputs.blink = p.drive.blink;
    inputs.gaze = p.drive.gaze;
    inputs.shapes = p.shapes;
    inputs.emotion = p.look.emotion;
    inputs.mood = p.drive.mood;
    inputs.face = p.face;
    const total = speakOf(p.shapes);
    speak = p.frozen ? total : easeSpeak(speak, total, p.dt ?? 0);
    inputs.speak = p.speak !== undefined && Number.isFinite(p.speak) ? Math.min(1, Math.max(0, p.speak)) : speak;
    const plan = morphPlan(morph, inputs);
    swayLag(p.lag, p.drive.t, morph.sway === undefined ? 0 : springStrength(p.rig, p.look), p.drive.still === true || p.frozen, sway);
    if (!(plan.count > 0 || sway.x !== 0 || sway.y !== 0)) return undefined;
    if (out?.plan !== plan) out = { plan, sway };
    return out;
  };
}
