// Never dead air, the wait (perfection-pass 5.1, 5.2): the thinking state, the queued and
// answering marks, and the reply's emotion before its voice. Fake engine and voice that take time
// on vitest's fake clock (showKit), fake player; no network.
import type { ShowSnapshot } from "./show";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MALAKOR_NAME, malakorShow } from "./malakor";
import { THINK_DELAY_MS } from "./show";
import { LINE_MS, setup } from "./showKit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Runs the fake clock in 10 ms steps. A response body is read by real async I/O, which settles
 * only between steps, so a coarse step would stretch every fetch to the step's length.
 */
async function tick(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 10) await vi.advanceTimersByTimeAsync(Math.min(10, ms - t));
}

/** Every snapshot the show publishes, in order. */
function record(show: { subscribe(l: () => void): () => void; snapshot(): ShowSnapshot }): ShowSnapshot[] {
  const seen: ShowSnapshot[] = [];
  show.subscribe(() => seen.push(show.snapshot()));
  return seen;
}

const QUIET = { ...malakorShow(), audience: [] };

describe("the thinking state", () => {
  it.each([0, THINK_DELAY_MS - 50])("never shows for a wait of %i ms (replay answers at once)", async (ms) => {
    const { show } = setup({ replyMs: ms });
    const snaps = record(show);
    show.start();
    await tick(LINE_MS * 3);
    expect(snaps.filter((s) => s.status === "speaking").length).toBeGreaterThan(2);
    expect(snaps.every((s) => s.pending === undefined)).toBe(true);
    show.stop();
  });

  it("shows 'reply', then 'voice' with the reply's emotion, and the line joins the chat only when it starts", async () => {
    const { show } = setup({ show: QUIET, replyMs: 1_000, voiceMs: 1_000 });
    show.start();
    await tick(THINK_DELAY_MS - 10);
    expect(show.snapshot().pending).toBeUndefined();
    await tick(20);
    expect(show.snapshot()).toMatchObject({ pending: "reply", status: "on_air" });
    expect(show.snapshot().upcoming).toBeUndefined();
    await tick(1_000);
    const waiting = show.snapshot();
    expect(waiting.pending).toBe("voice");
    expect(waiting.upcoming?.emotion).toBeDefined();
    expect(waiting.chat.some((m) => m.user === MALAKOR_NAME)).toBe(false); // not before it is spoken
    await tick(1_000);
    const speaking = show.snapshot();
    expect(speaking).toMatchObject({ status: "speaking", pending: undefined });
    expect(speaking.upcoming).toBeUndefined();
    expect(speaking.caption?.reply).toEqual(waiting.upcoming);
    expect(speaking.chat.at(-1)).toMatchObject({ user: MALAKOR_NAME, text: speaking.caption?.line });
    show.stop();
  });

  it("clears the thinking state and its timer when the show stops", async () => {
    const { show } = setup({ show: QUIET, replyMs: 5_000 });
    show.start();
    await tick(THINK_DELAY_MS + 10);
    expect(show.snapshot().pending).toBe("reply");
    show.stop();
    expect(show.snapshot().pending).toBeUndefined();
    await tick(10_000);
    expect(show.snapshot().pending).toBeUndefined();
  });
});

describe("the visitor's marks", () => {
  it("is queued until picked, answering until its line starts, and never sent to the engine with a mark", async () => {
    const { show, seen } = setup({ show: QUIET, replyMs: 1_000, voiceMs: 1_000 });
    show.start();
    await tick(2_100);
    expect(show.snapshot().status).toBe("speaking");
    show.post("is the orb heavy?");
    const visitor = () => show.snapshot().chat.find((m) => m.fromVisitor);
    expect(visitor()?.queued).toBe(true);
    // The line ends: the next beat picks the visitor.
    await tick(LINE_MS);
    expect(seen.engine.at(-1)?.pickedId).toBe(visitor()?.id);
    expect(visitor()?.queued).toBeUndefined();
    expect("queued" in (visitor() ?? {})).toBe(false);
    expect(show.snapshot().answering).toBe(visitor()?.id);
    for (const req of seen.engine) for (const m of req.chat) expect("queued" in m).toBe(false);
    await tick(2_100);
    expect(show.snapshot().answering).toBeUndefined();
    expect(show.snapshot().caption?.answered?.id).toBe(visitor()?.id);
    show.stop();
  });

  it("marks exactly the visitor's messages newer than the last pick, at every step", async () => {
    // A busy audience: some of the visitor's messages are answered, some are outscored and passed by.
    const { show, seen } = setup();
    show.start();
    const ts = new Map<string, number>();
    for (let i = 0; i < 24; i += 1) {
      if (i % 3 === 0) show.post(`question ${i}?`);
      await tick(LINE_MS / 2);
      const chat = show.snapshot().chat;
      for (const m of chat) ts.set(m.id, m.ts);
      const lastPick = Math.max(Number.NEGATIVE_INFINITY, ...seen.engine.flatMap((r) => (r.pickedId === undefined ? [] : [ts.get(r.pickedId) ?? Number.NEGATIVE_INFINITY])));
      for (const m of chat) expect(m.queued === true, m.id).toBe(m.fromVisitor === true && m.ts > lastPick);
    }
    expect(seen.engine.some((r) => r.pickedId?.startsWith("v") === true)).toBe(true);
    show.stop();
  });
});
