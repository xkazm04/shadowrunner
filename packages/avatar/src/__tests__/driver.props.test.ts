// Driver properties (avatar-renderer task 1.2, design.md "Testing strategy"): blink start gaps in
// [2, 6] s and lengths in [120, 180] ms; Drive and state components within their ranges; drift and
// saccade bounds; jaw, gaze and gesture timing; step and toDrive pure under deep-freeze. Reduced
// motion has its own file (driver.reduced.props.test.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GESTURE_DURATION_S, PITCH_LIMIT_DEG, YAW_LIMIT_DEG, type Drive } from "@sr/rig";
import { toDrive } from "../driver/drive.js";
import {
  BLINK_GAP_MAX_S,
  BLINK_GAP_MIN_S,
  BLINK_MAX_S,
  BLINK_MIN_S,
  DRIFT_PITCH_DEG,
  DRIFT_RATE,
  DRIFT_YAW_DEG,
  GAZE_EASE_S,
  GAZE_TARGET_DEG,
  initialState,
  JAW_ATTACK_S,
  JAW_FLOOR,
  JAW_RELEASE_S,
  SACCADE_GAP_MAX_S,
  SACCADE_GAP_MIN_S,
  SACCADE_MAX_DEG,
  type DriverState,
} from "../driver/state.js";
import { step } from "../driver/step.js";
import { arbDt, arbInputs, arbSeed, arbState, arbSteps, between, fillFor, GAZES, GESTURES, last, simulate, walk, type Step } from "./driverArb.js";

const EPS = 1e-9;
const within = (value: number, lo: number, hi: number): boolean => value >= lo - EPS && value <= hi + EPS;
const GAZE_SPAN = Math.max(...Object.values(GAZE_TARGET_DEG).map(Math.abs));

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Deep copy of plain data (keeps -0 and NaN, unlike a JSON round trip). */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

describe("driver properties", () => {
  it("step and toDrive are pure: deep-frozen inputs, identical outputs for identical (and cloned) inputs", () => {
    fc.assert(
      fc.property(arbState(), arbDt, arbInputs(), (state, dt, inputs) => {
        const frozen = deepFreeze(clone({ state, inputs }));
        const next = step(frozen.state, dt, frozen.inputs);
        expect(step(frozen.state, dt, frozen.inputs)).toEqual(next);
        expect(step(state, dt, inputs)).toEqual(next);
        expect(frozen).toEqual({ state, inputs });
        const frozenNext = deepFreeze(clone(next));
        expect(toDrive(frozenNext)).toEqual(toDrive(next));
        expect(frozenNext).toEqual(next);
      }),
    );
  });

  it("purity over whole runs: frozen frames, and two runs from one state replay identically (no hidden randomness)", () => {
    // One step rarely lands on a blink or saccade frame, so randomness drawn there needs runs of
    // seconds: 3 s holds at least two saccade jumps, and arbState is often mid-blink.
    fc.assert(
      fc.property(arbState(), arbSteps(), (state, steps) => {
        const run = (): { states: DriverState[]; drives: Drive[] } => {
          const states: DriverState[] = [];
          const drives: Drive[] = [];
          walk(deepFreeze(clone(state)), steps.map((frame) => deepFreeze(clone(frame))), 3, (prev, next) => {
            expect(Object.isFrozen(prev)).toBe(true);
            states.push(clone(next));
            drives.push(toDrive(deepFreeze(next)));
          });
          return { states, drives };
        };
        expect(run()).toEqual(run());
      }),
    );
  });

  it("blinks start at gaps drawn from [2, 6] s, last 120-180 ms, and none is missed", () => {
    fc.assert(
      fc.property(arbSeed, arbSteps(), (seed, steps) => {
        const start = initialState(seed);
        expect(within(start.nextBlinkAt, BLINK_GAP_MIN_S, BLINK_GAP_MAX_S)).toBe(true);
        const starts: number[] = [];
        let scheduled = start.nextBlinkAt;
        for (const s of simulate(start, steps, 20)) {
          expect(s.nextBlinkAt).toBeGreaterThan(s.t);
          if (s.nextBlinkAt !== scheduled) {
            expect(within(s.nextBlinkAt - scheduled, BLINK_GAP_MIN_S, BLINK_GAP_MAX_S), `gap ${s.nextBlinkAt - scheduled}`).toBe(true);
            // The blink that just started is the one that was scheduled.
            expect(s.blinkStart).toBe(scheduled);
            scheduled = s.nextBlinkAt;
          }
          if (s.blinkStart !== undefined && s.blinkStart !== starts[starts.length - 1]) starts.push(s.blinkStart);
          expect(s.blinkStart === undefined).toBe(s.blinkDuration === undefined);
          if (s.blinkDuration !== undefined) expect(within(s.blinkDuration, BLINK_MIN_S, BLINK_MAX_S)).toBe(true);
          if (s.blinkStart !== undefined && s.blinkDuration !== undefined) expect(s.t - s.blinkStart).toBeLessThan(s.blinkDuration);
        }
        expect(starts.length).toBeGreaterThanOrEqual(Math.floor(20 / BLINK_GAP_MAX_S));
        expect(within(starts[0] ?? Number.NaN, BLINK_GAP_MIN_S, BLINK_GAP_MAX_S)).toBe(true);
        for (let i = 1; i < starts.length; i += 1) {
          expect(within((starts[i] ?? 0) - (starts[i - 1] ?? 0), BLINK_GAP_MIN_S, BLINK_GAP_MAX_S)).toBe(true);
        }
      }),
    );
  });

  it("every Drive keeps jawOpen and blink in [0, 1] and head yaw and pitch within rig-core's clamps; state stays in range", () => {
    fc.assert(
      fc.property(arbSeed, arbSteps(), (seed, steps) => {
        // 15 s: at least two blinks, so the blink curve is sampled mid-blink.
        for (const s of simulate(initialState(seed), steps, 15)) {
          const d = toDrive(s);
          expect(within(d.jawOpen, 0, 1), `jawOpen ${d.jawOpen}`).toBe(true);
          expect(within(d.blink, 0, 1), `blink ${d.blink}`).toBe(true);
          expect(Math.abs(d.headYaw)).toBeLessThanOrEqual(YAW_LIMIT_DEG);
          expect(Math.abs(d.headPitch)).toBeLessThanOrEqual(PITCH_LIMIT_DEG);
          if (s.blinkStart === undefined) expect(d.blink).toBe(0);
          // The state itself: rig-core's clamps never have to rescue the driver.
          expect(within(s.jaw, 0, 1), `jaw ${s.jaw}`).toBe(true);
          expect(Math.abs(s.gazeYaw)).toBeLessThanOrEqual(GAZE_SPAN + EPS);
          expect(d.headYaw).toBe(s.gazeYaw + s.drift.yaw + s.saccade.yaw);
          expect(d.headPitch).toBe(s.drift.pitch + s.saccade.pitch);
        }
      }),
    );
  });

  it("drift is smooth and within +-4 deg yaw / +-2 deg pitch; saccades jump at most 1 deg every 0.4-1.2 s", () => {
    fc.assert(
      fc.property(arbSeed, arbSteps({ reducedMotion: fc.constant(false) }), (seed, steps) => {
        let jumps = 0;
        walk(initialState(seed), steps, 5, (prev, s) => {
          const dt = s.t - prev.t;
          expect(Math.abs(s.drift.yaw)).toBeLessThanOrEqual(DRIFT_YAW_DEG + EPS);
          expect(Math.abs(s.drift.pitch)).toBeLessThanOrEqual(DRIFT_PITCH_DEG + EPS);
          // Each axis is a weighted sum of sines whose weight x frequency adds up to under 1.5.
          expect(Math.abs(s.drift.yaw - prev.drift.yaw)).toBeLessThanOrEqual(1.5 * DRIFT_YAW_DEG * DRIFT_RATE * dt + EPS);
          expect(Math.abs(s.drift.pitch - prev.drift.pitch)).toBeLessThanOrEqual(1.5 * DRIFT_PITCH_DEG * DRIFT_RATE * dt + EPS);
          expect(Math.hypot(s.saccade.yaw, s.saccade.pitch)).toBeLessThanOrEqual(SACCADE_MAX_DEG + EPS);
          expect(Math.hypot(s.saccade.yaw - prev.saccade.yaw, s.saccade.pitch - prev.saccade.pitch)).toBeLessThanOrEqual(SACCADE_MAX_DEG + EPS);
          expect(s.saccade.nextAt).toBeGreaterThan(s.t);
          if (s.saccade.nextAt !== prev.saccade.nextAt) {
            expect(within(s.saccade.nextAt - prev.saccade.nextAt, SACCADE_GAP_MIN_S, SACCADE_GAP_MAX_S)).toBe(true);
            jumps += 1;
          } else {
            expect(s.saccade).toEqual(prev.saccade);
          }
        });
        // 5 s with gaps <= 1.2 s: at least 4 jumps, so the checks above did run on jump frames.
        expect(jumps).toBeGreaterThanOrEqual(Math.floor(5 / SACCADE_GAP_MAX_S));
      }),
    );
  });

  it("jawOpen settles under 0.01 within 250 ms of silence (or levels under the floor) from any state", () => {
    const quiet = arbSteps({ level: fc.oneof(between(0, JAW_FLOOR - 1e-4), fc.constantFrom(-0.2, Number.NaN)) });
    fc.assert(
      fc.property(arbState(), quiet, (state, steps) => {
        expect(toDrive(last(state, simulate(state, steps, 0.25))).jawOpen).toBeLessThan(0.01);
      }),
    );
  });

  it("jaw attack covers 95% in 40 ms and release covers 95% in 120 ms", () => {
    fc.assert(
      fc.property(arbState(), arbSteps({ level: fc.constant(1) }), arbSteps({ level: fc.constant(0) }), (state, loud, quiet) => {
        const opened = simulate(state, loud, JAW_ATTACK_S).find((s) => s.t - state.t >= JAW_ATTACK_S);
        expect(opened?.jaw).toBeGreaterThanOrEqual(0.95 - EPS);
        const top = last(state, simulate(state, loud, 0.5));
        const closed = simulate(top, quiet, JAW_RELEASE_S).find((s) => s.t - top.t >= JAW_RELEASE_S);
        expect(closed?.jaw).toBeLessThanOrEqual(0.05 * top.jaw + EPS);
      }),
    );
  });

  it("a steady level above the floor opens the jaw to (level - floor) / (1 - floor)", () => {
    fc.assert(
      fc.property(arbState(), between(JAW_FLOOR, 1), arbDt, (state, level, dt) => {
        const settled = last(state, simulate(state, [[dt, { level, gaze: "host", reducedMotion: false }]], 0.5));
        expect(Math.abs(settled.jaw - (level - JAW_FLOOR) / (1 - JAW_FLOOR))).toBeLessThan(1e-3);
      }),
    );
  });

  it("gaze eases head yaw 95% of the way to its target (0, -8, +10 deg) in 300 ms", () => {
    fc.assert(
      fc.property(arbState(), fc.constantFrom(...GAZES), arbSteps(), (state, gaze, steps) => {
        const target = GAZE_TARGET_DEG[gaze];
        const held: Step[] = steps.map(([dt, inputs]) => [dt, { ...inputs, gaze }]);
        const eased = simulate(state, held, GAZE_EASE_S).find((s) => s.t - state.t >= GAZE_EASE_S);
        expect(Math.abs((eased?.gazeYaw ?? Number.NaN) - target)).toBeLessThanOrEqual(0.05 * Math.abs(state.gazeYaw - target) + EPS);
      }),
    );
  });

  it("a gesture starts at the frame's t, replaces a running one, and is dropped (key omitted) once it ends", () => {
    const noCue = (steps: Step[]): Step[] => steps.map(([dt, { level, gaze, reducedMotion }]): Step => [dt, { level, gaze, reducedMotion }]);
    const cue = (dt: number, gesture: (typeof GESTURES)[number]): Step => [dt, { level: 0, gaze: "host", gesture, reducedMotion: false }];
    // Built so every run sees a start, a replacement within the first gesture (second cue at most
    // 0.25 + 0.05 + 0.05 s after the first, under GESTURE_DURATION_S) and an expiry at the end.
    const arbScript = fc
      .tuple(arbState(), arbDt, fc.constantFrom(...GESTURES), arbSteps(), between(0.05, 0.25), fc.constantFrom(...GESTURES), arbSteps())
      .map(([state, dt, a, quiet, gapS, b, any]) => ({ state, steps: [cue(dt, a), ...fillFor(noCue(quiet), gapS), cue(dt, b), ...any, ...fillFor(noCue(quiet), GESTURE_DURATION_S + 0.05)] }));
    fc.assert(
      fc.property(arbScript, ({ state, steps }) => {
        let replaced = 0;
        let expired = 0;
        let prev = state;
        for (const [dt, inputs] of steps) {
          const s = step(prev, dt, inputs);
          if (inputs.gesture !== undefined) {
            expect(s.gesture).toEqual({ name: inputs.gesture, startedAt: s.t });
            if (prev.gesture !== undefined && s.t - prev.gesture.startedAt <= GESTURE_DURATION_S) replaced += 1;
          } else if (prev.gesture !== undefined && s.t - prev.gesture.startedAt <= GESTURE_DURATION_S) {
            expect(s.gesture).toEqual(prev.gesture);
          } else {
            if (prev.gesture !== undefined) expired += 1;
            expect("gesture" in s).toBe(false);
          }
          const d = toDrive(s);
          if (s.gesture === undefined) expect("gesture" in d).toBe(false);
          else expect(d.gesture).toEqual(s.gesture);
          prev = s;
        }
        expect(replaced).toBeGreaterThan(0);
        expect(expired).toBeGreaterThan(0);
      }),
    );
  });
});
