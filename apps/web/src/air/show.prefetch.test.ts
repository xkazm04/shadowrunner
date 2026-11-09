// LIVE prefetch (perfection-pass 5.4): one beat ahead while a line plays, pre-empted by a visitor,
// never retried, quiet on failure, off on replay. Fake engine and voice clients that take time on
// vitest's fake clock and honour the AbortSignal (showKit); fake player; no network, no key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MALAKOR_NAME, malakorShow } from "./malakor";
import { BEAT_MS, type ShowSnapshot } from "./show";
import { LINE_MS, setup, type Options } from "./showKit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The fake clock in 10 ms steps (response bodies settle between steps; see show.wait.test.ts). */
async function tick(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 10) await vi.advanceTimersByTimeAsync(Math.min(10, ms - t));
}

const QUIET = { ...malakorShow(), audience: [] };
const SLOW: Options = { show: QUIET, prefetch: true, replyMs: 1_000, voiceMs: 1_000 };
/** The first line is up once its reply and voice have arrived. */
const FIRST_LINE = 2_100;

function live(options: Options = SLOW) {
  const kit = setup(options);
  const snaps: ShowSnapshot[] = [];
  kit.show.subscribe(() => snaps.push(kit.show.snapshot()));
  kit.show.start();
  return { ...kit, snaps };
}

describe("the live prefetch", () => {
  it("fetches the next reply, voice and mouth track while a line plays, so the next line follows at once", async () => {
    const { show, seen, snaps } = live();
    await tick(FIRST_LINE);
    expect(show.snapshot().caption?.beat).toBe(0);
    await tick(2_200);
    // One beat ahead, already voiced and its mouth track started, while line 0 still plays.
    expect(seen.engine.map((r) => r.beat)).toEqual([0, 1]);
    expect(seen.voice).toHaveLength(2);
    expect(seen.analysed.map(([, text]) => text)).toEqual(seen.voice);
    expect(show.snapshot().caption?.beat).toBe(0);
    const before = snaps.length;
    await tick(LINE_MS - 2_200 + 20);
    // Line 0 ended and line 1 is up within a few ms: no thinking state in between.
    expect(show.snapshot()).toMatchObject({ status: "speaking", caption: { beat: 1 } });
    expect(snaps.slice(before).every((s) => s.pending === undefined)).toBe(true);
    expect(seen.played[1]).toBe(seen.analysed[1]?.[0]);
    show.stop();
  });

  it("sends the prefetched beat the chat as it will be when it plays: the line now playing included", async () => {
    const { show, seen } = live();
    await tick(FIRST_LINE + 100);
    const playing = show.snapshot().caption?.line;
    const sent = seen.engine[1]?.chat.filter((m) => m.user === MALAKOR_NAME).at(-1);
    expect(sent?.text).toBe(playing);
    show.stop();
  });

  it("keeps at most one beat in flight", async () => {
    const { show, seen } = live({ ...SLOW, show: malakorShow() });
    for (let t = 0; t < LINE_MS * 6; t += 500) {
      await tick(500);
      // Requests made = lines aired + at most one ahead.
      expect(seen.engine.length).toBeLessThanOrEqual(show.snapshot().beat + 1);
    }
    expect(show.snapshot().beat).toBeGreaterThan(4);
    show.stop();
  });

  it("gives way to a visitor: the prefetch is aborted, the visitor's beat is fetched next, the discarded one never again", async () => {
    const { show, seen } = live();
    await tick(FIRST_LINE + 300); // line 0 plays; the prefetch's reply is in flight
    expect(seen.engine).toHaveLength(2);
    expect(seen.engine[1]?.pickedId).toBeUndefined();
    show.post("is the orb heavy?");
    await tick(10);
    expect(seen.aborted).toEqual(["engine:1"]);
    expect(seen.engine).toHaveLength(3);
    expect(seen.engine[2]).toMatchObject({ beat: 1, pickedId: "v1" });
    expect(show.snapshot().answering).toBe("v1");
    await tick(LINE_MS);
    expect(show.snapshot().caption).toMatchObject({ beat: 1, answered: { id: "v1" } });
    await tick(LINE_MS * 2);
    // One request per beat after that: beat 1 was asked twice (the discarded one and the visitor's), never a third time.
    const beats = seen.engine.map((r) => r.beat);
    expect(beats.filter((b) => b === 1)).toHaveLength(2);
    expect(new Set(beats.filter((b) => b !== 1)).size).toBe(beats.filter((b) => b !== 1).length);
    show.stop();
  });

  it("releases the clip of a prefetch that had already landed when the visitor pre-empts it", async () => {
    const { show, seen } = live();
    await tick(FIRST_LINE + 2_200); // the prefetch has its reply and its voice (an object URL)
    const url = seen.analysed[1]?.[0];
    expect(url).toBeDefined();
    show.post("still there?");
    await tick(10);
    expect(seen.revoked).toContain(url);
    expect(seen.engine.at(-1)?.pickedId).toBe("v1");
    await tick(LINE_MS);
    expect(seen.played).not.toContain(url);
    show.stop();
  });

  it("does not pre-empt a beat that already answers a visitor", async () => {
    const { show, seen } = live();
    await tick(FIRST_LINE + 300);
    show.post("first?");
    await tick(10);
    expect(seen.engine.at(-1)?.pickedId).toBe("v1");
    show.post("second?");
    await tick(10);
    expect(seen.aborted).toEqual(["engine:1"]); // only the segment line, not the visitor's beat
    expect(show.snapshot().chat.find((m) => m.id === "v2")?.queued).toBe(true);
    await tick(LINE_MS * 2);
    expect(seen.engine.map((r) => r.pickedId)).toContain("v2");
    show.stop();
  });

  it("drops a failed prefetch quietly and asks again when the line ends, with no error state", async () => {
    const { show, seen, snaps } = live({ ...SLOW, engineFailsOn: [1, 3] });
    await tick(FIRST_LINE + LINE_MS + FIRST_LINE);
    // The prefetch (call 1) failed during line 0; the serial path asked at once when it ended (call 2).
    expect(seen.engine.map((r) => r.beat)).toEqual([0, 1, 1, 2]);
    expect(show.snapshot()).toMatchObject({ status: "speaking", caption: { beat: 1 } });
    await tick(LINE_MS + FIRST_LINE);
    expect(show.snapshot().caption?.beat).toBe(2);
    expect(snaps.some((s) => s.status === "dead_line")).toBe(false);
    show.stop();
  });

  it("still counts serial engine errors: two in a row kill the line", async () => {
    const { show, snaps } = live({ ...SLOW, engineFails: 2 });
    await tick(2_200 + BEAT_MS);
    expect(snaps.some((s) => s.status === "dead_line")).toBe(true);
    show.stop();
  });

  it("aborts the beat in flight when the show stops", async () => {
    const { show, seen } = live();
    await tick(FIRST_LINE + 300);
    show.stop();
    await tick(10);
    expect(seen.aborted).toEqual(["engine:1"]);
  });

  it("is off unless asked for (replay, scripted and sheet shows): one request per line, made when the stage is free", async () => {
    const { show, seen } = live({ ...SLOW, prefetch: false });
    await tick(FIRST_LINE + 4_000);
    expect(seen.engine).toHaveLength(1);
    show.post("hello?");
    await tick(10);
    expect(seen.aborted).toEqual([]);
    show.stop();
  });
});
