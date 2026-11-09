// The driver's channel springs (perfection-pass V1, driver/step.ts `stepSpring`): deterministic,
// stable for any dt up to MAX_STEP_S, frame-rate independent (a 30 fps and a 120 fps run of one
// motion agree), at rest exactly zero once the target holds still, and off (undefined) without a
// target. The frame body carries the lag to the pose: none under reduced motion, at strength 0 or
// for a drive override; a head tilt makes a loose part lag and overshoot, then settle to the
// springless pose.
import { defaultLook, SPRING_KEYS, type Rig, type SpringChannels } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFrameBody, type FrameBodyInputs } from "../player/frame.js";
import { MAX_STEP_S, SPRING_LAG_MAX, type SpringState } from "../driver/state.js";
import { springLag, stepSpring } from "../driver/step.js";

const ZERO: SpringChannels = { yaw: 0, pitch: 0, roll: 0, scale: 0, lift: 0, actDx: 0, actDy: 0, actRot: 0 };
/** A smooth head turn and tilt: yaw eases to 0.45 over 0.3 s from 0.2 s, a 0.4 s roll half-sine at 0.6 s. */
function motion(t: number): SpringChannels {
  const u = Math.min(1, Math.max(0, (t - 0.2) / 0.3));
  const roll = t >= 0.6 && t <= 1 ? 0.087 * Math.sin((Math.PI * (t - 0.6)) / 0.4) : 0;
  return { ...ZERO, yaw: 0.45 * u * u * (3 - 2 * u), roll };
}

function runAt(fps: number, seconds: number): Map<number, SpringChannels | undefined> {
  let s: SpringState | undefined;
  const out = new Map<number, SpringChannels | undefined>();
  const n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i += 1) {
    s = stepSpring(s, i === 0 ? 0 : 1 / fps, motion(i / fps));
    if ((i * 30) % fps === 0) out.set(Math.round((i * 30) / fps), springLag(s));
  }
  return out;
}

describe("stepSpring", () => {
  it("a 30 fps and a 120 fps run of the same motion agree at every shared frame", () => {
    const slow = runAt(30, 3);
    const fast = runAt(120, 3);
    for (const key of SPRING_KEYS) {
      let peak = 0;
      let gap = 0;
      for (const [frame, lag] of fast) {
        const a = lag?.[key] ?? 0;
        peak = Math.max(peak, Math.abs(a));
        gap = Math.max(gap, Math.abs(a - (slow.get(frame)?.[key] ?? 0)));
      }
      if (key === "yaw" || key === "roll") expect(peak).toBeGreaterThan(0.005);
      // Within 5% of the largest lag the channel reaches: only the target's sampling differs.
      expect(gap).toBeLessThanOrEqual(0.05 * peak);
    }
  });

  it("is deterministic, finite and within SPRING_LAG_MAX for any dt sequence up to past MAX_STEP_S", () => {
    const target = fc.record({ yaw: fc.double({ min: -1, max: 1, noNaN: true }), roll: fc.double({ min: -0.2, max: 0.2, noNaN: true }), actRot: fc.double({ min: -0.5, max: 0.5, noNaN: true }) });
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.double({ min: 0, max: 2 * MAX_STEP_S, noNaN: true }), target), { minLength: 1, maxLength: 60 }), (steps) => {
        const play = (): SpringState | undefined => steps.reduce<SpringState | undefined>((s, [dt, t]) => stepSpring(s, dt, { ...ZERO, ...t, actLayer: "x" }), undefined);
        const end = play();
        expect(play()).toEqual(end);
        end?.lag.forEach((e, c) => {
          expect(Number.isFinite(e)).toBe(true);
          expect(Math.abs(e)).toBeLessThanOrEqual(SPRING_LAG_MAX[c] ?? 0);
        });
        // Held still for 3 s at any frame rate: exactly at rest.
        let s = end;
        for (let i = 0; i < 90; i += 1) s = stepSpring(s, 1 / 30, { ...ZERO, ...(steps.at(-1)?.[1] ?? {}) });
        expect(springLag(s)).toBeUndefined();
      }),
      { numRuns: 150 },
    );
  });

  it("starts at rest on its target, lags a moving one, and stops without a target", () => {
    const first = stepSpring(undefined, 1 / 60, { ...ZERO, yaw: 0.3 });
    expect(springLag(first)).toBeUndefined();
    const moved = stepSpring(first, 1 / 60, { ...ZERO, yaw: 0.35 });
    expect(springLag(moved)?.yaw).toBeLessThan(0);
    expect(stepSpring(moved, 1 / 60, undefined)).toBeUndefined();
  });
});

const RIG: Rig = {
  version: 1,
  id: "spring-test",
  name: "Spring",
  width: 400,
  height: 400,
  source: "forge",
  palette: { glow: "#22e07a", eye: "#22e07a", rim: "#e9e2cf", mouth: "#000000" },
  layers: [
    { name: "head", z: 0, kind: "head", file: "head.png", bbox: [120, 100, 160, 200], anchor: [200, 290] },
    { name: "eye", z: 1, kind: "eye", file: "eye.png", bbox: [170, 180, 30, 20], anchor: [185, 190], follow: "head" },
    { name: "plume", z: 2, kind: "crown", file: "plume.png", bbox: [185, 20, 30, 90], anchor: [200, 105], follow: "head", motion: { float: { amp: [0, 0], freq: 0.3, rot_deg: 2 } } },
  ],
};

function frames(over: Partial<FrameBodyInputs>, count = 80): { plume: number; eye: number }[] {
  const body = createFrameBody(3);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const poses = body({ rig: RIG, look: defaultLook(RIG), dt: 1 / 30, level: 0, gaze: "host", reducedMotion: false, ...over, ...(i === 20 ? { gesture: "tilt" as const } : {}) }).poses;
    out.push({ plume: poses.find((p) => p.name === "plume")?.rotation ?? NaN, eye: poses.find((p) => p.name === "eye")?.rotation ?? NaN });
  }
  return out;
}

describe("the frame body's springs", () => {
  const off = frames({ look: { ...defaultLook(RIG), motion: { spring: 0 } } });

  it("a tilt makes the plume lag and overshoot, then settle; the eye never moves", () => {
    const on = frames({});
    const diff = on.map((f, i) => f.plume - (off[i]?.plume ?? 0));
    expect(Math.min(...diff)).toBeLessThan(-0.005);
    expect(Math.max(...diff)).toBeGreaterThan(0.002);
    on.forEach((f, i) => expect(f.eye).toBe(off[i]?.eye));
  });

  it("reduced motion and a drive override: no spring at all", () => {
    expect(frames({ reducedMotion: true })).toEqual(frames({ reducedMotion: true, look: { ...defaultLook(RIG), motion: { spring: 0 } } }));
    const drive = { t: 1, headYaw: 10, headPitch: 0, jawOpen: 0, blink: 0 };
    expect(frames({ drive })).toEqual(frames({ drive, look: { ...defaultLook(RIG), motion: { spring: 0 } } }));
  });
});
