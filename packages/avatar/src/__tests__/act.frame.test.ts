// tiger L1: the frame body plays a signature act from the frame it is named on, at the driver's t:
// the part moves mid-act, and once the act's `s` has passed the frames match a body that never
// played it; under reduced motion nothing moves (the static twin only lifts the part's light).
import { defaultLook, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createFrameBody, type FrameBodyInputs } from "../player/frame.js";

const RIG: Rig = {
  version: 1,
  id: "act-test",
  name: "Act",
  width: 100,
  height: 100,
  source: "forge",
  palette: { glow: "#22e07a", eye: "#22e07a", rim: "#e9e2cf", mouth: "#000000" },
  layers: [
    { name: "head", z: 0, kind: "head", file: "head.png", bbox: [30, 20, 40, 50], anchor: [50, 60] },
    { name: "hand_r", z: 1, kind: "accessory", file: "hand.png", bbox: [70, 40, 20, 20], anchor: [80, 50], motion: { float: { amp: [1, 2], freq: 0.4 } }, act: { cue: ["sold"], s: 1 } },
  ],
};

const run = (reducedMotion: boolean, actAt: number | undefined, frames: number) => {
  const body = createFrameBody(7);
  const out = [];
  for (let i = 0; i < frames; i += 1) {
    const inputs: FrameBodyInputs = { rig: RIG, look: defaultLook(RIG), dt: 0.05, level: 0, gaze: "host", reducedMotion, ...(i === actAt ? { act: "hand_r" } : {}) };
    out.push(body(inputs).poses.find((p) => p.name === "hand_r"));
  }
  return out;
};

describe("signature act in the frame body", () => {
  it("moves the part mid-act and is back to the idle frames once it has ended", () => {
    const idle = run(false, undefined, 60);
    const acted = run(false, 10, 60);
    expect(acted.slice(0, 10)).toEqual(idle.slice(0, 10));
    expect(acted[20]?.y).toBeGreaterThan((idle[20]?.y ?? 0) + 1);
    expect(acted.slice(32)).toEqual(idle.slice(32));
  });

  it("under reduced motion only the part's light lifts, for one beat; it never moves", () => {
    const idle = run(true, undefined, 40);
    const acted = run(true, 10, 40);
    acted.forEach((pose, i) => expect({ ...pose, tint: 0 }).toEqual({ ...idle[i], tint: 0 }));
    expect(acted[12]?.tint).toBeGreaterThan(idle[12]?.tint ?? 0);
    expect(acted[30]?.tint).toBe(idle[30]?.tint);
  });
});
