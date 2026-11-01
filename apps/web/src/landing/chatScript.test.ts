import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  delayOf,
  HISTORY,
  initialChat,
  isTyping,
  MAX_LINES,
  readMs,
  SCRIPT,
  START_MS,
  staticChat,
  stepChat,
  TYPE_MS,
  TYPE_STEP,
  typingMs,
  type ChatLine,
  type ChatState,
} from "./chatScript";

/** The state after `n` ticks from `start`, with every intermediate state. */
function run(n: number, start: ChatState = initialChat(), script: readonly ChatLine[] = SCRIPT): ChatState[] {
  const states = [start];
  for (let i = 0; i < n; i++) {
    const prev = states.at(-1) ?? start;
    states.push(stepChat(prev, script));
  }
  return states;
}

const line: fc.Arbitrary<ChatLine> = fc.oneof(
  fc.record({
    kind: fc.constant("viewer" as const),
    user: fc.string({ minLength: 1, maxLength: 12 }),
    rank: fc.string({ minLength: 1, maxLength: 12 }),
    text: fc.string({ minLength: 1, maxLength: 60 }),
  }),
  fc.record({ kind: fc.constant("host" as const), text: fc.string({ minLength: 1, maxLength: 120 }) }),
);
const script = fc.array(line, { minLength: 1, maxLength: 8 });
const ticks = fc.integer({ min: 0, max: 600 });

describe("chat script", () => {
  it("holds the reference's lines: a history of four, then twenty alternating viewer and host", () => {
    expect(HISTORY).toHaveLength(4);
    expect(SCRIPT).toHaveLength(20);
    SCRIPT.forEach((l, i) => expect(l.kind).toBe(i % 2 === 0 ? "viewer" : "host"));
    for (const l of [...HISTORY, ...SCRIPT]) expect(l.text.trim().length).toBeGreaterThan(0);
    expect(SCRIPT[0]).toEqual({ kind: "viewer", user: "moth_in_a_jar", rank: "Thrall", text: "first time here. why is it 3am in here" });
  });

  it("arrives with the history complete and nothing being typed", () => {
    const s = initialChat();
    expect(s.lines.map((l) => l.line)).toEqual(HISTORY);
    expect(s.lines.some(isTyping)).toBe(false);
    expect(delayOf({ ...s, lines: [] })).toBe(START_MS);
  });

  it("has a static twin: history and the first exchange, complete, within MAX_LINES", () => {
    const s = staticChat();
    expect(s.lines.map((l) => l.line)).toEqual([...HISTORY, ...SCRIPT.slice(0, 2)]);
    expect(s.lines.some(isTyping)).toBe(false);
    expect(s.lines.length).toBeLessThanOrEqual(MAX_LINES);
  });
});

describe("stepChat (property)", () => {
  it("keeps at most MAX_LINES, with unique increasing ids and only the newest line typing", () => {
    fc.assert(
      fc.property(script, ticks, (sc, n) => {
        // Plain checks per state, one assertion per run: expect() per state is too slow here.
        const bad = run(n, initialChat(), sc).findIndex(
          (s) =>
            s.lines.length > MAX_LINES ||
            s.serial <= (s.lines.at(-1)?.id ?? -1) ||
            s.lines.some(
              (l, i) =>
                l.typed < 0 ||
                l.typed > l.line.text.length ||
                (i > 0 && l.id <= (s.lines[i - 1]?.id ?? Infinity)) ||
                (i < s.lines.length - 1 && isTyping(l)),
            ),
        );
        expect(bad, `state after ${bad} ticks`).toBe(-1);
      }),
    );
  });

  it("plays the script in order, cycling, and types each host line to the end before the next", () => {
    fc.assert(
      fc.property(script, ticks, (sc, n) => {
        const states = run(n, initialChat(), sc);
        const arrived: ChatLine[] = [];
        const faults: string[] = [];
        for (let i = 1; i < states.length; i++) {
          const before = states[i - 1]?.lines.at(-1);
          const after = states[i]?.lines.at(-1);
          if (after && after.id !== before?.id) {
            // A new line only arrives once the previous one is complete, a host line empty.
            if (isTyping(before)) faults.push(`tick ${i}: arrived while typing`);
            if (after.typed !== (after.line.kind === "host" ? 0 : after.line.text.length)) faults.push(`tick ${i}: arrived at ${after.typed}`);
            arrived.push(after.line);
          } else if (before && after) {
            // Otherwise the newest line types on, TYPE_STEP at a time, never backwards.
            const want = Math.min(TYPE_STEP, before.line.text.length - before.typed);
            if (after.typed - before.typed !== want) faults.push(`tick ${i}: typed ${after.typed - before.typed}, want ${want}`);
          }
        }
        expect(faults).toEqual([]);
        // Identity, not just equality: the lines are the script's own, in order, cycling.
        expect(arrived.every((l, i) => l === sc[i % sc.length])).toBe(true);
      }),
    );
  });

  it("always waits a positive, finite time, typing at TYPE_MS", () => {
    fc.assert(
      fc.property(script, ticks, (sc, n) => {
        const bad = run(n, initialChat(), sc).findIndex((s) => {
          const d = delayOf(s);
          return !(Number.isFinite(d) && d > 0) || (isTyping(s.lines.at(-1)) && d !== TYPE_MS);
        });
        expect(bad, `state after ${bad} ticks`).toBe(-1);
      }),
    );
  });

  it("holds a typed host line until the reference's next-line time", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 400 }), (text) => {
        expect(typingMs(text) + readMs(text)).toBe(Math.max(4200, text.length * 60 + 1800));
        expect(readMs(text)).toBeGreaterThan(0);
      }),
    );
  });
});
