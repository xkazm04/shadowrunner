// @vitest-environment happy-dom
// Studio background (spec avatar-reach, design "Studio"): colour values normalised for the colour
// input, and theme roles read as swatches only when they resolve.
import { afterEach, describe, expect, it } from "vitest";
import { readSwatches, SWATCH_ROLES, toHex } from "./background";

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("toHex", () => {
  it("normalises hex and rgb() values, refuses the rest", () => {
    expect(toHex(" #ABCDEF ")).toBe("#abcdef");
    expect(toHex("#0f8")).toBe("#00ff88");
    expect(toHex("rgb(51, 102, 153)")).toBe("#336699");
    expect(toHex("rgba(255 0 0 / 0.5)")).toBe("#ff0000");
    expect(toHex("var(--sr-accent)")).toBeUndefined();
    expect(toHex("")).toBeUndefined();
  });
});

describe("readSwatches", () => {
  it("offers only the roles the page resolves", () => {
    expect(readSwatches()).toEqual([]);
    document.documentElement.style.setProperty("--sr-surface-0", "#101010");
    document.documentElement.style.setProperty("--sr-accent", "rgb(0, 128, 255)");
    expect(readSwatches()).toEqual([
      { role: "surface-0", label: "Night", hex: "#101010" },
      { role: "accent", label: "Accent", hex: "#0080ff" },
    ]);
    expect(SWATCH_ROLES.length).toBeGreaterThanOrEqual(3);
  });
});
