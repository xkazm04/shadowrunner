// avatar-pack task 1: readLook moved from the web library to @sr/rig (design "readLook moves to
// @sr/rig"), with rig-owned emotion and gesture checks.
import { defaultLook, GESTURE_NAMES, IDENTITY_SHAPE, isLookEmotion, isLookGesture, readLook, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { EMOTION_TABLE } from "../look.js";

const rig: Rig = {
  version: 1,
  id: "test-ghost",
  name: "Test Ghost",
  width: 64,
  height: 64,
  source: "forge",
  fictional: true,
  palette: { glow: "#112233", eye: "#445566", rim: "#778899", mouth: "#aabbcc" },
  layers: [
    { name: "torso", z: 2, kind: "body", file: "torso.png", bbox: [8, 40, 48, 24], anchor: [32, 52] },
    {
      name: "head",
      z: 3,
      kind: "head",
      file: "head.png",
      bbox: [16, 8, 32, 36],
      anchor: [32, 40],
      regions: { map: "head.regions.png", slots: [{ id: "r1", name: "hood", hex: "#334455" }] },
    },
    { name: "crown", z: 7, kind: "crown", file: "crown.png", bbox: [16, 0, 32, 10], anchor: [32, 8], follow: "head" },
    { name: "jaw", z: 4, kind: "jaw", file: "jaw.png", bbox: [24, 30, 16, 8], anchor: [32, 30], follow: "head" },
  ],
};
const base = (): Look => defaultLook(rig);

describe("readLook", () => {
  it("reads a default look back unchanged", () => {
    expect(readLook(base(), rig)).toEqual(base());
    expect(readLook({ ...base(), gesture: "glare" })).toEqual({ ...base(), gesture: "glare" });
  });

  it("drops only the bad regions and shape entries, checked against the rig", () => {
    const good = { ...IDENTITY_SHAPE, size: 1.4 };
    const stored = {
      ...base(),
      regions: { "head/r1": "#ff0000", "head/r9": "#ff0000", "torso/r1": "#00ff00", "head/oops": "red" },
      shape: { crown: good, jaw: { ...good, rot: 400 }, nobody: good, eye_l: "x" },
    };
    const look = readLook(stored, rig);
    expect(look?.palette).toEqual(base().palette);
    expect(look?.regions).toEqual({ "head/r1": "#ff0000" });
    expect(look?.shape).toEqual({ crown: good });
    expect(readLook({ ...base(), regions: { "torso/r1": "#000000" }, shape: 3 }, rig)).toEqual(base());
  });

  it("refuses a look whose base fields are off", () => {
    const bad: unknown[] = [
      null,
      [],
      "look",
      { ...base(), palette: { ...base().palette, eye: "red" } },
      { ...base(), palette: undefined },
      { ...base(), hidden: "crown" },
      { ...base(), hidden: [3] },
      { ...base(), emotion: "sad" },
      { ...base(), emotion: "toString" },
      { ...base(), gesture: "wave" },
    ];
    for (const value of bad) expect(readLook(value, rig)).toBeUndefined();
  });

  it("emotion and gesture checks cover exactly the rig's own names", () => {
    for (const emotion of Object.keys(EMOTION_TABLE)) expect(isLookEmotion(emotion)).toBe(true);
    for (const gesture of GESTURE_NAMES) expect(isLookGesture(gesture)).toBe(true);
    for (const junk of ["", "constructor", "hasOwnProperty", 1, undefined]) {
      expect(isLookEmotion(junk)).toBe(false);
      expect(isLookGesture(junk)).toBe(false);
    }
  });
});
