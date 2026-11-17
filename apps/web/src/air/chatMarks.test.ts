// One chat lifecycle (challenge-2026-11-17 air/A): every message gets exactly one mark, a visitor's
// message the picks passed by says so, and the answered set is monotone while its ids are on screen
// and forgets the ones that scrolled off (CHAT_KEEP). Pure; no timers.
import type { ChatMsg } from "@sr/engine";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chatMarks, keepAnswered, type ChatMark } from "./chatMarks";

const MARKS: readonly ChatMark[] = ["queued", "pending", "answering", "answered", "passed", "none"];

const msgs: fc.Arbitrary<ChatMsg[]> = fc
  .array(fc.record({ visitor: fc.boolean(), gap: fc.integer({ min: 1, max: 5 }) }), { maxLength: 30 })
  .map((rows) => {
    let ts = 0;
    return rows.map((r, i) => {
      ts += r.gap;
      return { id: `m${i}`, user: r.visitor ? "you" : `u${i % 4}`, text: "x", ts, ...(r.visitor ? { fromVisitor: true } : {}) };
    });
  });

describe("chatMarks", () => {
  it("gives every message exactly one mark, and passes by a visitor's message older than the last pick that was never answered", () => {
    fc.assert(
      fc.property(msgs, fc.integer({ min: -1, max: 160 }), fc.nat(), fc.nat(), fc.array(fc.nat(), { maxLength: 6 }), (chat, lastPickTs, a, b, ans) => {
        const ids = chat.map((m) => m.id);
        const answeringId = ids[a % Math.max(1, ids.length)];
        const speakingAnsweredId = ids[b % Math.max(1, ids.length)];
        const answeredIds = new Set(ans.flatMap((n) => (ids.length === 0 ? [] : [ids[n % ids.length] ?? ""])));
        const marks = chatMarks(chat, {
          lastPickTs,
          answeredIds,
          ...(answeringId === undefined ? {} : { answeringId }),
          ...(speakingAnsweredId === undefined ? {} : { speakingAnsweredId }),
        });
        expect(Object.keys(marks).sort()).toEqual([...ids].sort());
        for (const m of chat) {
          const mark = marks[m.id];
          expect(MARKS).toContain(mark);
          const touched = m.id === answeringId || m.id === speakingAnsweredId || answeredIds.has(m.id);
          if (m.fromVisitor === true && !touched) expect(mark).toBe(m.ts > lastPickTs ? "queued" : "passed");
          if (m.id === speakingAnsweredId) expect(mark).toBe("answering");
          if (m.fromVisitor !== true && !touched) expect(mark).toBe("none");
        }
      }),
    );
  });

  it("names the message a beat in flight answers 'pending' and an answered one 'answered'", () => {
    const chat: ChatMsg[] = [
      { id: "a1", user: "moth", text: "hi", ts: 1 },
      { id: "v1", user: "you", text: "orb?", ts: 2, fromVisitor: true },
      { id: "v2", user: "you", text: "and?", ts: 3, fromVisitor: true },
      { id: "v3", user: "you", text: "late", ts: 9, fromVisitor: true },
    ];
    expect(chatMarks(chat, { lastPickTs: 3, answeringId: "v2", answeredIds: new Set(["a1"]) })).toEqual({ a1: "answered", v1: "passed", v2: "pending", v3: "queued" });
  });
});

describe("keepAnswered", () => {
  it("is monotone while an id is in chat, and drops the ids that left it", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ grow: fc.integer({ min: 0, max: 4 }), add: fc.option(fc.nat()) }), { maxLength: 40 }), (steps) => {
        let next = 0;
        let chat: string[] = [];
        let answered: ReadonlySet<string> = new Set();
        for (const step of steps) {
          for (let i = 0; i < step.grow; i += 1) chat = [...chat, `m${(next += 1)}`].slice(-8);
          const add = step.add === null || chat.length === 0 ? undefined : chat[step.add % chat.length];
          const now = keepAnswered(answered, chat.map((id, ts) => ({ id, user: "u", text: "x", ts })), add);
          for (const id of answered) if (chat.includes(id)) expect(now.has(id)).toBe(true);
          for (const id of now) expect(chat).toContain(id);
          if (add !== undefined) expect(now.has(add)).toBe(true);
          answered = now;
        }
      }),
    );
  });

  it("returns the same set when nothing changes", () => {
    const chat: ChatMsg[] = [{ id: "a", user: "u", text: "x", ts: 1 }];
    const set = new Set(["a"]);
    expect(keepAnswered(set, chat)).toBe(set);
    expect(keepAnswered(set, chat, "a")).toBe(set);
  });
});
