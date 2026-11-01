// CH 9, lights out (costume task 5.2; requirement 7). The reflection is a pure function of the
// switch-off count (property: nothing before the first, strictly stronger and larger with each
// one, never fully there); the page states what it is and how to get back, and offers no
// programme.
import fc from "fast-check";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAGES, type PageDef } from "../app/pages";
import { Sealed } from "./Sealed";
import { GLASS_CLIP, isSwitchOff, reflection, toGlass, WARM_MS } from "./SealedGlass";

const sealed = (): PageDef => {
  const found = PAGES.find((p) => p.id === "sealed");
  if (!found) throw new Error("no sealed page");
  return found;
};

describe("reflection: the Announcer in the black glass", () => {
  it("is not there before the first switch-off", () => {
    for (const n of [0, -1, -Infinity, Number.NaN, 0.9]) expect(reflection(n)).toEqual({ peak: 0, width: 0 });
  });

  it("grows strictly with each switch-off", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), (n) => {
        const a = reflection(n);
        const b = reflection(n + 1);
        expect(b.peak).toBeGreaterThan(a.peak);
        expect(b.width).toBeGreaterThan(a.width);
      }),
    );
  });

  it("never fully arrives: bounded, and never shrinks however often the set goes dark", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 0, max: 1e6 }), (n, more) => {
        const r = reflection(n);
        expect(r.peak).toBeGreaterThan(0.25);
        expect(r.peak).toBeLessThanOrEqual(0.5);
        expect(r.width).toBeGreaterThan(0.6);
        expect(r.width).toBeLessThanOrEqual(0.82);
        expect(reflection(n + more).peak).toBeGreaterThanOrEqual(r.peak);
      }),
    );
  });

  it("only a warm tube holds an afterimage", () => {
    expect(isSwitchOff(WARM_MS - 1)).toBe(false);
    expect(isSwitchOff(WARM_MS)).toBe(true);
    expect(isSwitchOff(Number.NaN)).toBe(false);
  });

  it("maps the torch from the set into the glass box", () => {
    expect(toGlass(28.6667, 24.8884).x).toBeCloseTo(0, 1);
    expect(toGlass(50, 47.65).x).toBeCloseTo(50.6, 0);
    expect(GLASS_CLIP.startsWith("polygon(100% 50%")).toBe(true);
  });
});

describe("Sealed (CH 9) renders lights out", () => {
  const html = renderToString(<Sealed page={sealed()} />).replace(/<!-- -->/g, "");

  it("is the sealed door with the slate on a switched-off tube", () => {
    expect(html).toContain('data-door="sealed"');
    expect(html).toContain('data-power="idle"');
    expect(html).toMatch(/<h1 id="page-title"[^>]*>Not built yet<\/h1>/);
    expect(html).toContain("Channel 9 · Sealed");
    expect(html).toContain(`clip-path:${GLASS_CLIP}`);
  });

  it("hangs the tag: CH 9 · Sealed · not built yet, the lore, how to tune in and get back, the counts", () => {
    expect(html).toContain('aria-label="Label on the set"');
    expect(html).toContain("<h2>CH 9</h2>");
    expect(html).toContain("Sealed · not built yet");
    expect(html).toContain(sealed().lore ?? "missing lore");
    expect(html).toContain("Hold the power knob (or Space) to tune in. There is no programme; only snow.");
    expect(html).toMatch(/Esc or 2: <a href="\/"[^>]*>back to the set<\/a>/);
    expect(html).toContain("tuned in: 0<br/>tuned back: 0");
  });

  it("holds the knob to power the tube", () => {
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*aria-label="Power. Hold to tune the set to Channel 9 · Sealed"/);
    expect(html).toContain("Hold ⏻ or Space");
  });
});
