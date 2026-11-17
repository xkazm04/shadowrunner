// The producer desk on the show controller (challenge-2026-11-17 air/B): hold stops beats and the
// audience but lets the line finish; resume launches at once and moves the audience on by the held
// time; skip cuts the line; cue steers the next pick (on live it pre-empts the beat in flight).
// Fake engine, voice and player on vitest's fake clock (showKit); no network.
import type { ShowScript } from "@sr/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MALAKOR_NAME, malakorShow } from "./malakor";
import { LINE_MS, setup } from "./showKit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function tick(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 10) await vi.advanceTimersByTimeAsync(Math.min(10, ms - t));
}

const audience = (show: ScriptKit) => show.snapshot().chat.filter((m) => m.fictional === true).map((m) => m.id);
type ScriptKit = ReturnType<typeof setup>["show"];

describe("hold and resume", () => {
  it("holds: no engine request and no audience message for 60 s, the line runs to its end", async () => {
    const { show, seen } = setup();
    show.start();
    await tick(3_000);
    expect(show.snapshot().status).toBe("speaking");
    const asked = seen.engine.length;
    const heard = audience(show);
    expect(show.hold()).toBe(true);
    expect(show.snapshot().held).toBe(true);
    await tick(LINE_MS - 3_000 - 100);
    expect(show.snapshot().status).toBe("speaking"); // the line was not cut
    await tick(60_000);
    expect(show.snapshot().status).toBe("on_air");
    expect(seen.engine).toHaveLength(asked);
    expect(audience(show)).toEqual(heard);
    expect(show.snapshot().held).toBe(true);
    show.stop();
  });

  it("resumes: the next beat at once, the audience shifted by the held time with no backlog burst", async () => {
    const { show, seen } = setup();
    show.start();
    await tick(3_000); // a01 (2 s) is in; a02 is due at 4.5 s
    expect(audience(show)).toEqual(["a01"]);
    show.hold();
    await tick(20_000);
    const asked = seen.engine.length;
    expect(show.resume()).toBe(true);
    await tick(10);
    expect(show.snapshot().held).toBeUndefined();
    expect(seen.engine).toHaveLength(asked + 1);
    expect(audience(show)).toEqual(["a01"]);
    await tick(1_400); // 4.5 s + 20 s held - 23 s now: not yet
    expect(audience(show)).toEqual(["a01"]);
    await tick(200);
    expect(audience(show)).toEqual(["a01", "a02"]);
    show.stop();
  });
});

describe("skip", () => {
  it("cuts the line: player stopped, its clip released, the next beat at once", async () => {
    const stop = vi.fn();
    const { show, seen } = setup({ stop });
    show.start();
    await tick(3_000);
    const url = seen.played[0];
    const asked = seen.engine.length;
    expect(show.snapshot().beat).toBe(1);
    expect(show.skip()).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(seen.revoked).toContain(url);
    await tick(250);
    expect(seen.engine).toHaveLength(asked + 1);
    expect(show.snapshot()).toMatchObject({ status: "speaking", beat: 2, caption: { beat: 1 } });
    // The cut line's audio end, when it comes, does not end the line that replaced it.
    await tick(LINE_MS - 3_000 + 1_000); // past the cut line's end (12 s), before the new one's (15.25 s)
    expect(show.snapshot().caption?.beat).toBe(1);
    show.stop();
  });

  it("does nothing with no line up", async () => {
    const stop = vi.fn();
    const { show } = setup({ stop, health: [false] });
    show.start();
    await tick(500);
    const before = show.snapshot();
    const stops = stop.mock.calls.length; // the dead line stopped it once
    expect(show.skip()).toBe(false);
    expect(stop).toHaveBeenCalledTimes(stops);
    expect(show.snapshot()).toBe(before);
    show.stop();
  });
});

describe("cue", () => {
  const TWO: ShowScript = {
    ...malakorShow(),
    audience: [
      // Flagged as visitors' so the replay engine answers them by id.
      { id: "a1", user: "Owl", text: "why the orb?", ts: 500, fictional: true, fromVisitor: true },
      { id: "a7", user: "Rook", text: "hi", ts: 600, fictional: true, fromVisitor: true },
    ],
  };
  const live = () => {
    const kit = setup({ show: TWO, prefetch: true, replyMs: 1_000, voiceMs: 1_000 });
    kit.show.start();
    return kit;
  };

  it("on live pre-empts the prefetch answering another message: aborted, its pick undone, the cued one answered next", async () => {
    const { show, seen } = live();
    await tick(2_400); // line 0 plays; the prefetch's reply (answering a1) is in flight
    expect(seen.engine[1]?.pickedId).toBe("a1");
    expect(show.cue("a7")).toBe(true);
    expect(show.snapshot().cued).toBeUndefined(); // taken by the beat launched at once
    await tick(10);
    expect(seen.aborted).toEqual(["engine:1"]);
    expect(seen.engine[2]).toMatchObject({ beat: 1, pickedId: "a7" });
    expect(show.snapshot().answering).toBe("a7");
    expect(show.snapshot().marks?.a1).not.toBe("pending");
    await tick(LINE_MS);
    expect(show.snapshot().caption).toMatchObject({ beat: 1, answered: { id: "a7" } });
    show.stop();
  });

  it("refuses the character's own message and one already answered, and changes nothing", async () => {
    const { show, seen } = live();
    await tick(2_400 + LINE_MS); // line 1 answers a1
    expect(show.snapshot().caption?.answered?.id).toBe("a1");
    const before = show.snapshot();
    const asked = seen.engine.length;
    const own = before.chat.find((m) => m.user === MALAKOR_NAME)?.id ?? "";
    expect(show.cue(own)).toBe(false);
    expect(show.cue("a1")).toBe(false);
    expect(show.snapshot()).toBe(before);
    expect(seen.engine).toHaveLength(asked);
    show.stop();
  });
});
