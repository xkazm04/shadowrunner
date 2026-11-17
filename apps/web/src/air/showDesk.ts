// The producer desk (challenge-2026-11-17 air/B): the streamer holds the show, cues a chat message
// to be answered next, or skips the line on air. Pure, like the beat loop it wraps: deskStep takes
// the desk's events (hold, resume, skip, cue) and the show's own (showMachine.ts), steps showStep
// for what it does not intercept, and returns the next state, desk and effects. show.ts runs them.
//
// The rules:
// - Hold (a BRB): the audience stops at once; the line on air plays to its end; no beat starts
//   while held. A line end or a beat timer that comes meanwhile is owed to resume, and so is a
//   visitor's live pre-empt. A beat already in flight may land; it waits for resume.
// - Resume: the held time joins `pausedMs`, the same rule as the dead line's, so the simulated
//   audience moves on by it and nothing bursts in; an owed beat launches at once.
// - Skip: the line on air stops (player stopped, its clip released) and the next beat is due at 0.
// - Cue: the next pick takes the cued message before the picker's own choice (deskPick), and the
//   cue is spent by that pick. On live a beat in flight is pre-empted the way a visitor's message
//   pre-empts it (showMachine "post"), even one that answers a visitor; held, the pre-empt is owed.
// - Only a message on screen that the character did not write and nothing answers or is answering
//   can be cued; only a running stage on air can be held; only a spoken line can be skipped.
import { pickMessage, type ChatMsg, type PickContext, type PickResult, type PickState } from "@sr/engine";
import type { ChatMarks } from "./chatMarks";
import { showStep, type ShowEffect, type ShowEvent, type ShowState } from "./showMachine";
import { stageStep } from "./stage";

export interface Desk {
  readonly held: boolean;
  /** Show-clock time the hold began. */
  readonly heldSince?: number;
  /** The stage came free while held: resume starts the next beat. */
  readonly owed: boolean;
  /** A visitor posted while held on live: resume runs the pre-empt. */
  readonly postOwed: boolean;
  /** The chat id the next pick takes. */
  readonly cued?: string;
}

export const OPEN_DESK: Desk = { held: false, owed: false, postOwed: false };

export type DeskEvent = { kind: "hold"; at: number } | { kind: "resume"; at: number } | { kind: "skip" } | { kind: "cue"; id: string };

/** What the desk reads of the chat to judge a cue (the show's snapshot and the character's chat name). */
export interface DeskView {
  readonly chat: readonly ChatMsg[];
  readonly marks?: ChatMarks;
  readonly self: string;
}

/** The desk without its cue. */
function spend(desk: Desk): Desk {
  const { cued, ...rest } = desk;
  return cued === undefined ? desk : rest;
}

/** The cued message when it is still on screen and not the character's own, else the picker's choice (the visitor's messages first when asked). The cue is spent either way. */
export function deskPick(chat: readonly ChatMsg[], pickState: PickState, desk: Desk, ctx: PickContext, visitorFirst = false): PickResult & { desk: Desk } {
  const { cued } = desk;
  const spent = spend(desk);
  const target = cued === undefined ? undefined : chat.find((m) => m.id === cued && m.user !== ctx.self);
  if (target !== undefined) {
    return { picked: target, state: { lastPickTs: Math.max(pickState.lastPickTs, target.ts), pickedUsers: new Set([...pickState.pickedUsers, target.user]) }, desk: spent };
  }
  const visitors = visitorFirst ? pickMessage(chat.filter((m) => m.fromVisitor === true), pickState, ctx) : undefined;
  return { ...(visitors?.picked !== undefined ? visitors : pickMessage(chat, pickState, ctx)), desk: spent };
}

/** Whether the desk takes the event now (the show controller's methods answer with this). */
export function deskAllows(state: ShowState, desk: Desk, event: DeskEvent, view: DeskView): boolean {
  const status = state.stage.status;
  switch (event.kind) {
    case "hold":
      return state.running && !desk.held && (status === "on_air" || status === "speaking");
    case "resume":
      return desk.held;
    case "skip":
      return state.running && status === "speaking";
    case "cue": {
      if (!state.running || status === "dead_line" || desk.cued === event.id) return false;
      const msg = view.chat.find((m) => m.id === event.id);
      const mark = view.marks?.[event.id] ?? "none";
      return msg !== undefined && msg.user !== view.self && (mark === "none" || mark === "queued" || mark === "passed");
    }
  }
}

type Out = { state: ShowState; desk: Desk; effects: ShowEffect[] };

function step(state: ShowState, desk: Desk, event: ShowEvent, fx: ShowEffect[]): Out {
  const out = showStep(state, event);
  return { state: out.state, desk, effects: [...fx, ...out.effects] };
}

/** The visitor's live pre-empt, for any beat in flight (a cue may outrank a visitor). */
function preempt(state: ShowState, desk: Desk, fx: ShowEffect[]): Out {
  const flight = state.flight === undefined ? undefined : { ...state.flight, visitor: false };
  return step(flight === undefined ? state : { ...state, flight }, desk, { kind: "post" }, fx);
}

/** A desk or show event: the desk's rules first, showStep for the rest. */
export function deskStep(state: ShowState, desk: Desk, event: DeskEvent | ShowEvent): Out {
  const fx: ShowEffect[] = [];
  switch (event.kind) {
    case "hold": {
      fx.push({ kind: "stopAudience" });
      const free = state.stage.status !== "speaking";
      if (free) fx.push({ kind: "clearBeat" });
      if (state.wait !== "none") fx.push({ kind: "clearThink" });
      return { state: { ...state, wait: "none" }, desk: { ...desk, held: true, heldSince: event.at, owed: desk.owed || free }, effects: fx };
    }
    case "resume": {
      const { cued } = desk;
      const open: Desk = cued === undefined ? OPEN_DESK : { ...OPEN_DESK, cued };
      fx.push({ kind: "postAudience" });
      let out: Out = { state: { ...state, pausedMs: state.pausedMs + Math.max(0, event.at - (desk.heldSince ?? event.at)) }, desk: open, effects: fx };
      if (cued !== undefined && state.prefetch && state.flight !== undefined) out = preempt(out.state, out.desk, out.effects);
      else if (desk.postOwed) out = step(out.state, out.desk, { kind: "post" }, out.effects);
      return desk.owed ? step(out.state, out.desk, { kind: "beatDue", gen: state.generation, at: event.at }, out.effects) : out;
    }
    case "skip":
      fx.push({ kind: "stopPlayer" }, { kind: "revoke" }, { kind: "schedule", ms: 0 });
      return { state, desk, effects: fx };
    case "cue": {
      const cuedDesk: Desk = { ...desk, cued: event.id };
      if (!state.prefetch || state.flight === undefined) return { state, desk: cuedDesk, effects: fx };
      if (desk.held) return { state, desk: cuedDesk, effects: fx };
      return preempt(state, cuedDesk, fx);
    }
    case "start":
    case "stop":
      return step(state, OPEN_DESK, event, fx);
    case "picked":
      return step(state, spend(desk), event, fx);
    default:
      break;
  }
  if (!desk.held) return step(state, desk, event, fx);
  const current = !("gen" in event) || event.gen === state.generation;
  const live = state.stage.status !== "dead_line";
  if (event.kind === "post") return { state, desk: { ...desk, postOwed: true }, effects: fx };
  if (current && live && (event.kind === "beatDue" || (event.kind === "lineEnded" && event.result === "ended"))) {
    return { state: { ...state, stage: stageStep(state.stage, { kind: "line", speaking: false }) }, desk: { ...desk, owed: true }, effects: fx };
  }
  const out = step(state, desk, event, fx);
  return { ...out, effects: out.effects.filter((e) => e.kind !== "postAudience") };
}
