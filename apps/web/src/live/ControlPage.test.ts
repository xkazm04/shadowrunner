import { describe, expect, it } from "vitest";
import { stateLine } from "./ControlPage";
import type { LiveState } from "./protocol";

const state: LiveState = {
  type: "state",
  ready: true,
  model: "lite",
  fps: 25,
  upscale: "maxine",
  source: "text",
  queue: 0,
  delayMs: 2000,
  size: 1024,
  matte: false,
  idle: "loop",
  motion: "natural",
};

describe("stateLine", () => {
  it("shows the motion level (round 3)", () => {
    expect(stateLine(state)).toBe("ready · 25 fps · upscale maxine · delay 2000 ms · queue 0 · 1024 px · source text · matte off · idle loop · motion natural");
  });

  it("leaves out what an older server does not send", () => {
    expect(stateLine({ ...state, motion: null })).not.toContain("motion");
    expect(stateLine({ ...state, idle: null, motion: null })).toMatch(/matte off$/);
  });
});
