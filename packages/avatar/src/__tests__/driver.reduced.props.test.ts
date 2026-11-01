// Reduced-motion properties (avatar-renderer req 5.1, 5.2; task 1.2): drift and micro-saccade
// components are exactly 0 on every reduced frame, while blinks, the mouth, gaze and gestures run
// exactly as they would with full motion.
//
// Generator: random frames rarely reach a saccade (the first comes 0.4-1.2 s in, more than a
// default-size array of frames covers), so a fault that leaks the saccade offset into reduced
// frames went unseen. Each script is therefore built to contain the risky cases:
//   1. full motion for at least SACCADE_GAP_MAX_S (+0-6 s): the saccade offset is non-zero;
//   2. 0-3 s of frames whose reducedMotion flips per frame: toggles both ways;
//   3. reduced motion for at least 2 x SACCADE_GAP_MAX_S: saccade jumps happen while reduced.
// The first reduced frame therefore always enters with a non-zero drift and saccade, and the
// property asserts those cases were seen, so the generator cannot quietly go weak again.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { YAW_LIMIT_DEG } from "../../../rig/src/index.js";
import { toDrive } from "../driver/drive.js";
import { BLINK_GAP_MAX_S, initialState, SACCADE_GAP_MAX_S, type DriverState } from "../driver/state.js";
import { step } from "../driver/step.js";
import { arbSeed, arbSteps, between, fillFor, simulate, type Step } from "./driverArb.js";

interface Script {
  seed: number;
  steps: Step[];
}

const arbScript: fc.Arbitrary<Script> = fc
  .tuple(
    arbSeed,
    arbSteps({ reducedMotion: fc.constant(false) }),
    between(0, 6),
    arbSteps({ reducedMotion: fc.boolean() }),
    between(0, 3),
    arbSteps({ reducedMotion: fc.constant(true) }),
    between(0, 3),
  )
  .map(([seed, full, fullExtra, mixed, mixedS, reduced, reducedExtra]) => ({
    seed,
    steps: [
      ...fillFor(full, SACCADE_GAP_MAX_S + fullExtra),
      ...fillFor(mixed, mixedS),
      ...fillFor(reduced, 2 * SACCADE_GAP_MAX_S + reducedExtra),
    ],
  }));

const moving = (s: DriverState): boolean => s.saccade.yaw !== 0 || s.saccade.pitch !== 0;

describe("driver under reduced motion", () => {
  it("drift and saccade components are exactly 0 on every reduced frame, so the head turns by gaze alone", () => {
    fc.assert(
      fc.property(arbScript, ({ seed, steps }) => {
        let enteredMoving = 0;
        let enteredDrifting = 0;
        let jumpedWhileReduced = 0;
        let prev = initialState(seed);
        for (const [dt, inputs] of steps) {
          const s = step(prev, dt, inputs);
          if (inputs.reducedMotion) {
            if (moving(prev)) enteredMoving += 1;
            if (prev.drift.yaw !== 0 || prev.drift.pitch !== 0) enteredDrifting += 1;
            if (s.saccade.nextAt !== prev.saccade.nextAt) jumpedWhileReduced += 1;
            expect(s.drift.yaw).toBe(0);
            expect(s.drift.pitch).toBe(0);
            expect(s.saccade.yaw).toBe(0);
            expect(s.saccade.pitch).toBe(0);
            const d = toDrive(s);
            expect(d.headYaw).toBe(Math.min(YAW_LIMIT_DEG, Math.max(-YAW_LIMIT_DEG, s.gazeYaw)));
            expect(d.headPitch).toBe(0);
          }
          prev = s;
        }
        // Vacuity guards: the script reached the cases that matter (see the header).
        expect(enteredMoving).toBeGreaterThan(0);
        expect(enteredDrifting).toBeGreaterThan(0);
        expect(jumpedWhileReduced).toBeGreaterThan(0);
      }),
    );
  });

  it("reduced motion changes nothing but drift and saccade offsets: blinks, mouth, gaze, gestures and schedules match full motion", () => {
    fc.assert(
      fc.property(arbScript, ({ seed, steps }) => {
        const asFull = steps.map(([dt, inputs]): Step => [dt, { ...inputs, reducedMotion: false }]);
        const reduced = simulate(initialState(seed), steps, BLINK_GAP_MAX_S + 0.5);
        const full = simulate(initialState(seed), asFull, BLINK_GAP_MAX_S + 0.5);
        expect(reduced.length).toBe(full.length);
        reduced.forEach((r, i) => {
          const f = full[i];
          if (f === undefined) throw new Error("runs differ in length");
          const { drift: rd, saccade: rs, ...rRest } = r;
          const { drift: fd, saccade: fs, ...fRest } = f;
          expect(rRest).toEqual(fRest);
          expect(rd.phase).toBe(fd.phase);
          expect(rs.nextAt).toBe(fs.nextAt);
          const rDrive = toDrive(r);
          const fDrive = toDrive(f);
          expect(rDrive.blink).toBe(fDrive.blink);
          expect(rDrive.jawOpen).toBe(fDrive.jawOpen);
          expect(rDrive.gesture).toEqual(fDrive.gesture);
        });
      }),
    );
  });

  it("blinks and the audio-driven mouth stay live with reduced motion on throughout", () => {
    fc.assert(
      fc.property(arbSeed, arbSteps({ reducedMotion: fc.constant(true), level: between(0.5, 1) }), (seed, steps) => {
        const states = simulate(initialState(seed), steps, BLINK_GAP_MAX_S + 0.5);
        expect(states.some((s) => toDrive(s).blink > 0)).toBe(true);
        expect(states.some((s) => toDrive(s).jawOpen > 0.3)).toBe(true);
      }),
    );
  });
});
