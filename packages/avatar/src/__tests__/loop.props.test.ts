// The frame helpers behind <AvatarCanvas> (task 5, req 5.3, 6.2, 6.3).
import fc from "fast-check";
import { defaultLook, GESTURE_DURATION_S, poseLayers, type Drive, type Gesture } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { toDrive } from "../driver/drive.js";
import { initialState } from "../driver/state.js";
import { advanceFrame, cutGesture, isReducedMotion } from "../react/loop.js";
import { malakorRig } from "./malakor.js";

const GESTURES: Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];
const rig = malakorRig();
const look = defaultLook(rig);
const grid = (lo: number, hi: number) => fc.integer({ min: 0, max: 1000 }).map((i) => lo + ((hi - lo) * i) / 1000);
const driveArb = fc.record({
  startedAt: grid(0, 100),
  elapsed: grid(-0.5, 1),
  name: fc.constantFrom(...GESTURES),
  yaw: grid(-22, 22),
  jaw: grid(0, 1),
});
const toDriveOf = (d: { startedAt: number; elapsed: number; name: Gesture; yaw: number; jaw: number }): Drive => ({
  t: d.startedAt + d.elapsed,
  headYaw: d.yaw,
  headPitch: 0,
  jawOpen: d.jaw,
  blink: 0,
  gesture: { name: d.name, startedAt: d.startedAt },
});

describe("cutGesture", () => {
  it("under reduced motion holds a running gesture at its peak pose for its whole duration", () => {
    fc.assert(
      fc.property(driveArb, (d) => {
        const drive = toDriveOf(d);
        const cut = poseLayers(rig, look, cutGesture(drive, true));
        const running = d.elapsed >= 0 && d.elapsed <= GESTURE_DURATION_S;
        const peak = poseLayers(rig, look, { ...drive, t: d.startedAt + GESTURE_DURATION_S / 2 });
        const rest = poseLayers(rig, look, drive);
        expect(cut).toEqual(running ? peak : rest);
      }),
    );
  });

  it("leaves the drive alone with full motion", () => {
    fc.assert(
      fc.property(driveArb, (d) => {
        const drive = toDriveOf(d);
        return cutGesture(drive, false) === drive;
      }),
    );
  });
});

describe("advanceFrame", () => {
  it("steps the driver and poses with its Drive, or with the override", () => {
    const s0 = initialState(7);
    const frame = advanceFrame(s0, { dt: 0.05, level: 0, gaze: "chat", reducedMotion: false });
    expect(frame.drive).toEqual(toDrive(frame.state));
    expect(frame.state.t).toBeCloseTo(0.05, 12);
    const override: Drive = { t: 3, headYaw: 1, headPitch: 2, jawOpen: 0.5, blink: 0 };
    expect(advanceFrame(s0, { dt: 0.05, level: 0, gaze: "host", reducedMotion: false, drive: override }).drive).toEqual(override);
  });

  it("clamps the frame gap on the driver's clock", () => {
    expect(advanceFrame(initialState(1), { dt: 60, level: 0, gaze: "host", reducedMotion: false }).state.t).toBeCloseTo(0.1, 12);
  });
});

describe("isReducedMotion", () => {
  it("is on when the media query or the shell's data-motion says so", () => {
    expect(isReducedMotion(false, null)).toBe(false);
    expect(isReducedMotion(false, "full")).toBe(false);
    expect(isReducedMotion(true, "full")).toBe(true);
    expect(isReducedMotion(false, "reduced")).toBe(true);
  });
});
