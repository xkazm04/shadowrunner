// Reduced-motion toggle properties (avatar-renderer task 1.5, req 3.3, 5.1): when `reducedMotion`
// flips mid-session, drift and saccade amplitude ease to the new level over MOTION_EASE_S (400 ms)
// instead of jumping.
//
// "Full-motion maximum step": the largest frame-to-frame change of the drift + saccade head offset
// a full-motion frame of length dt can make, i.e. the drift slope bound x dt plus one saccade jump
// (the same bounds driver.props.test.ts checks). The head offset at a toggle can be up to
// 4 + 1 = 5 deg yaw, so a cut to zero breaks the bound whenever it exceeds that step.
//
// Generator: a toggle only shows a cut when the offset at that moment is large, and the drift phase
// there is random, so a single script may toggle at small offsets. Scripts therefore hold full and
// reduced motion in several blocks (each long enough to settle), followed by per-frame flips, and
// a counter across all runs asserts that enough toggles happened at offsets above the bound.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toDrive } from "../driver/drive.js";
import { DRIFT_PITCH_DEG, DRIFT_RATE, DRIFT_YAW_DEG, driftAt, initialState, MOTION_EASE_S, SACCADE_GAP_MAX_S, SACCADE_MAX_DEG, type DriverState } from "../driver/state.js";
import { step } from "../driver/step.js";
import { arbSeed, arbState, arbSteps, between, fillFor, last, simulate, type Step } from "./driverArb.js";

const EPS = 1e-9;
/** Full-motion maximum step of the yaw and pitch offsets for a frame of `dt` seconds. */
const maxYawStep = (dt: number): number => 1.5 * DRIFT_YAW_DEG * DRIFT_RATE * dt + SACCADE_MAX_DEG;
const maxPitchStep = (dt: number): number => 1.5 * DRIFT_PITCH_DEG * DRIFT_RATE * dt + SACCADE_MAX_DEG;
/** The largest full-motion step for the longest generated frame (50 ms). */
const BIG_OFFSET = maxYawStep(0.05);

const offsetYaw = (s: DriverState): number => s.drift.yaw + s.saccade.yaw;
const offsetPitch = (s: DriverState): number => s.drift.pitch + s.saccade.pitch;

/** Frames all held at one motion setting, at least `seconds` long. */
const held = (reducedMotion: boolean, seconds: number): fc.Arbitrary<Step[]> =>
  fc.tuple(arbSteps({ reducedMotion: fc.constant(reducedMotion) }), between(0, 1)).map(([steps, extra]) => fillFor(steps, seconds + extra));

/** Full motion long enough to move, then 3-5 settled full/reduced blocks, then 0-2 s of per-frame flips. */
const arbToggleScript = fc
  .tuple(
    arbSeed,
    held(false, SACCADE_GAP_MAX_S),
    fc.array(fc.tuple(held(true, MOTION_EASE_S), held(false, MOTION_EASE_S + SACCADE_GAP_MAX_S)), { minLength: 3, maxLength: 5 }),
    arbSteps({ reducedMotion: fc.boolean() }),
    between(0, 2),
  )
  .map(([seed, start, blocks, flips, flipS]) => ({
    seed,
    steps: [...start, ...blocks.flatMap(([reduced, full]) => [...reduced, ...full]), ...fillFor(flips, flipS)],
  }));

describe("driver reduced-motion toggle", () => {
  it("no frame changes the drift + saccade offset (or head yaw beyond the gaze ease) by more than the full-motion maximum step", () => {
    let bigToggles = 0;
    fc.assert(
      fc.property(arbToggleScript, ({ seed, steps }) => {
        let prev = initialState(seed);
        let prevReduced: boolean | undefined;
        for (const [dt, inputs] of steps) {
          const s = step(prev, dt, inputs);
          const elapsed = s.t - prev.t;
          expect(Math.abs(offsetYaw(s) - offsetYaw(prev)), `yaw step at t = ${s.t}`).toBeLessThanOrEqual(maxYawStep(elapsed) + EPS);
          expect(Math.abs(offsetPitch(s) - offsetPitch(prev)), `pitch step at t = ${s.t}`).toBeLessThanOrEqual(maxPitchStep(elapsed) + EPS);
          const headStep = Math.abs(toDrive(s).headYaw - toDrive(prev).headYaw);
          expect(headStep).toBeLessThanOrEqual(Math.abs(s.gazeYaw - prev.gazeYaw) + maxYawStep(elapsed) + EPS);
          if (prevReduced === false && inputs.reducedMotion && Math.abs(offsetYaw(prev)) > BIG_OFFSET) bigToggles += 1;
          prevReduced = inputs.reducedMotion;
          prev = s;
        }
      }),
    );
    // Vacuity guard (see the header): a cut to zero would have broken the bound this often.
    expect(bigToggles).toBeGreaterThanOrEqual(50);
  });

  it("from settled full motion, the amplitude ramps down linearly and reaches exactly 0 after MOTION_EASE_S of reduced frames", () => {
    fc.assert(
      fc.property(arbSeed, held(false, MOTION_EASE_S), arbSteps({ reducedMotion: fc.constant(true) }), (seed, full, reduced) => {
        const settled = last(initialState(seed), simulate(initialState(seed), full));
        expect(settled.motion).toBe(1);
        let streak = 0;
        let ramped = 0;
        let prev = settled;
        for (const [dt, inputs] of fillFor(reduced, MOTION_EASE_S + 0.2)) {
          const s = step(prev, dt, inputs);
          streak += s.t - prev.t;
          const motion = s.motion ?? Number.NaN;
          expect(Math.abs(motion - Math.max(0, 1 - streak / MOTION_EASE_S))).toBeLessThan(1e-9);
          if (streak < MOTION_EASE_S - EPS) {
            expect(motion).toBeGreaterThan(0);
            ramped += 1;
          }
          if (streak >= MOTION_EASE_S + EPS) {
            expect(s.motion).toBe(0);
            expect([s.drift.yaw, s.drift.pitch, s.saccade.yaw, s.saccade.pitch]).toEqual([0, 0, 0, 0]);
          }
          prev = s;
        }
        expect(ramped).toBeGreaterThan(0);
      }),
    );
  });

  it("from any state, MOTION_EASE_S of full motion restores full amplitude: drift is exactly driftAt(phase)", () => {
    fc.assert(
      fc.property(arbState(), arbSteps({ reducedMotion: fc.constant(false) }), (state, full) => {
        let streak = 0;
        let prev = state;
        for (const [dt, inputs] of fillFor(full, MOTION_EASE_S + 0.2)) {
          const s = step(prev, dt, inputs);
          streak += s.t - prev.t;
          if (streak >= MOTION_EASE_S + EPS) {
            expect(s.motion).toBe(1);
            const { yaw, pitch } = driftAt(s.drift.phase);
            expect([s.drift.yaw, s.drift.pitch]).toEqual([yaw, pitch]);
          }
          prev = s;
        }
      }),
    );
  });

  it("the first step sets the amplitude straight to the input's level: no ramp at session start", () => {
    fc.assert(
      fc.property(arbSeed, fc.boolean(), arbSteps({}, 1), (seed, reducedMotion, [frame]) => {
        if (frame === undefined) throw new Error("arbSteps is non-empty");
        const s = step(initialState(seed), frame[0], { ...frame[1], reducedMotion });
        expect(s.motion).toBe(reducedMotion ? 0 : 1);
        if (reducedMotion) expect([s.drift.yaw, s.drift.pitch, s.saccade.yaw, s.saccade.pitch]).toEqual([0, 0, 0, 0]);
        else expect(s.drift).toEqual({ ...driftAt(s.drift.phase), phase: s.drift.phase });
      }),
    );
  });
});
