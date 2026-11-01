// fast-check arbitraries for the procedural driver (avatar-renderer task 1.2): seeds, frame
// times of 1-50 ms (design.md "Testing strategy"), input sequences and reached states, plus runners
// that step a state through a sequence.
//
// Generator strength: fast-check's default size caps arrays near 10 elements whatever `maxLength`
// says, i.e. well under 0.5 s of frames, shorter than the first saccade (>= 0.4 s) or blink
// (>= 2 s). So sequences ask for size "medium", and anything that must see blinks, saccades or
// gestures runs for an explicit number of seconds (`simulate`/`walk` cycle the frames) instead of
// relying on array length.
import fc from "fast-check";
import type { Gesture } from "../../../rig/src/index.js";
import { BLINK_GAP_MAX_S, initialState, type DriverInputs, type DriverState, type Gaze } from "../driver/state.js";
import { step } from "../driver/step.js";

export const GAZES: readonly Gaze[] = ["host", "content", "chat"];
export const GESTURES: readonly Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];

/**
 * Uniform on a 1/10000 grid of [min, max]. fc.double spreads draws over the float encoding, so most
 * of its values would be tiny magnitudes.
 */
export const between = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: 10_000 }).map((i) => min + ((max - min) * i) / 10_000);

/** Any 32-bit seed, signed or not. */
export const arbSeed: fc.Arbitrary<number> = fc.integer({ min: -(2 ** 31), max: 2 ** 32 - 1 });

/** A frame time of 1-50 ms, in seconds. */
export const arbDt: fc.Arbitrary<number> = fc.integer({ min: 1, max: 50 }).map((ms) => ms / 1000);

/** Mostly in range; sometimes out of range or NaN, since the clamps are part of the contract. */
export const arbLevel: fc.Arbitrary<number> = fc.oneof(
  { weight: 8, arbitrary: between(0, 1) },
  { weight: 1, arbitrary: between(-0.5, 1.5) },
  { weight: 1, arbitrary: fc.constantFrom(0, Number.NaN) },
);

/** No gesture on most frames (the key omitted), a gesture start on about one in thirty. */
export const arbGestureCue: fc.Arbitrary<Gesture | undefined> = fc.oneof(
  { weight: 29, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constantFrom(...GESTURES) },
);

export interface InputsOptions {
  level?: fc.Arbitrary<number>;
  gaze?: fc.Arbitrary<Gaze>;
  gesture?: fc.Arbitrary<Gesture | undefined>;
  /** Per frame. When omitted, a sequence is all full motion, all reduced, or mixed per frame. */
  reducedMotion?: fc.Arbitrary<boolean>;
}

/** One frame's inputs; each field arbitrary unless pinned by `options`. */
export function arbInputs(options: InputsOptions = {}): fc.Arbitrary<DriverInputs> {
  return fc
    .tuple(options.level ?? arbLevel, options.gaze ?? fc.constantFrom(...GAZES), options.gesture ?? arbGestureCue, options.reducedMotion ?? fc.boolean())
    .map(([level, gaze, gesture, reducedMotion]): DriverInputs => (gesture === undefined ? { level, gaze, reducedMotion } : { level, gaze, gesture, reducedMotion }));
}

export type Step = readonly [dt: number, inputs: DriverInputs];

type MotionMode = "full" | "reduced" | "mixed";

/**
 * A non-empty sequence of frames. Reduced motion is a user preference, so unless pinned it is held
 * for the whole sequence (full or reduced) or flips per frame (mixed, to cover the toggles).
 */
export function arbSteps(options: InputsOptions = {}, maxLength = 100): fc.Arbitrary<Step[]> {
  const frames = fc.array(fc.tuple(arbDt, arbInputs(options)), { minLength: 1, maxLength, size: "medium" });
  if (options.reducedMotion !== undefined) return frames;
  const mode = fc.constantFrom<MotionMode>("full", "reduced", "mixed");
  return fc.tuple(mode, frames).map(([m, fs]) =>
    m === "mixed" ? fs : fs.map(([dt, inputs]): Step => [dt, { ...inputs, reducedMotion: m === "reduced" }]),
  );
}

/**
 * Steps `start` once through `steps`, then cycles them until at least `seconds` of driver time have
 * passed, calling `visit` with each frame's state before, state after and step. Every dt from arbDt
 * is positive, so this ends. Returns the last state (`start` when nothing ran).
 */
export function walk(
  start: DriverState,
  steps: readonly Step[],
  seconds: number,
  visit: (prev: DriverState, next: DriverState, frame: Step) => void,
): DriverState {
  let state = start;
  // Every dt is >= 1 ms, so a driver whose clock works never needs more frames than this.
  const maxFrames = steps.length + Math.ceil(seconds * 1000) + 1;
  for (let i = 0; i < steps.length || state.t - start.t < seconds; i += 1) {
    const frame = steps[i % steps.length];
    if (frame === undefined) throw new Error("walk needs at least one step");
    if (i > maxFrames) throw new Error(`driver time stalled at t = ${state.t}`);
    const next = step(state, frame[0], frame[1]);
    visit(state, next, frame);
    state = next;
  }
  return state;
}

/** The states after each step of `walk(start, steps, seconds)`. */
export function simulate(start: DriverState, steps: readonly Step[], seconds = 0): DriverState[] {
  const states: DriverState[] = [];
  walk(start, steps, seconds, (_prev, next) => states.push(next));
  return states;
}

/** The last state of `simulate`, or `start` itself when nothing ran. */
export function last(start: DriverState, states: readonly DriverState[]): DriverState {
  return states[states.length - 1] ?? start;
}

/**
 * A state reached from a random seed after 0-12 s of random frames, so saccades, gaze and jaw are
 * mid-flight and gestures often running; half of them then run on until a blink is in progress
 * (blinks start every <= 6 s and outlast any frame). The run-on is capped at one blink gap, so a
 * driver that never blinks fails the properties instead of hanging the generator.
 */
export function arbState(options: InputsOptions = {}): fc.Arbitrary<DriverState> {
  return fc.tuple(arbSeed, arbSteps(options), between(0, 12), fc.boolean()).map(([seed, steps, seconds, inBlink]) => {
    let state = walk(initialState(seed), steps, seconds, () => undefined);
    const until = state.t + BLINK_GAP_MAX_S + 0.5;
    for (let i = 0; inBlink && state.blinkStart === undefined && state.t < until; i += 1) {
      const frame = steps[i % steps.length];
      if (frame === undefined) throw new Error("arbState needs at least one step");
      if (i > (BLINK_GAP_MAX_S + 0.5) * 1000 + 1) throw new Error(`driver time stalled at t = ${state.t}`);
      state = step(state, frame[0], frame[1]);
    }
    return state;
  });
}

/** `steps` cycled to cover at least `seconds` (and less than one more frame); [] when empty. */
export function fillFor(steps: readonly Step[], seconds: number): Step[] {
  const out: Step[] = [];
  for (let t = 0, i = 0; t < seconds; i += 1) {
    const frame = steps[i % steps.length];
    if (frame === undefined) break;
    out.push(frame);
    t += frame[0];
  }
  return out;
}
