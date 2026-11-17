// The producer desk's pure rules (challenge-2026-11-17 air/B): a cued message is picked before the
// picker's own choice; hold stops beats and the audience without cutting the line; resume moves
// the audience schedule on by the held time; skip cuts the line and schedules the next beat at 0.
import { initialPickState, pickMessage, type ChatMsg, type PickState } from "@sr/engine";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deskAllows, deskPick, deskStep, OPEN_DESK, type Desk } from "./showDesk";
import { initialShow, type ShowState } from "./showMachine";

const SELF = "Malakor";
const msg = (id: string, ts: number, extra: Partial<ChatMsg> = {}): ChatMsg => ({ id, user: `u${id}`, text: "hello", ts, ...extra });
const CHAT: ChatMsg[] = [msg("a5", 500), msg("a7", 700), msg("v1", 900, { fromVisitor: true, text: "why?" }), msg("r0", 950, { user: SELF })];

describe("deskPick", () => {
  it("picks the cued message even when another one scores higher, and clears the cue", () => {
    const ctx = { self: SELF, now: 1_000 };
    expect(pickMessage(CHAT, initialPickState(), ctx).picked?.id).toBe("v1");
    const out = deskPick(CHAT, initialPickState(), { ...OPEN_DESK, cued: "a7" }, ctx);
    expect(out.picked?.id).toBe("a7");
    expect(out.state.lastPickTs).toBe(700);
    expect(out.state.pickedUsers.has("ua7")).toBe(true);
    expect(out.desk.cued).toBeUndefined();
  });

  it("falls back to the picker's choice when the cued message has left the chat, and clears the cue", () => {
    const ctx = { self: SELF, now: 1_000 };
    const out = deskPick(CHAT, initialPickState(), { ...OPEN_DESK, cued: "a1" }, ctx);
    expect(out.picked?.id).toBe(pickMessage(CHAT, initialPickState(), ctx).picked?.id);
    expect(out.desk.cued).toBeUndefined();
  });

  it("is the picker exactly when nothing usable is cued; the cued message whenever it is (property)", () => {
    const chatArb = fc.uniqueArray(
      fc
        .record({ id: fc.string({ minLength: 1, maxLength: 3 }), user: fc.constantFrom(SELF, "a", "b"), text: fc.constantFrom("hi", "why?"), ts: fc.integer({ min: 0, max: 5_000 }), visitor: fc.boolean() })
        .map(({ visitor, ...m }): ChatMsg => (visitor ? { ...m, fromVisitor: true } : m)),
      { selector: (m) => m.id, maxLength: 12 },
    );
    const stateArb: fc.Arbitrary<PickState> = fc.record({ lastPickTs: fc.integer({ min: -1, max: 5_000 }), pickedUsers: fc.constantFrom(new Set<string>(), new Set(["a"])) });
    fc.assert(
      // The cue: an id on screen (by index), a stray id, or none.
      fc.property(chatArb, stateArb, fc.oneof(fc.nat(), fc.string({ maxLength: 3 }), fc.constant(undefined)), (chat, state, pick) => {
        const cued = typeof pick === "number" ? chat[pick % Math.max(1, chat.length)]?.id : pick;
        const ctx = { self: SELF, now: 6_000 };
        const desk: Desk = cued === undefined ? OPEN_DESK : { ...OPEN_DESK, cued };
        const out = deskPick(chat, state, desk, ctx);
        const target = chat.find((m) => m.id === cued && m.user !== SELF);
        if (target === undefined) expect(out).toMatchObject(pickMessage(chat, state, ctx));
        else {
          expect(out.picked).toBe(target);
          expect(out.state.lastPickTs).toBe(Math.max(state.lastPickTs, target.ts));
        }
        expect(out.desk.cued).toBeUndefined();
      }),
    );
  });
});

/** A running show on air at generation 1. */
function onAir(over: Partial<ShowState> = {}): ShowState {
  const s = initialShow(false);
  return { ...s, running: true, generation: 1, stage: { status: "on_air", engineErrors: 0 }, ...over };
}
const speaking = (over: Partial<ShowState> = {}) => onAir({ stage: { status: "speaking", engineErrors: 0 }, ...over });

describe("deskStep", () => {
  it("hold while a line plays: the audience stops, the line runs on, its end is owed to resume", () => {
    const held = deskStep(speaking(), OPEN_DESK, { kind: "hold", at: 3_000 });
    expect(held.desk).toMatchObject({ held: true, heldSince: 3_000 });
    expect(held.effects).toEqual([{ kind: "stopAudience" }]);
    const ended = deskStep(held.state, held.desk, { kind: "lineEnded", gen: 1, result: "ended", elapsed: 12_000, at: 15_000 });
    expect(ended.effects).toEqual([]);
    expect(ended.state.stage.status).toBe("on_air");
    expect(ended.desk.owed).toBe(true);
    const due = deskStep(ended.state, ended.desk, { kind: "beatDue", gen: 1, at: 16_000 });
    expect(due.effects).toEqual([]);
    const resumed = deskStep(due.state, due.desk, { kind: "resume", at: 23_000 });
    expect(resumed.state.pausedMs).toBe(20_000);
    expect(resumed.desk).toEqual(OPEN_DESK);
    expect(resumed.effects.map((fx) => fx.kind)).toEqual(["postAudience", "launchBeat", "startThink"]);
  });

  it("hold on a free stage clears the beat timer and the thinking wait; resume launches at once", () => {
    const held = deskStep(onAir({ wait: "thinking" }), OPEN_DESK, { kind: "hold", at: 1_000 });
    expect(held.effects.map((fx) => fx.kind)).toEqual(["stopAudience", "clearBeat", "clearThink"]);
    expect(held.state.wait).toBe("none");
    expect(held.desk.owed).toBe(true);
  });

  it("while held a visitor's pre-empt waits for resume", () => {
    const held = deskStep(onAir({ prefetch: true, flight: { id: 0, prefetched: true, visitor: false } }), OPEN_DESK, { kind: "hold", at: 0 });
    const post = deskStep(held.state, held.desk, { kind: "post" });
    expect(post.effects).toEqual([]);
    expect(post.desk.postOwed).toBe(true);
    const resumed = deskStep(post.state, post.desk, { kind: "resume", at: 5_000 });
    expect(resumed.effects.map((fx) => fx.kind)).toEqual(["postAudience", "abort", "launchBeat", "startThink"]);
  });

  it("skip cuts the line: stop the player, release its clip, the next beat at 0", () => {
    expect(deskStep(speaking(), OPEN_DESK, { kind: "skip" }).effects).toEqual([{ kind: "stopPlayer" }, { kind: "revoke" }, { kind: "schedule", ms: 0 }]);
  });

  it("cue on live pre-empts any beat in flight; the next pick clears the cue", () => {
    const s = speaking({ prefetch: true, flight: { id: 3, prefetched: true, visitor: true }, nextFlight: 4 });
    const cued = deskStep(s, OPEN_DESK, { kind: "cue", id: "a7" });
    expect(cued.effects).toEqual([{ kind: "abort", flight: 3 }, { kind: "launchBeat", flight: 4, visitorFirst: true, prefetched: true }]);
    expect(cued.desk.cued).toBe("a7");
    const picked = deskStep(cued.state, cued.desk, { kind: "picked", flight: 4, visitor: false, pickState: initialPickState() });
    expect(picked.desk.cued).toBeUndefined();
  });

  it("stop clears the desk", () => {
    const held = deskStep(speaking(), { ...OPEN_DESK, cued: "x" }, { kind: "hold", at: 0 });
    expect(deskStep(held.state, held.desk, { kind: "stop" }).desk).toEqual(OPEN_DESK);
  });
});

describe("deskAllows", () => {
  const view = { chat: CHAT, self: SELF, marks: { a5: "answered", a7: "none", v1: "pending", r0: "none" } as const };
  it("holds only a running stage on air, resumes only a held one, skips only a spoken line", () => {
    expect(deskAllows(onAir(), OPEN_DESK, { kind: "hold", at: 0 }, view)).toBe(true);
    expect(deskAllows(onAir({ stage: { status: "dead_line", engineErrors: 2 } }), OPEN_DESK, { kind: "hold", at: 0 }, view)).toBe(false);
    expect(deskAllows(onAir(), OPEN_DESK, { kind: "resume", at: 0 }, view)).toBe(false);
    expect(deskAllows(onAir(), { ...OPEN_DESK, held: true, heldSince: 0 }, { kind: "resume", at: 0 }, view)).toBe(true);
    expect(deskAllows(speaking(), OPEN_DESK, { kind: "skip" }, view)).toBe(true);
    expect(deskAllows(onAir(), OPEN_DESK, { kind: "skip" }, view)).toBe(false);
  });

  it("cues a message on screen that nobody answered and the character did not write", () => {
    expect(deskAllows(onAir(), OPEN_DESK, { kind: "cue", id: "a7" }, view)).toBe(true);
    for (const id of ["a5", "v1", "r0", "gone"]) expect(deskAllows(onAir(), OPEN_DESK, { kind: "cue", id }, view)).toBe(false);
    expect(deskAllows(onAir(), { ...OPEN_DESK, cued: "a7" }, { kind: "cue", id: "a7" }, view)).toBe(false);
  });
});
