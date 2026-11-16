import { describe, expect, it } from "vitest";
import { ALPHA_CEIL, ALPHA_FLOOR, alphaRemap, applyAlpha } from "./composite";

describe("alphaRemap", () => {
  it("snaps the JPEG noise floor to clear and opaque, and is linear and monotonic between", () => {
    for (const v of [0, 1, ALPHA_FLOOR]) expect(alphaRemap(v)).toBe(0);
    for (const v of [ALPHA_CEIL, 254, 255]) expect(alphaRemap(v)).toBe(255);
    expect(alphaRemap(128)).toBe(Math.round((255 * (128 - ALPHA_FLOOR)) / (ALPHA_CEIL - ALPHA_FLOOR)));
    for (let v = 1; v < 256; v += 1) expect(alphaRemap(v)).toBeGreaterThanOrEqual(alphaRemap(v - 1));
  });
});

describe("applyAlpha", () => {
  it("moves the alpha image's luminance (its red channel) into the colour's alpha, leaving the colour", () => {
    const color = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]);
    const alpha = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]);
    applyAlpha(color, alpha);
    expect([...color]).toEqual([10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, alphaRemap(128)]);
  });

  it("stops at the shorter buffer", () => {
    const color = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    applyAlpha(color, new Uint8ClampedArray([0, 0, 0, 255]));
    expect([...color]).toEqual([1, 2, 3, 0, 4, 5, 6, 255]);
  });
});
