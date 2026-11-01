// Look-at properties (costume requirement 9.2): `lookAtOffset` is bounded by its limits, monotone in
// each axis (and each axis independent of the other), and the identity at the centre; through the
// driver, a held point eases the gaze toward its offset, every Drive stays inside rig-core's
// clamps, and a driver never given a point is exactly the driver it was before (no `gazePitch`).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PITCH_LIMIT_DEG, YAW_LIMIT_DEG } from "@sr/rig";
import { toDrive } from "../driver/drive.js";
import { LOOK_AT_LIMITS, lookAtOffset, type LookAtLimits, type LookAtPoint } from "../driver/lookAt.js";
import { GAZE_EASE_S, GAZE_TARGET_DEG, initialState } from "../driver/state.js";
import { step } from "../driver/step.js";
import { resolveLookAt } from "../react/AvatarCanvas.js";
import { advanceFrame } from "../react/loop.js";
import { arbState, arbSteps, between, GAZES, simulate, type Step } from "./driverArb.js";

const EPS = 1e-9;

/** Mostly inside the view, sometimes outside it or NaN: the clamps are part of the contract. */
const arbCoord: fc.Arbitrary<number> = fc.oneof(
  { weight: 8, arbitrary: between(-1, 1) },
  { weight: 2, arbitrary: between(-50, 50) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0) },
);
const arbPoint: fc.Arbitrary<LookAtPoint> = fc.record({ x: arbCoord, y: arbCoord });
/** Inside the view only: monotonicity is judged where NaN cannot sit between two values. */
const arbInside: fc.Arbitrary<number> = between(-1.5, 1.5);
const arbLimits: fc.Arbitrary<LookAtLimits> = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ ...LOOK_AT_LIMITS }) },
  { weight: 4, arbitrary: fc.record({ yaw: between(0, YAW_LIMIT_DEG), pitch: between(0, PITCH_LIMIT_DEG) }) },
);

describe("lookAtOffset (property)", () => {
  it("is bounded: |yaw| <= limits.yaw and |pitch| <= limits.pitch, and always finite", () => {
    fc.assert(
      fc.property(arbPoint, arbLimits, (point, limits) => {
        const { yaw, pitch } = lookAtOffset(point, limits);
        expect(Number.isFinite(yaw) && Number.isFinite(pitch)).toBe(true);
        expect(Math.abs(yaw)).toBeLessThanOrEqual(limits.yaw + EPS);
        expect(Math.abs(pitch)).toBeLessThanOrEqual(limits.pitch + EPS);
      }),
    );
  });

  it("is monotone in each axis, and each axis ignores the other", () => {
    fc.assert(
      fc.property(arbInside, arbInside, arbInside, arbInside, arbLimits, (a, b, c, d, limits) => {
        const [x1, x2] = a <= b ? [a, b] : [b, a];
        const [y1, y2] = c <= d ? [c, d] : [d, c];
        const lo = lookAtOffset({ x: x1, y: y1 }, limits);
        const hi = lookAtOffset({ x: x2, y: y2 }, limits);
        expect(lo.yaw).toBeLessThanOrEqual(hi.yaw + EPS);
        expect(lo.pitch).toBeLessThanOrEqual(hi.pitch + EPS);
        expect(lookAtOffset({ x: x1, y: y2 }, limits).yaw).toBe(lo.yaw);
        expect(lookAtOffset({ x: x2, y: y1 }, limits).pitch).toBe(lo.pitch);
      }),
    );
  });

  it("is the identity at the centre: (0, 0) maps to exactly { yaw: 0, pitch: 0 }", () => {
    fc.assert(
      fc.property(arbLimits, (limits) => {
        expect(lookAtOffset({ x: 0, y: 0 }, limits)).toEqual({ yaw: 0, pitch: 0 });
        expect(Object.is(lookAtOffset({ x: -0, y: -0 }, limits).yaw, 0)).toBe(true);
      }),
    );
  });

  it("reaches the limits at the edges, toward the point (right is +yaw, down is +pitch)", () => {
    expect(lookAtOffset({ x: 1, y: 1 })).toEqual({ yaw: LOOK_AT_LIMITS.yaw, pitch: LOOK_AT_LIMITS.pitch });
    expect(lookAtOffset({ x: -1, y: -1 })).toEqual({ yaw: -LOOK_AT_LIMITS.yaw, pitch: -LOOK_AT_LIMITS.pitch });
  });
});

describe("lookAt through the driver (property)", () => {
  it("a held point eases gaze yaw and pitch 95% of the way to gaze target + offset in 300 ms", () => {
    fc.assert(
      fc.property(arbState(), arbPoint, fc.constantFrom(...GAZES), arbSteps(), (state, lookAt, gaze, steps) => {
        const held: Step[] = steps.map(([dt, inputs]) => [dt, { ...inputs, gaze, lookAt }]);
        const eased = simulate(state, held, GAZE_EASE_S).find((s) => s.t - state.t >= GAZE_EASE_S);
        const offset = lookAtOffset(lookAt);
        const yawTarget = GAZE_TARGET_DEG[gaze] + offset.yaw;
        expect(Math.abs((eased?.gazeYaw ?? Number.NaN) - yawTarget)).toBeLessThanOrEqual(0.05 * Math.abs(state.gazeYaw - yawTarget) + EPS);
        expect(Math.abs((eased?.gazePitch ?? Number.NaN) - offset.pitch)).toBeLessThanOrEqual(0.05 * Math.abs(offset.pitch) + EPS);
      }),
    );
  });

  it("every Drive stays inside rig-core's head clamps whatever the point", () => {
    fc.assert(
      fc.property(arbState(), arbPoint, arbSteps(), (state, lookAt, steps) => {
        const held: Step[] = steps.map(([dt, inputs]) => [dt, { ...inputs, lookAt }]);
        for (const s of simulate(state, held, 1)) {
          const drive = toDrive(s);
          expect(Math.abs(drive.headYaw)).toBeLessThanOrEqual(YAW_LIMIT_DEG);
          expect(Math.abs(drive.headPitch)).toBeLessThanOrEqual(PITCH_LIMIT_DEG);
        }
      }),
    );
  });

  it("absent, nothing changes: a driver never given a point carries no gazePitch, and a point at the centre leaves yaw alone", () => {
    fc.assert(
      fc.property(arbState(), arbSteps(), (state, steps) => {
        fc.pre(state.gazePitch === undefined);
        for (const s of simulate(state, steps, 0.5)) expect(s.gazePitch).toBeUndefined();
        const [dt, inputs] = steps[0] ?? [0.016, { level: 0, gaze: "host" as const, reducedMotion: false }];
        const plain = step(state, dt, inputs);
        const centred = step(state, dt, { ...inputs, lookAt: { x: 0, y: 0 } });
        expect(centred.gazeYaw).toBe(plain.gazeYaw);
        expect(Math.abs(toDrive(centred).headPitch - toDrive(plain).headPitch)).toBeLessThanOrEqual(EPS);
      }),
    );
  });
});

describe("the lookAt prop", () => {
  it("takes a point or a ref read each frame; a ref holding nothing, or no prop, is no point", () => {
    const point = { x: 0.5, y: -0.25 };
    const ref: { current: LookAtPoint | null } = { current: null };
    expect(resolveLookAt(undefined)).toBeUndefined();
    expect(resolveLookAt(point)).toBe(point);
    expect(resolveLookAt(ref)).toBeUndefined();
    ref.current = point;
    expect(resolveLookAt(ref)).toBe(point);
  });

  it("reaches the driver through the frame loop", () => {
    const state = initialState(1);
    const frame = { dt: 0.05, level: 0, gaze: "host" as const, reducedMotion: true };
    expect(advanceFrame(state, frame).state.gazePitch).toBeUndefined();
    const looked = advanceFrame(state, { ...frame, lookAt: { x: 1, y: 1 } });
    expect(looked.state.gazePitch).toBeGreaterThan(0);
    expect(looked.drive.headYaw).toBeGreaterThan(advanceFrame(state, frame).drive.headYaw);
  });
});
