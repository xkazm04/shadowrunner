// Word-by-word captions (costume requirement 8.1): which words are lit for a playback progress.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { captionWords, readMs, revealedCount } from "./reveal";

const words = fc.array(fc.stringMatching(/^[A-Za-z',.?!]{1,12}$/), { maxLength: 40 });

describe("revealedCount", () => {
  it("lights nothing before the line starts and every word once it ends", () => {
    fc.assert(
      fc.property(words, fc.double({ min: -5, max: 0, noNaN: true }), fc.double({ min: 1, max: 5, noNaN: true }), (w, before, after) => {
        expect(revealedCount(w, before)).toBe(0);
        expect(revealedCount(w, Number.NaN)).toBe(0);
        expect(revealedCount(w, after)).toBe(w.length);
      }),
    );
  });

  it("only ever adds words as the line plays (never unlights one), within the line's length", () => {
    fc.assert(
      fc.property(words, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (w, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const n = revealedCount(w, lo);
        expect(revealedCount(w, hi)).toBeGreaterThanOrEqual(n);
        expect(n).toBeLessThanOrEqual(w.length);
      }),
    );
  });

  it("starts with the first word and spends longer on long words and stops", () => {
    const line = captionWords("The lich guy. Eleven centuries of service and I am the lich guy.");
    expect(revealedCount(line, 0.001)).toBe(1);
    expect(revealedCount(line, 0.5)).toBeGreaterThan(3);
    expect(revealedCount(line, 0.5)).toBeLessThan(line.length);
  });
});

describe("captionWords and readMs", () => {
  it("splits on any whitespace and paces a caption-only line inside the beat", () => {
    expect(captionWords("  Sit down.\n Be   counted. ")).toEqual(["Sit", "down.", "Be", "counted."]);
    expect(readMs(2, 9_000)).toBe(1_500);
    expect(readMs(10, 9_000)).toBe(3_300);
    expect(readMs(100, 9_000)).toBe(7_200);
  });
});
