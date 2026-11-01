import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delayOf, initialChat, START_MS, stepChat, type ChatState } from "../chatScript";
import { flickerAt } from "./flicker";
import { playChat, type ChatTimers } from "./typing";

const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 });

describe("flickerAt", () => {
  it("stays a dim-to-full candle for every time and phase: within [0.61, 1.03]", () => {
    fc.assert(
      fc.property(finite, finite, (t, phase) => {
        const k = flickerAt(t, phase);
        expect(k).toBeGreaterThanOrEqual(0.61 - 1e-9);
        expect(k).toBeLessThanOrEqual(1.03 + 1e-9);
      }),
      // The bound is only reached where the sines peak together: search wide (it is cheap).
      { numRuns: 5000 },
    );
  });
});

describe("playChat on fake timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const timers: ChatTimers = {
    setTimeout: (run, ms) => Number(setTimeout(run, ms)),
    clearTimeout: (id) => clearTimeout(id),
  };

  it("reports exactly the states stepChat makes, each after delayOf, and stops when told", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 80 }), (steps) => {
        vi.clearAllTimers();
        const seen: ChatState[] = [];
        const stop = playChat(initialChat(), (s) => seen.push(s), START_MS, timers);
        let expected = initialChat();
        vi.advanceTimersByTime(START_MS);
        for (let i = 0; i < steps; i += 1) {
          expected = stepChat(expected);
          expect(seen.at(-1)).toEqual(expected);
          vi.advanceTimersByTime(delayOf(expected));
        }
        stop();
        const count = seen.length;
        vi.advanceTimersByTime(600_000);
        expect(seen).toHaveLength(count);
      }),
      { numRuns: 30 },
    );
  });
});
