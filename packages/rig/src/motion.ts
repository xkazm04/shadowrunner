// Layer motion at a time (cast-forge req 1.3, design.md "Motion"): pure and deterministic in `t`.
// With `w = 2*pi*(freq*t + phase)`, float gives a canvas-px translation
// `(amp[0]*sin(w), amp[1]*sin(w + pi/2))` and a rotation `rot_deg*sin(w + pi)` degrees, and pulse a
// light gain `1 + amp*(0.5 + 0.5*sin(w))`. `still` (reduced motion) gives no motion at all.
// An eye's own blink (cast-forge task 6) is `ownBlinkAt`: a closure, kept apart from the offset.
import type { Motion } from "./types.js";

export interface MotionOffset {
  /** Canvas px, added to the posed anchor. */
  dx: number;
  dy: number;
  /** Radians, clockwise on the y-down canvas, about the posed anchor. */
  rotation: number;
  /** Multiplied into the layer's tint; 1 = as drawn. */
  gain: number;
}

export const NO_MOTION: Readonly<MotionOffset> = Object.freeze({ dx: 0, dy: 0, rotation: 0, gain: 1 });

const angle = (freq: number, phase: number | undefined, t: number): number => 2 * Math.PI * (freq * t + (phase ?? 0));

/** The motion's offsets at `t` seconds; NO_MOTION when absent, still, or `t` is not finite. */
export function motionAt(motion: Motion | undefined, t: number, still = false): MotionOffset {
  if (motion === undefined || still || !Number.isFinite(t)) return { ...NO_MOTION };
  const { float, pulse } = motion;
  let dx = 0;
  let dy = 0;
  let rotation = 0;
  let gain = 1;
  if (float !== undefined) {
    const w = angle(float.freq, float.phase, t);
    dx = float.amp[0] * Math.sin(w);
    dy = float.amp[1] * Math.sin(w + Math.PI / 2);
    rotation = (((float.rot_deg ?? 0) * Math.PI) / 180) * Math.sin(w + Math.PI);
  }
  if (pulse !== undefined) {
    const w = angle(pulse.freq, pulse.phase, t);
    gain = 1 + pulse.amp * (0.5 + 0.5 * Math.sin(w));
  }
  return { dx, dy, rotation, gain };
}

/** FNV-1a 32-bit of `name`, as a phase in [0, 1) on a 1/1000 grid: stable per name. */
export function phaseFromName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return Math.floor((hash / 2 ** 32) * 1000) / 1000;
}

/** Length of an eye's own blink (cast-forge task 6), seconds: the middle of the driver's 0.12-0.18. */
export const OWN_BLINK_S = 0.15;

/**
 * The closure (0 open .. 1 shut) of the layer's own blink at `t`: a half-sine over OWN_BLINK_S from
 * each cycle's start (`frac(freq*t + phase) = 0`), 0 for the rest of the cycle; 0 when absent, still
 * or `t` is not finite.
 */
export function ownBlinkAt(motion: Motion | undefined, t: number, still = false): number {
  const blink = motion?.blink;
  if (blink === undefined || still || !Number.isFinite(t)) return 0;
  const cycle = blink.freq * t + (blink.phase ?? 0);
  const since = (cycle - Math.floor(cycle)) / blink.freq;
  return since < OWN_BLINK_S ? Math.sin((Math.PI * since) / OWN_BLINK_S) : 0;
}
