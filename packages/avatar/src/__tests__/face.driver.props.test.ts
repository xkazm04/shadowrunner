// The gaze driver with a face profile (face-control WP-A, driver/eyes.ts): a rig without irises keeps
// today's head-only gaze exactly (the default drift multiplier changes nothing, the head's draws stay
// in step); with irises the eyes lead (look-at, content, chat, idle glances by habit, saccades at the
// profile's rate), stay inside the socket, and the head follows them, damped; drift scales.
import fc from "fast-check";
import { FACE_DEFAULTS } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { toDrive } from "../driver/drive.js";
import { EYE_TARGETS, HEAD_FOLLOW_DEG, pickGlance } from "../driver/eyes.js";
import { initialState, type DriverFace, type DriverInputs, type DriverState } from "../driver/state.js";
import { step } from "../driver/step.js";
import { arbSeed, arbSteps } from "./driverArb.js";

const EYES: DriverFace = { drift: 1, eyes: { saccadeRate: FACE_DEFAULTS.gaze.saccadeRate, habits: { ...FACE_DEFAULTS.gaze.habits } } };
const IDLE: DriverInputs = { level: 0, gaze: "host", reducedMotion: false };

function run(seed: number, seconds: number, inputs: DriverInputs, dt = 1 / 60): DriverState[] {
  const out: DriverState[] = [];
  let s = initialState(seed);
  for (let t = 0; t < seconds; t += dt) {
    s = step(s, dt, inputs);
    out.push(s);
  }
  return out;
}

describe("gaze driver with a face profile", () => {
  it("without irises: `face` with drift 1 changes no state and no Drive", () => {
    fc.assert(
      fc.property(arbSeed, arbSteps({}, 60), (seed, steps) => {
        let a = initialState(seed);
        let b = initialState(seed);
        for (const [dt, inputs] of steps) {
          a = step(a, dt, inputs);
          b = step(b, dt, { ...inputs, face: { drift: 1 } });
          expect(b).toEqual(a);
          expect(toDrive(b)).toEqual(toDrive(a));
        }
      }),
      { numRuns: 60 },
    );
  });

  it("with irises: the head's blinks and drift draws stay those of a rig without them; the gaze stays in the socket", () => {
    fc.assert(
      fc.property(arbSeed, arbSteps({}, 80), (seed, steps) => {
        let a = initialState(seed);
        let b = initialState(seed);
        for (const [dt, inputs] of steps) {
          a = step(a, dt, inputs);
          b = step(b, dt, { ...inputs, face: EYES });
          expect([b.nextBlinkAt, b.blinkStart, b.drift, b.rng]).toEqual([a.nextBlinkAt, a.blinkStart, a.drift, a.rng]);
          const gaze = toDrive(b).gaze;
          expect(gaze).toBeDefined();
          expect(Math.abs(gaze?.x ?? 9)).toBeLessThanOrEqual(1);
          expect(Math.abs(gaze?.y ?? 9)).toBeLessThanOrEqual(1);
          expect(toDrive(a).gaze).toBeUndefined();
        }
      }),
      { numRuns: 60 },
    );
  });

  it("motion.drift scales the idle drift (0 stops it, 2 doubles it)", () => {
    const base = run(3, 5, IDLE).at(-1) as DriverState;
    const none = run(3, 5, { ...IDLE, face: { drift: 0 } }).at(-1) as DriverState;
    const double = run(3, 5, { ...IDLE, face: { drift: 2 } }).at(-1) as DriverState;
    expect(none.drift.yaw).toBe(0);
    expect(double.drift.yaw).toBeCloseTo(2 * base.drift.yaw, 12);
    expect(double.drift.pitch).toBeCloseTo(2 * base.drift.pitch, 12);
  });

  it("the eyes lead a look-at point and the head follows, damped", () => {
    const states = run(5, 3, { ...IDLE, lookAt: { x: 1, y: 0.5 }, face: { drift: 0, eyes: { saccadeRate: 0, habits: { chat: 0, content: 0, host: 1 } } } });
    const at = (seconds: number): DriverState => states[Math.round(seconds * 60) - 1] as DriverState;
    expect(toDrive(at(0.15)).gaze?.x).toBeGreaterThan(0.95);
    // After 0.15 s the eyes are there; the head has covered well under half of its way.
    expect(at(0.15).gazeYaw).toBeLessThan(HEAD_FOLLOW_DEG.yaw * 0.5);
    expect(at(3).gazeYaw).toBeCloseTo(HEAD_FOLLOW_DEG.yaw, 1);
    expect(toDrive(at(3)).headYaw).toBeCloseTo(HEAD_FOLLOW_DEG.yaw, 1);
    expect(toDrive(at(3)).headPitch).toBeCloseTo(HEAD_FOLLOW_DEG.pitch * 0.5, 1);
  });

  it("content and chat are eye targets; habits all 0 keep the eyes on the viewer; saccade rate 0 holds them still", () => {
    const still = { saccadeRate: 0, habits: { chat: 0, content: 0, host: 0 } };
    const chat = run(1, 1, { ...IDLE, gaze: "chat", face: { drift: 1, eyes: still } }).at(-1) as DriverState;
    expect(toDrive(chat).gaze?.x).toBeCloseTo(EYE_TARGETS.chat.x, 6);
    const content = run(1, 1, { ...IDLE, gaze: "content", face: { drift: 1, eyes: still } }).at(-1) as DriverState;
    expect(toDrive(content).gaze?.x).toBeCloseTo(EYE_TARGETS.content.x, 6);
    for (const s of run(2, 20, { ...IDLE, face: { drift: 1, eyes: still } })) expect(toDrive(s).gaze).toEqual({ x: 0, y: 0 });
  });

  it("idle glances follow the habits, and saccades come at about the profile's rate", () => {
    const only = (habits: { chat: number; content: number; host: number }, rate: number): DriverState[] => run(9, 60, { ...IDLE, face: { drift: 1, eyes: { saccadeRate: rate, habits } } });
    const chatty = only({ chat: 1, content: 0, host: 0 }, 0);
    expect(chatty.some((s) => s.eyes?.glance === "chat")).toBe(true);
    expect(chatty.some((s) => s.eyes?.glance === "content")).toBe(false);
    const jumps = (states: DriverState[]): number => states.filter((s, i) => i > 0 && s.eyes?.saccade.x !== states[i - 1]?.eyes?.saccade.x).length;
    const fast = jumps(only({ chat: 0, content: 0, host: 1 }, 2));
    expect(fast).toBeGreaterThan(80);
    expect(fast).toBeLessThan(160);
    expect(pickGlance({ chat: 1, content: 1, host: 2 }, 0.1)).toBe("chat");
    expect(pickGlance({ chat: 1, content: 1, host: 2 }, 0.3)).toBe("content");
    expect(pickGlance({ chat: 1, content: 1, host: 2 }, 0.9)).toBe("host");
  });

  it("reduced motion: no glances and no saccade offset, but a target asked for is still looked at", () => {
    const states = run(4, 30, { ...IDLE, reducedMotion: true, face: EYES });
    for (const s of states) expect(toDrive(s).gaze).toEqual({ x: 0, y: 0 });
    const chat = run(4, 1, { ...IDLE, gaze: "chat", reducedMotion: true, face: EYES }).at(-1) as DriverState;
    expect(toDrive(chat).gaze?.x).toBeCloseTo(EYE_TARGETS.chat.x, 6);
  });
});
