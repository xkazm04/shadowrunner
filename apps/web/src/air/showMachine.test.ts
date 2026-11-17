// The beat loop as a pure reducer (challenge-2026-11-17 air/A): boot, pre-emption by a visitor,
// the dead line and its paused audience, the quiet failed prefetch, and a property over any event
// sequence. No timers, no fetch: the effects are only read.
import type { PickState } from "@sr/engine";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { initialShow, showStep, type ShowEffect, type ShowEvent, type ShowState } from "./showMachine";

const kinds = (effects: readonly ShowEffect[]) => effects.map((e) => e.kind);
const pick = (ts: number): PickState => ({ lastPickTs: ts, pickedUsers: new Set() });

/** Steps through `events`, answering every launchBeat with a pick (as the shell does). */
function run(state: ShowState, events: readonly ShowEvent[]): { state: ShowState; effects: ShowEffect[] } {
  let s = state;
  let effects: ShowEffect[] = [];
  for (const event of events) {
    const out = showStep(s, event);
    s = out.state;
    effects = out.effects;
    for (const fx of out.effects) if (fx.kind === "launchBeat") s = showStep(s, { kind: "picked", flight: fx.flight, visitor: fx.visitorFirst, pickState: pick(s.pickState.lastPickTs + 1) }).state;
  }
  return { state: s, effects };
}

const onAir = (prefetch: boolean) => run(initialShow(prefetch), [{ kind: "start" }, { kind: "health", gen: 1, ok: true, at: 0 }, { kind: "beatDue", gen: 1, at: 0 }]).state;

describe("showStep", () => {
  it("boots: start asks health, a good health read goes on air and launches the first beat and the audience", () => {
    const started = showStep(initialShow(false), { kind: "start" });
    expect(started.state.stage.status).toBe("booting");
    expect(started.effects).toEqual([{ kind: "checkHealth" }]);
    const up = showStep(started.state, { kind: "health", gen: started.state.generation, ok: true, at: 0 });
    expect(up.state.stage.status).toBe("on_air");
    // The first beat rides the beat timer at 0 ms (a remount clears it before any engine request).
    expect(up.effects).toEqual([{ kind: "postAudience" }, { kind: "schedule", ms: 0 }]);
    const due = showStep(up.state, { kind: "beatDue", gen: up.state.generation, at: 1 });
    expect(kinds(due.effects)).toEqual(["launchBeat", "startThink"]);
  });

  it("pre-empts a beat in flight that does not answer a visitor, and undoes its pick", () => {
    let s = onAir(true);
    const flight = s.flight?.id ?? -1;
    s = showStep(s, { kind: "outcome", gen: s.generation, flight, result: "ready", at: 10 }).state; // line 0 airs; the prefetch launches
    s = showStep(s, { kind: "picked", flight: s.flight?.id ?? -1, visitor: false, pickState: pick(50) }).state;
    expect(s.stage.status).toBe("speaking");
    const before = s.pickBefore;
    const inflight = s.flight?.id ?? -1;
    const out = showStep(s, { kind: "post" });
    expect(out.effects).toEqual([
      { kind: "abort", flight: inflight },
      { kind: "launchBeat", flight: inflight + 1, visitorFirst: true, prefetched: true },
    ]);
    expect(out.state.pickState).toBe(before);
  });

  it("kills the line on the second serial engine failure, then counts the dead time as paused", () => {
    let s = onAir(false);
    s = run(s, [{ kind: "outcome", gen: s.generation, flight: s.flight?.id ?? -1, result: "failed", at: 100 }]).state;
    expect(s.stage.status).toBe("on_air");
    s = run(s, [{ kind: "beatDue", gen: s.generation, at: 9_100 }]).state;
    expect(s.flight?.prefetched).toBe(false);
    const dead = showStep(s, { kind: "outcome", gen: s.generation, flight: s.flight?.id ?? -1, result: "failed", at: 9_200 });
    expect(dead.state.stage.status).toBe("dead_line");
    expect(kinds(dead.effects).filter((k) => k === "stopPlayer" || k === "revoke" || k === "pollHealth")).toEqual(["stopPlayer", "revoke", "pollHealth"]);
    const back = showStep(dead.state, { kind: "health", gen: dead.state.generation, ok: true, at: 9_200 + 7_000 });
    expect(back.state.pausedMs - dead.state.pausedMs).toBe(7_000);
    expect(back.state.stage.status).toBe("on_air");
  });

  it("drops a failed prefetch quietly: no engine error, a serial retry, the status unchanged", () => {
    let s = onAir(true);
    s = run(s, [{ kind: "outcome", gen: s.generation, flight: s.flight?.id ?? -1, result: "ready", at: 10 }]).state;
    s = run(s, [{ kind: "lineEnded", gen: s.generation, result: "ended", elapsed: 12_000, at: 12_010 }]).state;
    expect(s.wait).not.toBe("none");
    expect(s.flight?.prefetched).toBe(true);
    const out = showStep(s, { kind: "outcome", gen: s.generation, flight: s.flight?.id ?? -1, result: "failed", at: 12_020 });
    expect(out.state.stage).toEqual(s.stage);
    expect(out.effects).toContainEqual(expect.objectContaining({ kind: "launchBeat", prefetched: false }));
    expect(out.state.stage.engineErrors).toBe(0);
  });
});

type Abstract =
  | { kind: "health"; ok: boolean }
  | { kind: "outcome"; current: boolean; result: "ready" | "failed" | "aborted" }
  | { kind: "lineEnded"; result: "ended" | "blocked" | "error" | "none" }
  | { kind: "post" }
  | { kind: "thinkElapsed" }
  | { kind: "beatDue" }
  | { kind: "stop" }
  | { kind: "start" };

const abstract: fc.Arbitrary<Abstract> = fc.oneof(
  fc.record({ kind: fc.constant("health" as const), ok: fc.boolean() }),
  fc.record({ kind: fc.constant("outcome" as const), current: fc.boolean(), result: fc.constantFrom("ready" as const, "failed" as const, "aborted" as const) }),
  fc.record({ kind: fc.constant("lineEnded" as const), result: fc.constantFrom("ended" as const, "blocked" as const, "error" as const, "none" as const) }),
  fc.constant({ kind: "post" as const }),
  fc.constant({ kind: "thinkElapsed" as const }),
  fc.constant({ kind: "beatDue" as const }),
  fc.constant({ kind: "stop" as const }),
  fc.constant({ kind: "start" as const }),
);

describe("showStep, any event sequence", () => {
  it("keeps at most one beat in flight, never speaks while waiting, and never moves the generation back", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(abstract, { maxLength: 60 }), (prefetch, events) => {
        let s = run(initialShow(prefetch), [{ kind: "start" }]).state;
        let at = 0;
        /** Launched beats whose outcome has not been delivered and that were not aborted. */
        const open = new Set<number>();
        for (const a of events) {
          at += 100;
          const gen = s.generation;
          const event: ShowEvent =
            a.kind === "outcome"
              ? { kind: "outcome", gen, flight: a.current ? (s.flight?.id ?? -1) : -7, result: a.result, at }
              : a.kind === "health"
                ? { kind: "health", gen, ok: a.ok, at }
                : a.kind === "lineEnded"
                  ? { kind: "lineEnded", gen, result: a.result, elapsed: 500, at }
                  : a.kind === "thinkElapsed"
                    ? { kind: "thinkElapsed", gen }
                    : a.kind === "beatDue"
                      ? { kind: "beatDue", gen, at }
                      : a;
          if (event.kind === "outcome" && event.result !== "aborted") open.delete(event.flight);
          const out = showStep(s, event);
          for (const fx of out.effects) {
            if (fx.kind === "abort") open.delete(fx.flight);
            if (fx.kind === "launchBeat") {
              expect(open.size).toBe(0);
              open.add(fx.flight);
            }
          }
          const next = run(s, [event]).state;
          expect(open.size).toBeLessThanOrEqual(1);
          if (next.flight !== undefined && next.flight.settled === undefined) expect(open.has(next.flight.id)).toBe(true);
          expect(next.stage.status === "speaking" && next.wait !== "none").toBe(false);
          expect(next.generation).toBeGreaterThanOrEqual(s.generation);
          s = next;
        }
      }),
    );
  });
});
