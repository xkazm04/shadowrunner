import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delayOf, initialChat, START_MS, stepChat, type ChatState } from "../chatScript";
import { drift, makeMotes, moteAlpha, MOTES } from "./dust";
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

describe("dust", () => {
  const unit = fc.double({ noNaN: true, min: -0.2, max: 1.2 });
  it("never draws a mote brighter than 0.75, and none at all with the picture gone", () => {
    fc.assert(
      fc.property(unit, unit, fc.double({ noNaN: true, min: 0.3, max: 1 }), fc.double({ noNaN: true, min: -1, max: 2 }), (x, y, z, level) => {
        const a = moteAlpha({ x, y, z }, { x: 0.5, y: 0.43 }, level);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(0.75);
        if (level <= 0) expect(a).toBe(0);
      }),
    );
  });

  it("makes MOTES motes inside the field, drifting upward", () => {
    const motes = makeMotes();
    expect(motes).toHaveLength(MOTES);
    for (const mote of motes) {
      expect(mote.x).toBeGreaterThanOrEqual(0);
      expect(mote.x).toBeLessThan(1);
      expect(mote.vy).toBeLessThan(0);
    }
  });

  it("keeps every mote inside the wrapped field however long it drifts", () => {
    const mote = fc.record({
      x: fc.double({ noNaN: true, min: 0, max: 1 }),
      y: fc.double({ noNaN: true, min: 0, max: 1 }),
      z: fc.double({ noNaN: true, min: 0.3, max: 1 }),
      vx: fc.double({ noNaN: true, min: -0.002, max: 0.002 }),
      vy: fc.double({ noNaN: true, min: -0.006, max: -0.002 }),
      ph: fc.double({ noNaN: true, min: 0, max: 6 }),
    });
    // Whole 60 Hz frames (1 to 6 per tick, as the loop caps it): small doubles would barely move.
    const step = fc.record({ dt: fc.integer({ min: 1, max: 6 }), t: fc.double({ noNaN: true, min: 0, max: 1e4 }) });
    fc.assert(
      // Long runs (fast-check keeps arrays short by default): a mote crosses the field many times.
      fc.property(mote, fc.array(step, { minLength: 400, maxLength: 800 }), fc.double({ noNaN: true, min: 0, max: 0.999 }), (m, steps, r) => {
        for (const { dt, t } of steps) {
          drift(m, t, dt, () => r);
          expect(m.x).toBeGreaterThanOrEqual(-0.1);
          expect(m.x).toBeLessThanOrEqual(1.1);
          expect(m.y).toBeGreaterThanOrEqual(-0.1);
          expect(m.y).toBeLessThanOrEqual(1.1);
        }
      }),
      // Shrinking 800-step runs takes minutes; the first counterexample is enough.
      { endOnFailure: true },
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
