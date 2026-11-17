// The beat loop as a pure reducer (challenge-2026-11-17 air/A): showStep(state, event) returns the
// next state and the effects the show controller (show.ts) runs: launch a beat, air it, set a
// timer, poll health, stop the player. show.ts feeds what happens back as events (a health read,
// a beat's outcome, a line's end, a timer). The status rules stay in stage.ts's stageStep, which
// this calls; the rules of the wait, the flight, the prefetch, the pick undo and the dead line's
// paused audience live here, so they are tested without timers (showMachine.test.ts).
//
// The rules (show.ts's header has the why):
// - At most one beat in flight. A beat launched while a line plays is `prefetched`. Its outcome is
//   stored when it lands and used when the stage is free (the line ended, or a timer fired).
// - A free stage airs a ready beat at once, else waits on the beat in flight (launching one if
//   none is). The wait shows as thinking only after THINK_DELAY_MS (`thinkElapsed`).
// - A visitor's message pre-empts (LIVE, `prefetch`) a beat in flight that does not answer a
//   visitor: aborted, its pick undone, a visitor-first beat launched instead.
// - A failed prefetch is dropped quietly: its pick undone, a serial beat launched. A failed serial
//   beat is an engine error (stage.ts); the second in a row kills the line.
// - While dead nothing airs; health is polled; on recovery the dead time joins `pausedMs`, which
//   moves the simulated audience's schedule on by it.
import { initialPickState, type PickState } from "@sr/engine";
import { BEAT_MS, type PlayResult } from "./showModel";
import { INITIAL_STAGE, stageStep, type StageState } from "./stage";

export interface Flight {
  readonly id: number;
  /** Launched while a line was playing (LIVE prefetch). */
  readonly prefetched: boolean;
  /** It answers a visitor's message (then a visitor does not pre-empt it). */
  readonly visitor: boolean;
  /** Its outcome, once it has landed and before the stage used it. */
  readonly settled?: "ready" | "failed";
}

/** No wait, a wait (not shown yet), a wait shown as thinking. */
export type Wait = "none" | "waiting" | "thinking";

export interface ShowState {
  readonly running: boolean;
  /** Bumped by start and stop; events from an older generation are ignored. */
  readonly generation: number;
  readonly stage: StageState;
  /** LIVE only: launch the next beat as soon as a line starts. */
  readonly prefetch: boolean;
  readonly flight?: Flight;
  readonly nextFlight: number;
  readonly pickState: PickState;
  /** The pick state from before the flight's pick, to undo it. */
  readonly pickBefore: PickState;
  readonly wait: Wait;
  /** Show-clock time spent with the line dead. */
  readonly pausedMs: number;
  readonly deadSince?: number;
}

export type ShowEvent =
  | { kind: "start" }
  | { kind: "stop" }
  /** A visitor's message joined the chat. */
  | { kind: "post" }
  /** The shell picked the message for `flight` (answering launchBeat). */
  | { kind: "picked"; flight: number; visitor: boolean; pickState: PickState }
  | { kind: "health"; gen: number; ok: boolean; at: number }
  | { kind: "outcome"; gen: number; flight: number; result: "ready" | "failed" | "aborted"; at: number }
  /** The line's audio ended, could not play, or there was none ("none"); `elapsed` since it started. */
  | { kind: "lineEnded"; gen: number; result: PlayResult | "none"; elapsed: number; at: number }
  /** The beat timer fired: the stage is free. */
  | { kind: "beatDue"; gen: number; at: number }
  | { kind: "thinkElapsed"; gen: number };

export type ShowEffect =
  | { kind: "checkHealth" }
  /** Ask health again in HEALTH_POLL_MS (on the beat timer). */
  | { kind: "pollHealth" }
  | { kind: "postAudience" }
  | { kind: "stopAudience" }
  /** Pick (visitor's messages first when asked), build the request, launch; answer with `picked`. */
  | { kind: "launchBeat"; flight: number; visitorFirst: boolean; prefetched: boolean }
  | { kind: "abort"; flight: number }
  /** Put the flight's ready beat on air: chat, caption, then play (answer with `lineEnded`). */
  | { kind: "air"; flight: number }
  /** `beatDue` in `ms` (on the beat timer). */
  | { kind: "schedule"; ms: number }
  | { kind: "clearBeat" }
  /** `thinkElapsed` in THINK_DELAY_MS. */
  | { kind: "startThink" }
  | { kind: "clearThink" }
  | { kind: "stopPlayer" }
  /** Release the clip of the line that played. */
  | { kind: "revoke" }
  /** The line could not play: its caption stays up, mouth closed (`blocked`: sound not allowed yet). */
  | { kind: "unvoice"; blocked: boolean };

export function initialShow(prefetch: boolean): ShowState {
  const pick = initialPickState();
  return { running: false, generation: 0, stage: INITIAL_STAGE, prefetch, nextFlight: 0, pickState: pick, pickBefore: pick, wait: "none", pausedMs: 0 };
}

type Fx = ShowEffect[];

function launch(s: ShowState, fx: Fx, visitorFirst: boolean): ShowState {
  const id = s.nextFlight;
  const prefetched = s.stage.status === "speaking";
  fx.push({ kind: "launchBeat", flight: id, visitorFirst, prefetched });
  return { ...s, flight: { id, prefetched, visitor: false }, nextFlight: id + 1 };
}

function noFlight(s: ShowState): ShowState {
  return { ...s, flight: undefined };
}

/** Drops the beat in flight and undoes its pick. */
function discard(s: ShowState, fx: Fx): ShowState {
  if (s.flight === undefined) return s;
  fx.push({ kind: "abort", flight: s.flight.id });
  return { ...noFlight(s), pickState: s.pickBefore };
}

function startWait(s: ShowState, fx: Fx): ShowState {
  if (s.wait !== "none") return s;
  fx.push({ kind: "startThink" });
  return { ...s, wait: "waiting" };
}

function endWait(s: ShowState, fx: Fx): ShowState {
  if (s.wait === "none") return s;
  fx.push({ kind: "clearThink" });
  return { ...s, wait: "none" };
}

/** The line died: stop the voice, the beats and the audience. */
function goDark(s: ShowState, fx: Fx, at: number): ShowState {
  fx.push({ kind: "clearBeat" }, { kind: "stopAudience" }, { kind: "stopPlayer" }, { kind: "revoke" });
  return endWait(discard({ ...s, deadSince: at }, fx), fx);
}

/** A ready beat goes on air; on LIVE the next one launches as its line starts. */
function air(s: ShowState, flight: Flight, fx: Fx): ShowState {
  let next = endWait(noFlight(s), fx);
  next = { ...next, stage: stageStep(next.stage, { kind: "engine", ok: true }) };
  fx.push({ kind: "air", flight: flight.id });
  next = { ...next, stage: stageStep(next.stage, { kind: "line", speaking: true }) };
  return next.prefetch ? launch(next, fx, false) : next;
}

/** The stage is free: air the beat in flight if it is ready, else wait on it (launching one if none is). */
function free(s: ShowState, fx: Fx, at: number): ShowState {
  const next: ShowState = { ...s, stage: stageStep(s.stage, { kind: "line", speaking: false }) };
  const f = next.flight;
  if (f === undefined) return startWait(launch(next, fx, false), fx);
  if (f.settled === undefined) return startWait(next, fx);
  if (f.settled === "ready") return air(next, f, fx);
  // A failed prefetch is dropped quietly: the serial path asks again now.
  if (f.prefetched) return startWait(launch({ ...noFlight(next), pickState: next.pickBefore }, fx, false), fx);
  let failed = endWait(noFlight(next), fx);
  failed = { ...failed, stage: stageStep(failed.stage, { kind: "engine", ok: false }) };
  if (failed.stage.status !== "dead_line") {
    fx.push({ kind: "schedule", ms: BEAT_MS });
    return failed;
  }
  // The engine failed twice: give it a poll interval before asking health.
  failed = goDark(failed, fx, at);
  fx.push({ kind: "pollHealth" });
  return failed;
}

function reduce(s: ShowState, e: ShowEvent, fx: Fx): ShowState {
  const current = !("gen" in e) || e.gen === s.generation;
  if (!current) return s;
  switch (e.kind) {
    case "start":
      if (s.running) return s;
      fx.push({ kind: "checkHealth" });
      return { ...s, running: true, generation: s.generation + 1, stage: INITIAL_STAGE };
    case "stop":
      fx.push({ kind: "clearBeat" }, { kind: "stopAudience" }, { kind: "stopPlayer" }, { kind: "revoke" });
      return endWait(discard({ ...s, running: false, generation: s.generation + 1 }, fx), fx);
    case "post":
      // LIVE: a beat in flight that does not answer a visitor gives way to the visitor's beat.
      if (!s.prefetch || !s.running || s.stage.status === "dead_line" || s.flight === undefined || s.flight.visitor) return s;
      return launch(discard(s, fx), fx, true);
    case "picked":
      if (s.flight?.id !== e.flight) return s;
      return { ...s, flight: { ...s.flight, visitor: e.visitor }, pickBefore: s.pickState, pickState: e.pickState };
    case "thinkElapsed":
      return s.wait === "waiting" ? { ...s, wait: "thinking" } : s;
    case "health": {
      const was = s.stage.status;
      let next: ShowState = { ...s, stage: stageStep(s.stage, { kind: "health", ok: e.ok }) };
      if (next.stage.status === "dead_line") {
        if (was !== "dead_line") next = goDark(next, fx, e.at);
        fx.push({ kind: "pollHealth" });
        return next;
      }
      if (was !== "booting" && was !== "dead_line") return next;
      const { deadSince, ...alive } = next;
      next = { ...alive, pausedMs: alive.pausedMs + (deadSince === undefined ? 0 : e.at - deadSince) };
      // The first beat goes on the beat timer (0 ms), not at once: a stage torn down right after
      // boot (a React remount) clears it before it asks the engine for anything.
      fx.push({ kind: "postAudience" }, { kind: "schedule", ms: 0 });
      return next;
    }
    case "outcome": {
      const f = s.flight;
      if (f === undefined || f.id !== e.flight || e.result === "aborted" || f.settled !== undefined) return s;
      const next: ShowState = { ...s, flight: { ...f, settled: e.result } };
      return s.wait === "none" ? next : free(next, fx, e.at);
    }
    case "lineEnded":
      if (s.stage.status === "dead_line") return s;
      if (e.result === "ended") return free(s, fx, e.at);
      // Could not play: the caption stays up for the rest of a default beat.
      if (e.result !== "none") fx.push({ kind: "unvoice", blocked: e.result === "blocked" });
      fx.push({ kind: "schedule", ms: Math.max(0, BEAT_MS - e.elapsed) });
      return s;
    case "beatDue":
      return s.stage.status === "dead_line" ? s : free(s, fx, e.at);
  }
}

export function showStep(state: ShowState, event: ShowEvent): { state: ShowState; effects: ShowEffect[] } {
  const effects: ShowEffect[] = [];
  return { state: reduce(state, event, effects), effects };
}
