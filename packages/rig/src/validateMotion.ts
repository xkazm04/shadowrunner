// Motion checks (cast-forge req 1.2, design.md "Motion"): shape and range of `Layer.motion` on an
// undecoded value. Called by validateRig (every problem becomes a `bad_shape` error) and by the
// legacy import (a problem drops that curve with a warning). Every problem is reported, each at
// its own path under `<layer>.motion`: `.float.amp[0]`, `.float.amp[1]`, `.float.freq`,
// `.float.rot_deg`, `.float.phase`, `.pulse.amp`, `.pulse.freq`, `.pulse.phase`, `.blink.freq`,
// `.blink.phase` (blink: cast-forge task 6; that it sits on an eye layer is validateRig's check).
// A range that depends on the canvas (float amp) is checked only against a known canvas size.
// `Rig.motion` / `Look.motion` (perfection-pass V1) are read by `readRigMotion`: `spring` in
// [0, SPRING_STRENGTH_MAX] at `<path>.spring`, the whole field at `<path>` when not an object.
import type { BlinkMotion, FloatMotion, Motion, PulseMotion, RigMotion } from "./types.js";

/** Float amplitude limit, as a fraction of the canvas width (x) and height (y). */
export const FLOAT_AMP_MAX = 0.05;
/** Frequency range, Hz, for float and pulse. */
export const MOTION_FREQ_MIN = 0.02;
export const MOTION_FREQ_MAX = 2;
/** Float rotation limit, degrees. */
export const FLOAT_ROT_MAX_DEG = 15;
/** Pulse amplitude limit (a light gain of up to 1 + this). */
export const PULSE_AMP_MAX = 1;

export interface MotionProblem {
  path: string;
  message: string;
}

export interface MotionRead {
  /** The motion, as a fresh object of contract fields only; undefined when absent or faulty. */
  motion?: Motion;
  problems: MotionProblem[];
}

/** Canvas size the float amplitude is bounded by; a dimension that is unknown is not checked. */
export interface MotionCanvas {
  width?: number;
  height?: number;
}

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `a ${typeof value}`;
}

class MotionReader {
  readonly problems: MotionProblem[] = [];

  fail(path: string, message: string): undefined {
    this.problems.push({ path, message: `${path}: ${message}` });
    return undefined;
  }

  /** A finite number in [lo, hi] (or [lo, hi) when `open`); `hi` undefined means no upper bound. */
  number(value: unknown, path: string, lo: number, hi: number | undefined, open = false): number | undefined {
    const range = hi === undefined ? `>= ${lo}` : `in [${lo}, ${hi}${open ? ")" : "]"}`;
    if (!isFiniteNumber(value)) return this.fail(path, `expected a number ${range}, got ${describe(value)}`);
    const above = hi !== undefined && (open ? value >= hi : value > hi);
    if (value < lo || above) return this.fail(path, `expected a number ${range}, got ${value}`);
    return value;
  }

  phase(fields: Fields, path: string): number | undefined {
    return fields.phase === undefined ? undefined : this.number(fields.phase, `${path}.phase`, 0, 1, true);
  }

  float(value: unknown, path: string, canvas: MotionCanvas): FloatMotion | undefined {
    if (!isRecord(value)) return this.fail(path, `expected a float object, got ${describe(value)}`);
    const before = this.problems.length;
    let ax: number | undefined;
    let ay: number | undefined;
    const amp = value.amp;
    if (Array.isArray(amp) && amp.length === 2) {
      const [x, y]: unknown[] = Array.from(amp);
      const maxX = canvas.width === undefined ? undefined : FLOAT_AMP_MAX * canvas.width;
      const maxY = canvas.height === undefined ? undefined : FLOAT_AMP_MAX * canvas.height;
      ax = this.number(x, `${path}.amp[0]`, 0, maxX);
      ay = this.number(y, `${path}.amp[1]`, 0, maxY);
    } else {
      this.fail(`${path}.amp`, `expected [x, y] canvas px, got ${describe(amp)}`);
    }
    const freq = this.number(value.freq, `${path}.freq`, MOTION_FREQ_MIN, MOTION_FREQ_MAX);
    const rot = value.rot_deg === undefined ? undefined : this.number(value.rot_deg, `${path}.rot_deg`, 0, FLOAT_ROT_MAX_DEG);
    const phase = this.phase(value, path);
    if (this.problems.length > before || ax === undefined || ay === undefined || freq === undefined) return undefined;
    return { amp: [ax, ay], freq, ...(rot === undefined ? {} : { rot_deg: rot }), ...(phase === undefined ? {} : { phase }) };
  }

  pulse(value: unknown, path: string): PulseMotion | undefined {
    if (!isRecord(value)) return this.fail(path, `expected a pulse object, got ${describe(value)}`);
    const before = this.problems.length;
    const amp = this.number(value.amp, `${path}.amp`, 0, PULSE_AMP_MAX);
    const freq = this.number(value.freq, `${path}.freq`, MOTION_FREQ_MIN, MOTION_FREQ_MAX);
    const phase = this.phase(value, path);
    if (this.problems.length > before || amp === undefined || freq === undefined) return undefined;
    return { amp, freq, ...(phase === undefined ? {} : { phase }) };
  }

  blink(value: unknown, path: string): BlinkMotion | undefined {
    if (!isRecord(value)) return this.fail(path, `expected a blink object, got ${describe(value)}`);
    const before = this.problems.length;
    const freq = this.number(value.freq, `${path}.freq`, MOTION_FREQ_MIN, MOTION_FREQ_MAX);
    const phase = this.phase(value, path);
    if (this.problems.length > before || freq === undefined) return undefined;
    return { freq, ...(phase === undefined ? {} : { phase }) };
  }
}

/** Reads one curve, `float` or `pulse`, at `path` (the curve's own path). */
export function readFloat(value: unknown, path: string, canvas: MotionCanvas): { float?: FloatMotion; problems: MotionProblem[] } {
  const reader = new MotionReader();
  const float = reader.float(value, path, canvas);
  return { ...(float === undefined ? {} : { float }), problems: reader.problems };
}

export function readPulse(value: unknown, path: string): { pulse?: PulseMotion; problems: MotionProblem[] } {
  const reader = new MotionReader();
  const pulse = reader.pulse(value, path);
  return { ...(pulse === undefined ? {} : { pulse }), problems: reader.problems };
}

/** The largest secondary motion strength (perfection-pass V1, `RigMotion.spring`). */
export const SPRING_STRENGTH_MAX = 2;

/**
 * `Rig.motion` or `Look.motion` at `path` (perfection-pass V1); absent is fine. Faults: not an
 * object (at `path`), `spring` not a number in [0, SPRING_STRENGTH_MAX] (at `<path>.spring`).
 */
export function readRigMotion(value: unknown, path: string): { motion?: RigMotion; problems: MotionProblem[] } {
  if (value === undefined) return { problems: [] };
  if (!isRecord(value)) return { problems: [{ path, message: `${path}: when present, expected a motion object, got ${describe(value)}` }] };
  const reader = new MotionReader();
  const spring = value.spring === undefined ? undefined : reader.number(value.spring, `${path}.spring`, 0, SPRING_STRENGTH_MAX);
  if (reader.problems.length > 0) return { problems: reader.problems };
  return { motion: spring === undefined ? {} : { spring }, problems: [] };
}

/** `Layer.motion` at `path` (e.g. `$.layers[3].motion`); absent is fine. */
export function readMotion(value: unknown, path: string, canvas: MotionCanvas): MotionRead {
  if (value === undefined) return { problems: [] };
  if (!isRecord(value)) return { problems: [{ path, message: `${path}: when present, expected a motion object, got ${describe(value)}` }] };
  const reader = new MotionReader();
  const float = value.float === undefined ? undefined : reader.float(value.float, `${path}.float`, canvas);
  const pulse = value.pulse === undefined ? undefined : reader.pulse(value.pulse, `${path}.pulse`);
  const blink = value.blink === undefined ? undefined : reader.blink(value.blink, `${path}.blink`);
  if (reader.problems.length > 0) return { problems: reader.problems };
  return { motion: { ...(float === undefined ? {} : { float }), ...(pulse === undefined ? {} : { pulse }), ...(blink === undefined ? {} : { blink }) }, problems: [] };
}
