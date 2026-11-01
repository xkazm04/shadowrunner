// Haunt bound to status (voice-and-air task 6): the stage state machine, the dead line in the show
// controller (enter on a failed health read or two engine errors in a row, poll every 5 s, recover
// automatically), and the fog from chat velocity.
import type { ChatMsg } from "@sr/engine";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatVelocity, FOG_FULL_VELOCITY, fogFor, smooth, VELOCITY_WINDOW_MS } from "./fog";
import { flush, LINE_MS, play, setup } from "./showKit";
import { DEAD_AFTER_ENGINE_ERRORS, HEALTH_POLL_MS, INITIAL_STAGE, stageStep, type StageEvent, type StageState } from "./stage";

const event: fc.Arbitrary<StageEvent> = fc.oneof(
  fc.record({ kind: fc.constant("health" as const), ok: fc.boolean() }),
  fc.record({ kind: fc.constant("engine" as const), ok: fc.boolean() }),
  fc.record({ kind: fc.constant("line" as const), speaking: fc.boolean() }),
);

describe("stageStep", () => {
  it("leaves the dead line only when health answers, and then goes on air", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 80 }), (events) => {
        let s: StageState = INITIAL_STAGE;
        for (const e of events) {
          const next = stageStep(s, e);
          if (s.status === "dead_line" && next.status !== "dead_line") {
            expect(e).toEqual({ kind: "health", ok: true });
            expect(next).toEqual({ status: "on_air", engineErrors: 0 });
          }
          if (e.kind === "health" && !e.ok) expect(next.status).toBe("dead_line");
          if (s.status === "booting" && next.status !== "booting") expect(e.kind).toBe("health");
          s = next;
        }
      }),
    );
  });

  it("kills the line on the second engine error in a row, never on errors split by a good reply", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 40 }), (replies) => {
        let s = stageStep(INITIAL_STAGE, { kind: "health", ok: true });
        let run = 0;
        for (const ok of replies) {
          if (s.status === "dead_line") break;
          s = stageStep(s, { kind: "engine", ok });
          run = ok ? 0 : run + 1;
          expect(s.status === "dead_line").toBe(run >= DEAD_AFTER_ENGINE_ERRORS);
        }
      }),
    );
    expect(DEAD_AFTER_ENGINE_ERRORS).toBe(2);
  });

  it("moves between on air and speaking with the lines, and not while dead or booting", () => {
    const air = stageStep(INITIAL_STAGE, { kind: "health", ok: true });
    expect(stageStep(INITIAL_STAGE, { kind: "line", speaking: true }).status).toBe("booting");
    const speaking = stageStep(air, { kind: "line", speaking: true });
    expect(speaking.status).toBe("speaking");
    expect(stageStep(speaking, { kind: "line", speaking: false }).status).toBe("on_air");
    const dead = stageStep(speaking, { kind: "health", ok: false });
    expect(stageStep(dead, { kind: "line", speaking: true }).status).toBe("dead_line");
  });
});

describe("the dead line in the show", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes dead after two engine errors in a row, polls health every 5 s and recovers by itself", async () => {
    // Boot healthy; the first poll after the errors fails, the second answers.
    const { show, seen, healthCalls } = setup({ engineFails: 2, health: [true, false, true] });
    show.start();
    await flush();
    expect(show.snapshot().status).toBe("on_air"); // one error: still on air, next beat in 9 s
    await play(9_250);
    expect(seen.engine).toHaveLength(2);
    expect(show.snapshot().status).toBe("dead_line");
    expect(seen.voice).toHaveLength(0);
    const deadAt = Date.now();
    const chatWhenDead = show.snapshot().chat.length;
    await play(HEALTH_POLL_MS);
    expect(show.snapshot().status).toBe("dead_line"); // that poll failed
    await play(HEALTH_POLL_MS);
    expect(show.snapshot().status).not.toBe("dead_line"); // and this one answered
    const [first = 0, second = 0] = healthCalls.slice(-2);
    expect(healthCalls).toHaveLength(3); // boot, then one poll every 5 s while dead
    expect(second - first).toBe(HEALTH_POLL_MS);
    expect(first - deadAt).toBeGreaterThan(HEALTH_POLL_MS - 500); // not straight away: a full interval
    expect(first - deadAt).toBeLessThanOrEqual(HEALTH_POLL_MS);
    expect(seen.engine.length).toBeGreaterThan(2); // the show resumed
    expect(seen.voice.length).toBeGreaterThan(0);
    // Nothing aired while dead, and the audience did not burst in on recovery.
    expect(show.snapshot().chat.length - chatWhenDead).toBeLessThan(4);
    show.stop();
  });

  it("boots into the dead line when health fails, without asking the engine", async () => {
    const { show, seen } = setup({ health: [false, false, true] });
    show.start();
    await flush();
    expect(show.snapshot().status).toBe("dead_line");
    await play(HEALTH_POLL_MS);
    expect(show.snapshot().status).toBe("dead_line");
    expect(seen.engine).toHaveLength(0);
    expect(show.snapshot().chat).toHaveLength(0);
    await play(HEALTH_POLL_MS + LINE_MS / 2);
    expect(show.snapshot().status).toBe("speaking");
    expect(seen.engine).toHaveLength(1);
    show.stop();
  });

  it("does not poll health while on air", async () => {
    const { show, healthCalls } = setup();
    show.start();
    await play(LINE_MS * 3);
    expect(healthCalls).toHaveLength(1);
    show.stop();
  });
});

describe("fog from chat velocity", () => {
  const msg = (ts: number): ChatMsg => ({ id: `m${ts}`, user: "u", text: "t", ts });

  it("counts the messages of the last 30 s", () => {
    const chat = [0, 1_000, 20_000, 29_999, 31_000, 40_000].map(msg);
    expect(chatVelocity(chat, 40_000)).toBe(4); // 20 000, 29 999, 31 000, 40 000
    expect(chatVelocity(chat, 40_000 + VELOCITY_WINDOW_MS)).toBe(0);
  });

  it("smooths with alpha 0.2 and maps into [0, 1], zero when the theme does not haunt", () => {
    expect(smooth(0, 10)).toBeCloseTo(2);
    expect(smooth(5, Number.NaN)).toBe(5);
    fc.assert(
      fc.property(fc.double({ min: -100, max: 1e6, noNaN: true }), (v) => {
        const fog = fogFor(v, true);
        expect(fog).toBeGreaterThanOrEqual(0);
        expect(fog).toBeLessThanOrEqual(1);
        expect(fogFor(v, false)).toBe(0); // baseline: haunt tokens at zero
      }),
    );
    expect(fogFor(FOG_FULL_VELOCITY / 2, true)).toBeCloseTo(0.5);
    expect(fogFor(FOG_FULL_VELOCITY * 3, true)).toBe(1);
  });

  it("rises while chat is busy and settles back when it stops", () => {
    let v = 0;
    for (let s = 0; s < 30; s += 1) v = smooth(v, 12);
    expect(fogFor(v, true)).toBeGreaterThan(0.99);
    for (let s = 0; s < 30; s += 1) v = smooth(v, 0);
    expect(fogFor(v, true)).toBeLessThan(0.01);
  });
});
