// Morph round 3 in the player (player/morph.ts): `speak` follows the mouth mix's non-rest total with
// a fast attack and a slow release, the same at any frame rate; a frozen frame takes the total, a
// capture's `speak` wins; and the plan's lower face key gives way to it.
import { defaultLook, type MorphKey, type Rig, type RigMorph } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createFrameBody } from "../player/frame.js";
import { easeSpeak, SPEAK_ATTACK_S, SPEAK_RELEASE_S, speakOf } from "../player/morph.js";
import { morphRig } from "./morphRig.js";

const run = (from: number, to: number, seconds: number, fps: number): number => {
  let s = from;
  for (let i = 0; i < Math.round(seconds * fps); i += 1) s = easeSpeak(s, to, 1 / fps);
  return s;
};

describe("speak", () => {
  it("is the mix's non-rest total, capped at 1", () => {
    expect(speakOf({ rest: 0.4, openMid: 0.6 })).toBeCloseTo(0.6, 12);
    expect(speakOf({ rest: 0, openWide: 0.8, round: 0.7 })).toBe(1);
    expect(speakOf(undefined)).toBe(0);
  });

  it("rises 95 % in the attack and falls 95 % in the release, at 24 and at 144 fps alike", () => {
    expect(run(0, 1, SPEAK_ATTACK_S, 1000)).toBeCloseTo(0.95, 2);
    expect(run(1, 0, SPEAK_RELEASE_S, 1000)).toBeCloseTo(0.05, 2);
    expect(run(1, 0, 0.125, 144)).toBeCloseTo(run(1, 0, 0.125, 24), 9);
    // A short pause between words leaves most of the speak in place.
    expect(run(1, 0, 0.08, 60)).toBeGreaterThan(0.45);
  });
});

describe("the frame body's lower face key", () => {
  const keys: MorphKey[] = [
    { id: "joy_up", track: "joy", part: "upper", bbox: [70, 70, 120, 130], cell: [0, 0, 10, 10] },
    { id: "joy_low", track: "joy", part: "lower", bbox: [70, 70, 120, 130], cell: [0, 0, 10, 10] },
    { id: "open", track: "openMid", bbox: [100, 150, 60, 40], cell: [0, 0, 10, 10] },
  ];
  const rig: Rig = { ...morphRig(), morph: { ...(morphRig().morph as RigMorph), keys } };
  delete rig.morph?.flow;
  const look = { ...defaultLook(rig), emotion: "delighted" as const };
  const lowColour = (out: ReturnType<ReturnType<typeof createFrameBody>>): number => out.clock.morph?.plan.colour[1] ?? NaN;
  const DRIVE = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };

  it("a frozen frame takes the mix's total; a capture's speak overrides it", () => {
    const shapes = { rest: 0.3, openWide: 0, openMid: 0.7, round: 0, closed: 0, teeth: 0, tongue: 0, narrow: 0 };
    const body = createFrameBody(1);
    expect(lowColour(body({ rig, look, dt: 0, level: 0, gaze: "host", reducedMotion: false, drive: DRIVE, mouth: { shapes } }))).toBeCloseTo(0.3, 9);
    expect(lowColour(body({ rig, look, dt: 0, level: 0, gaze: "host", reducedMotion: false, drive: DRIVE, mouth: { shapes }, speak: 1 }))).toBe(0);
    expect(lowColour(body({ rig, look, dt: 0, level: 0, gaze: "host", reducedMotion: false, drive: DRIVE }))).toBe(1);
  });

  it("live, the lower key fades out within the attack as the level speaks and back over the release", () => {
    const body = createFrameBody(1);
    const step = (level: number) => body({ rig, look, dt: 1 / 60, level, gaze: "host", reducedMotion: false });
    let out = step(0);
    for (let i = 0; i < 6; i += 1) out = step(1);
    expect(lowColour(out)).toBeLessThan(0.1);
    out = step(0);
    expect(lowColour(out)).toBeLessThan(0.3);
    for (let i = 0; i < 40; i += 1) out = step(0);
    expect(lowColour(out)).toBeGreaterThan(0.95);
    expect(SPEAK_RELEASE_S).toBeGreaterThan(SPEAK_ATTACK_S);
  });
});
