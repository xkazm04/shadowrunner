// Driver unit tests (avatar-renderer task 1): the RNG matches the reference mulberry32, the rest
// state, toDrive's folding of gaze + drift + saccade, the blink curve, and dt clamping.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PITCH_LIMIT_DEG, YAW_LIMIT_DEG } from "../../../rig/src/index.js";
import { toDrive } from "../driver/drive.js";
import { nextRandom, seedRng, uniform } from "../driver/rng.js";
import * as constants from "../driver/state.js";
import { GAZE_TARGET_DEG, initialState, MAX_STEP_S, type DriverState } from "../driver/state.js";
import { step } from "../driver/step.js";
import { arbInputs, arbSeed, arbSteps, last, simulate } from "./driverArb.js";

/** The classic closure form of mulberry32, as published. */
function referenceMulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REST: DriverState = {
  t: 0,
  rng: 0,
  nextBlinkAt: 3,
  drift: { yaw: 0, pitch: 0, phase: 0 },
  saccade: { yaw: 0, pitch: 0, nextAt: 1 },
  gazeYaw: 0,
  jaw: 0,
};

describe("rng", () => {
  it("matches the reference mulberry32 sequence and stays in [0, 1)", () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const reference = referenceMulberry32(seed);
        let state = seedRng(seed);
        for (let i = 0; i < 20; i += 1) {
          const [value, next] = nextRandom(state);
          expect(value).toBe(reference());
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
          expect(Number.isInteger(next) && next >= 0 && next < 2 ** 32).toBe(true);
          state = next;
        }
      }),
    );
  });

  it("uniform scales into [min, max) and non-finite seeds become 0", () => {
    const [value] = uniform(seedRng(7), 2, 6);
    expect(value).toBeGreaterThanOrEqual(2);
    expect(value).toBeLessThan(6);
    expect(seedRng(Number.NaN)).toBe(0);
    expect(seedRng(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("constants", () => {
  it("are the values of requirements 3.2-3.4 and 4.2 (design.md 'Contracts'), since the properties import them", () => {
    expect(constants).toMatchObject({
      BLINK_GAP_MIN_S: 2,
      BLINK_GAP_MAX_S: 6,
      BLINK_MIN_S: 0.12,
      BLINK_MAX_S: 0.18,
      DRIFT_YAW_DEG: 4,
      DRIFT_PITCH_DEG: 2,
      SACCADE_MAX_DEG: 1,
      SACCADE_GAP_MIN_S: 0.4,
      SACCADE_GAP_MAX_S: 1.2,
      GAZE_TARGET_DEG: { host: 0, content: -8, chat: 10 },
      GAZE_EASE_S: 0.3,
      JAW_FLOOR: 0.04,
      JAW_ATTACK_S: 0.04,
      JAW_RELEASE_S: 0.12,
    });
    // Low frequency: a drift period of several seconds.
    expect((2 * Math.PI) / constants.DRIFT_RATE).toBeGreaterThan(5);
  });
});

describe("initialState", () => {
  it("is at rest at t = 0, looking at the host, with no blink or gesture keys", () => {
    const s = initialState(42);
    expect(s.t).toBe(0);
    expect(s.jaw).toBe(0);
    expect(s.gazeYaw).toBe(GAZE_TARGET_DEG.host);
    expect(s.saccade.yaw).toBe(0);
    expect(s.saccade.pitch).toBe(0);
    expect(Object.keys(s).sort()).toEqual(["drift", "gazeYaw", "jaw", "nextBlinkAt", "rng", "saccade", "t"]);
  });

  it("is deterministic per seed, and seeds differ", () => {
    expect(initialState(1)).toEqual(initialState(1));
    expect(initialState(1)).not.toEqual(initialState(2));
  });
});

describe("toDrive", () => {
  it("folds gaze, drift and saccade into the head angles and clamps them", () => {
    const s: DriverState = { ...REST, t: 1.5, gazeYaw: -8, drift: { yaw: 3, pitch: -1.5, phase: 2 }, saccade: { yaw: 0.5, pitch: 0.25, nextAt: 2 }, jaw: 0.4 };
    expect(toDrive(s)).toEqual({ t: 1.5, headYaw: -4.5, headPitch: -1.25, jawOpen: 0.4, blink: 0 });
    const wild: DriverState = { ...REST, gazeYaw: 50, drift: { yaw: 0, pitch: -40, phase: 0 }, jaw: 3 };
    expect(toDrive(wild)).toMatchObject({ headYaw: YAW_LIMIT_DEG, headPitch: -PITCH_LIMIT_DEG, jawOpen: 1 });
    expect(toDrive({ ...REST, jaw: Number.NaN }).jawOpen).toBe(0);
  });

  it("closes and reopens the eyes over the blink with a half-sine", () => {
    const blinking = (t: number): DriverState => ({ ...REST, t, blinkStart: 1, blinkDuration: 0.16 });
    expect(toDrive(blinking(1)).blink).toBe(0);
    expect(toDrive(blinking(1.08)).blink).toBeCloseTo(1, 12);
    expect(toDrive(blinking(1.04)).blink).toBeCloseTo(Math.SQRT1_2, 12);
    expect(toDrive(blinking(1.2)).blink).toBe(0);
  });

  it("copies the gesture cue, so the Drive shares nothing with the state", () => {
    const s: DriverState = { ...REST, gesture: { name: "nod", startedAt: 0.5 } };
    const d = toDrive(s);
    expect(d.gesture).toEqual(s.gesture);
    expect(d.gesture).not.toBe(s.gesture);
  });
});

describe("step", () => {
  // Finite dt first: with the clamp missing, an Infinity or 1e9 dt makes the blink and saccade
  // schedules loop for good, so the bounded case is what turns red with an assertion.
  it.each([
    ["any finite dt in [-10, 10] s", fc.double({ min: -10, max: 10, noNaN: true })],
    ["NaN, -0, +-Infinity and 1e9", fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e9, -0)],
  ])("advances t by dt, clamped to [0, MAX_STEP_S], and keeps every range for %s", (_label, arbAnyDt) => {
    fc.assert(
      fc.property(arbSeed, arbSteps({}, 50), arbAnyDt, arbInputs(), (seed, steps, dt, inputs) => {
        const before = last(initialState(seed), simulate(initialState(seed), steps));
        const after = step(before, dt, inputs);
        const expected = Number.isFinite(dt) ? Math.min(MAX_STEP_S, Math.max(0, dt)) : dt > 0 ? MAX_STEP_S : 0;
        expect(after.t - before.t).toBeCloseTo(expected, 12);
        const d = toDrive(after);
        for (const v of [d.t, d.headYaw, d.headPitch, d.jawOpen, d.blink]) expect(Number.isFinite(v)).toBe(true);
        expect(d.jawOpen).toBeGreaterThanOrEqual(0);
        expect(d.jawOpen).toBeLessThanOrEqual(1);
        expect(after.nextBlinkAt).toBeGreaterThan(after.t);
      }),
    );
  });
});
