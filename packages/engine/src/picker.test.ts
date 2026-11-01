import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { initialPickState, pickMessage, type ChatMsg, type PickState } from "@sr/engine";

const SELF = "Malakor";
const USERS = [SELF, "ghoul_42", "wisp", "lantern", "visitor"] as const;

type Draft = Omit<ChatMsg, "id">;

const draftArb: fc.Arbitrary<Draft> = fc
  .record({
    user: fc.constantFrom(...USERS),
    text: fc.oneof(fc.string({ maxLength: 20 }), fc.constant("why?"), fc.constant("hail")),
    ts: fc.integer({ min: 0, max: 120_000 }),
    visitor: fc.boolean(),
  })
  .map(({ user, text, ts, visitor }) => (visitor ? { user, text, ts, fromVisitor: true } : { user, text, ts }));

/** Messages with unique ids, in arrival order. */
const msgsArb: fc.Arbitrary<ChatMsg[]> = fc
  .array(draftArb, { maxLength: 30 })
  .map((drafts) => drafts.map((d, i) => ({ ...d, id: `m${i}` })));

const stateArb: fc.Arbitrary<PickState> = fc.record({
  lastPickTs: fc.oneof(fc.constant(Number.NEGATIVE_INFINITY), fc.integer({ min: 0, max: 120_000 })),
  pickedUsers: fc.uniqueArray(fc.constantFrom(...USERS)).map((users) => new Set(users)),
});

const nowArb = fc.integer({ min: 0, max: 200_000 });

function eligible(msgs: readonly ChatMsg[], state: PickState): ChatMsg[] {
  return msgs.filter((m) => m.user !== SELF && m.ts > state.lastPickTs);
}

function msg(id: string, user: string, text: string, ts: number, extra: Partial<ChatMsg> = {}): ChatMsg {
  return { id, user, text, ts, ...extra };
}

describe("pickMessage properties", () => {
  it("never picks the character's own message", () => {
    fc.assert(
      fc.property(msgsArb, stateArb, nowArb, (msgs, state, now) => {
        const { picked } = pickMessage(msgs, state, { self: SELF, now });
        expect(picked?.user).not.toBe(SELF);
      }),
    );
  });

  it("never picks the same message twice across a show", () => {
    const streamArb = fc.array(fc.array(draftArb, { maxLength: 5 }), { maxLength: 25 });
    fc.assert(
      fc.property(streamArb, (batches) => {
        const msgs: ChatMsg[] = [];
        const seen = new Set<string>();
        let state = initialPickState();
        let now = 0;
        for (const batch of batches) {
          for (const d of batch) msgs.push({ ...d, id: `m${msgs.length}` });
          now += 9_000;
          const result = pickMessage(msgs, state, { self: SELF, now });
          state = result.state;
          if (result.picked === undefined) continue;
          expect(seen.has(result.picked.id)).toBe(false);
          expect(result.picked.user).not.toBe(SELF);
          seen.add(result.picked.id);
        }
      }),
    );
  });

  it("picks an eligible input message exactly when one exists, and records it in the new state", () => {
    fc.assert(
      fc.property(msgsArb, stateArb, nowArb, (msgs, state, now) => {
        const candidates = eligible(msgs, state);
        const result = pickMessage(msgs, state, { self: SELF, now });
        if (candidates.length === 0) {
          expect(result).toEqual({ state });
          expect("picked" in result).toBe(false);
          return;
        }
        const { picked } = result;
        expect(picked && candidates.includes(picked)).toBe(true);
        expect(result.state.lastPickTs).toBe(picked?.ts);
        expect(result.state.pickedUsers.has(picked?.user ?? "")).toBe(true);
        for (const user of state.pickedUsers) expect(result.state.pickedUsers.has(user)).toBe(true);
      }),
    );
  });

  it("does not mutate the state it is given", () => {
    fc.assert(
      fc.property(msgsArb, stateArb, nowArb, (msgs, state, now) => {
        const before = { lastPickTs: state.lastPickTs, users: [...state.pickedUsers] };
        pickMessage(msgs, state, { self: SELF, now });
        expect(state.lastPickTs).toBe(before.lastPickTs);
        expect([...state.pickedUsers]).toEqual(before.users);
      }),
    );
  });
});

describe("pickMessage scoring (design.md, Picker)", () => {
  const now = 60_000;
  const fresh = initialPickState();

  it("returns no pick and the same state for an empty chat", () => {
    const result = pickMessage([], fresh, { self: SELF, now });
    expect(result.picked).toBeUndefined();
    expect(result.state).toBe(fresh);
  });

  it("prefers the newer message when nothing else differs", () => {
    const msgs = [msg("a", "wisp", "hail", 30_000), msg("b", "ghoul_42", "hail", 50_000)];
    expect(pickMessage(msgs, fresh, { self: SELF, now }).picked?.id).toBe("b");
  });

  it("gives the visitor +0.5 over a slightly newer audience message", () => {
    const msgs = [msg("v", "visitor", "hail", 50_000, { fromVisitor: true }), msg("a", "wisp", "hail", 59_000)];
    expect(pickMessage(msgs, fresh, { self: SELF, now }).picked?.id).toBe("v");
  });

  it("gives a question mark +0.3", () => {
    const msgs = [msg("q", "wisp", "is the lich ok?", 55_000), msg("s", "ghoul_42", "hail", 59_000)];
    expect(pickMessage(msgs, fresh, { self: SELF, now }).picked?.id).toBe("q");
  });

  it("gives a never-picked user +0.3", () => {
    const state: PickState = { lastPickTs: 0, pickedUsers: new Set(["ghoul_42"]) };
    const msgs = [msg("new", "wisp", "hail", 55_000), msg("old", "ghoul_42", "hail", 59_000)];
    expect(pickMessage(msgs, state, { self: SELF, now }).picked?.id).toBe("new");
  });

  it("breaks ties by the earliest message", () => {
    // Same ts and bonuses: the first in arrival order wins.
    const same = [msg("first", "wisp", "hail", 50_000), msg("second", "lantern", "hail", 50_000)];
    expect(pickMessage(same, fresh, { self: SELF, now: 50_000 }).picked?.id).toBe("first");
    // Recency has decayed to 0 for both: the earlier ts wins even when it arrived later.
    const stale = [msg("newer", "wisp", "hail", 1), msg("older", "lantern", "hail", 0)];
    expect(pickMessage(stale, fresh, { self: SELF, now: 100_000_000 }).picked?.id).toBe("older");
  });

  it("only considers messages newer than the last pick", () => {
    const state: PickState = { lastPickTs: 50_000, pickedUsers: new Set() };
    const msgs = [msg("at", "wisp", "why?", 50_000, { fromVisitor: true }), msg("after", "lantern", "hail", 50_001)];
    expect(pickMessage(msgs, state, { self: SELF, now }).picked?.id).toBe("after");
  });
});
