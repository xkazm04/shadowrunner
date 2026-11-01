import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Motion } from "../app/theme";
import {
  createDaemon,
  DAEMON_STATES,
  dwellMs,
  FOLD_MS,
  isLost,
  isTimed,
  lightDelayMs,
  OUT_FADE_MS,
  OUT_STEP_MS,
  RELIGHT_FADE_MS,
  relightMs,
  settleAll,
  stareDelayMs,
  transition,
  type DaemonEvent,
  type DaemonState,
  type Timers,
} from "./daemon";
import { LIGHTS } from "./slides";


/** The global (fake) timers behind the driver's numeric ids. */
function fakeTimers(): Timers {
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  let serial = 0;
  return {
    setTimeout(run, ms) {
      serial += 1;
      handles.set(serial, setTimeout(run, ms));
      return serial;
    },
    clearTimeout(id) {
      clearTimeout(handles.get(id));
      handles.delete(id);
    },
  };
}

/** Is `to` one step of the table from `from` (under some event)? */
function isStep(from: DaemonState, to: DaemonState): boolean {
  const events: DaemonEvent[] = [{ kind: "settle" }, { kind: "health", lost: true }, { kind: "health", lost: false }];
  return events.some((e) => transition(from, e) === to);
}

const eventArb: fc.Arbitrary<DaemonEvent> = fc.oneof(
  fc.constant<DaemonEvent>({ kind: "settle" }),
  fc.boolean().map<DaemonEvent>((lost) => ({ kind: "health", lost })),
);

/** One reading, then a wait (fake ms) before the next one. */
const readingArb = fc.record({ lost: fc.boolean(), wait: fc.integer({ min: 0, max: 2500 }) });

describe("daemon table (pure)", () => {
  it("never reaches dark without folding first, and only relighting returns to online", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        let state: DaemonState = "online";
        for (const event of events) {
          const next = transition(state, event);
          if (next === "dark") expect(["folding", "dark"]).toContain(state);
          if (next === "online") expect(["online", "relighting"]).toContain(state);
          if (state === "online" && next !== "online") expect(next).toBe("folding");
          state = next;
        }
      }),
    );
  });

  it("ends consistent with the last reading once settled: lost is dark, back is online", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), fc.boolean(), (events, lost) => {
        let state: DaemonState = "online";
        for (const event of events) state = transition(state, event);
        state = settleAll(transition(state, { kind: "health", lost }));
        expect(state).toBe(lost ? "dark" : "online");
      }),
    );
  });

  it("times exactly the two transitional states, and calls folding and dark the lost ones", () => {
    expect(DAEMON_STATES.filter(isTimed)).toEqual(["folding", "relighting"]);
    expect(DAEMON_STATES.filter(isLost)).toEqual(["folding", "dark"]);
    expect(dwellMs("folding", LIGHTS)).toBe(FOLD_MS);
    expect(dwellMs("relighting", LIGHTS)).toBe(relightMs(LIGHTS));
    expect(dwellMs("dark", LIGHTS)).toBeUndefined();
    expect(dwellMs("online", LIGHTS)).toBeUndefined();
  });
});

describe("light schedule (pure)", () => {
  it("goes dark lantern first, then the slides right to left, OUT_STEP_MS apart", () => {
    const out = Array.from({ length: LIGHTS }, (_, p) => lightDelayMs("dark", p, LIGHTS));
    // Positions: 0 the lantern, then the slides left to right.
    expect(LIGHTS).toBe(7);
    expect(out).toEqual([0, 6, 5, 4, 3, 2, 1].map((n) => n * OUT_STEP_MS));
    expect(new Set(out).size).toBe(LIGHTS);
    expect(stareDelayMs(LIGHTS)).toBe(Math.max(...out) + OUT_FADE_MS);
  });

  it("relights left to right, every light inside the relighting dwell; reduced motion is instant", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (lights) => {
        const sweep = Array.from({ length: lights }, (_, p) => lightDelayMs("relighting", p, lights));
        expect(sweep[0]).toBe(0);
        for (let p = 1; p < lights; p += 1) expect(sweep[p]).toBeGreaterThan(sweep[p - 1] ?? Infinity);
        // The last light has finished relighting when the state returns to online.
        expect(Math.max(...sweep) + RELIGHT_FADE_MS).toBeLessThanOrEqual(relightMs(lights));
        for (const state of DAEMON_STATES) {
          for (let p = 0; p < lights; p += 1) expect(lightDelayMs(state, p, lights, "reduced")).toBe(0);
        }
        expect(stareDelayMs(lights, "reduced")).toBe(0);
      }),
    );
  });
});

describe("createDaemon on fake timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("folds for FOLD_MS, holds dark, and relights in a sweep", () => {
    const seen: DaemonState[] = [];
    const d = createDaemon((s) => seen.push(s), LIGHTS, fakeTimers());
    d.health(true, "full");
    expect(d.state).toBe("folding");
    vi.advanceTimersByTime(FOLD_MS - 1);
    // A repeated reading does not restart the fold.
    d.health(true, "full");
    expect(d.state).toBe("folding");
    vi.advanceTimersByTime(1);
    expect(d.state).toBe("dark");
    vi.advanceTimersByTime(60_000);
    expect(d.state).toBe("dark");
    d.health(false, "full");
    expect(d.state).toBe("relighting");
    vi.advanceTimersByTime(relightMs(LIGHTS));
    expect(d.state).toBe("online");
    expect(seen).toEqual(["folding", "dark", "relighting", "online"]);
    d.dispose();
  });

  it("over any health sequence: every change is a table step, never skips folding, ends consistent", () => {
    fc.assert(
      fc.property(fc.array(readingArb, { minLength: 1, maxLength: 30 }), fc.constantFrom<Motion>("full", "reduced"), (readings, motion) => {
        vi.clearAllTimers();
        const seen: DaemonState[] = ["online"];
        const d = createDaemon((s) => seen.push(s), LIGHTS, fakeTimers());
        for (const { lost, wait } of readings) {
          d.health(lost, motion);
          // Reduced motion: the timed states are passed through at once, never held.
          if (motion === "reduced") expect(isTimed(d.state)).toBe(false);
          vi.advanceTimersByTime(wait);
        }
        vi.runAllTimers();
        const last = readings.at(-1);
        expect(d.state).toBe(last?.lost ? "dark" : "online");
        for (let i = 1; i < seen.length; i += 1) {
          const from = seen[i - 1] ?? "online";
          const to = seen[i] ?? "online";
          expect(isStep(from, to), `${from} -> ${to}`).toBe(true);
          if (to === "dark") expect(from).toBe("folding");
        }
        d.dispose();
      }),
    );
  });

  it("lands at once when motion turns reduced mid-fold, and stops after dispose", () => {
    const d = createDaemon(() => undefined, LIGHTS, fakeTimers());
    d.health(true, "full");
    d.health(true, "reduced");
    expect(d.state).toBe("dark");
    d.health(false, "full");
    expect(d.state).toBe("relighting");
    d.dispose();
    vi.runAllTimers();
    expect(d.state).toBe("relighting");
    d.health(true, "full");
    expect(d.state).toBe("relighting");
  });
});
