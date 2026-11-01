import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { channelPages, PAGES } from "../app/pages";
import { labelOf, LIGHTS, projects, tabOf, tiltOf, TRAY } from "./slides";

describe("the tray", () => {
  it("holds the dial in channel order, then the stage, and nothing nested (Forge new)", () => {
    expect(TRAY.map(tabOf)).toEqual(["2", "3", "4", "6", "9", "O"]);
    expect(TRAY.slice(0, channelPages(PAGES).length)).toEqual(channelPages(PAGES));
    expect(TRAY.some((p) => p.id === "forge-new")).toBe(false);
    expect(LIGHTS).toBe(TRAY.length + 1);
  });

  it("labels each slide by its title, without a leading article", () => {
    expect(TRAY.map(labelOf)).toEqual(["On air", "Forge", "Characters", "Daemon", "Sealed", "Stage"]);
  });

  it("tilts every slide by a few degrees at most, whatever the index", () => {
    fc.assert(
      fc.property(fc.integer(), (i) => {
        expect(Math.abs(tiltOf(i))).toBeLessThanOrEqual(3);
      }),
    );
  });

  it("projects any other channel while the lantern is lit, never the one you are in, never cold", () => {
    for (const page of TRAY) {
      expect(projects(page, "landing", true)).toBe(page.id !== "landing");
      expect(projects(page, "landing", false)).toBe(false);
    }
    expect(projects(undefined, "landing", true)).toBe(false);
  });
});
