// The beat loop and the one clock (voice-and-air task 5.2 and the task 5 note). Fake fetch (the
// replay engine answers from the recorded show, the voice is a blob or a 500), fake player, fake
// timers; no network.
import { ScriptedEngine, type ChatMsg, type EngineRequest, type ShowScript } from "@sr/engine";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MALAKOR_NAME, MALAKOR_PERSONA, malakorShow } from "./malakor";
import { BEAT_MS, createShow, createShowClock, VISITOR_NAME, VOICE_ATTEMPTS, type PlayResult, type ShowDeps } from "./show";

interface Rig {
  engine: EngineRequest[];
  voice: string[];
  played: string[];
}

interface Options {
  show?: ShowScript;
  voiceStatus?: number;
  play?: () => PlayResult | Promise<PlayResult>;
  now?: () => number;
  engineFails?: number;
}

/** The audio of every line lasts this long in the fake player. */
const LINE_MS = 12_000;

function setup(options: Options = {}) {
  const show = options.show ?? malakorShow();
  const engine = new ScriptedEngine(show);
  const seen: Rig = { engine: [], voice: [], played: [] };
  let engineFails = options.engineFails ?? 0;
  const fetch: ShowDeps["fetch"] = async (url, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    if (url === "/api/engine/reply") {
      const req = body as EngineRequest;
      seen.engine.push(req);
      if (engineFails > 0) {
        engineFails -= 1;
        return Response.json({ error: { code: "upstream", message: "x" } }, { status: 502 });
      }
      return Response.json(await engine.reply(req));
    }
    seen.voice.push(String((body as { text: string }).text));
    const status = options.voiceStatus ?? 200;
    return status === 200 ? new Response(new Blob(["RIFF"], { type: "audio/wav" })) : new Response("no", { status });
  };
  const deps: ShowDeps = {
    show,
    persona: MALAKOR_PERSONA,
    self: MALAKOR_NAME,
    fetch,
    now: options.now ?? (() => Date.now()),
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    player: {
      play: (url) => {
        seen.played.push(url);
        if (options.play) return Promise.resolve(options.play());
        return new Promise((resolve) => setTimeout(() => resolve("ended"), LINE_MS));
      },
      stop: () => undefined,
    },
    objectUrl: () => `blob:${seen.played.length}`,
    revokeUrl: () => undefined,
  };
  return { show: createShow(deps), seen };
}

/**
 * Lets the loop's awaited responses settle without moving the clock. (A zero-delay timer set
 * while fake timers are ticking is due 1 ms later, so a test that crosses an audio end moves 1 ms.)
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0);
}

/** Runs the show for `ms` in small steps, letting responses settle at each. */
async function play(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 250) {
    await vi.advanceTimersByTimeAsync(Math.min(250, ms - t));
    await flush();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createShowClock", () => {
  it("hands out strictly increasing stamps whatever the underlying clock does", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constant(0), fc.double({ min: -50, max: 50, noNaN: true })), { maxLength: 60 }), (steps) => {
        let t = 1000;
        const clock = createShowClock(() => t);
        let last = Number.NEGATIVE_INFINITY;
        for (const step of steps) {
          t += step;
          const stamp = clock.stamp();
          expect(stamp).toBeGreaterThan(last);
          expect(Number.isInteger(stamp)).toBe(true);
          expect(clock.read()).toBeGreaterThanOrEqual(stamp);
          last = stamp;
        }
      }),
    );
  });
});

describe("the beat loop", () => {
  it("starts on air, posts the audience on the show clock, and stamps every message uniquely", async () => {
    const { show } = setup();
    show.start();
    expect(show.snapshot().status).toBe("on_air");
    await vi.advanceTimersByTimeAsync(60_000);
    const chat = show.snapshot().chat;
    const audience = chat.filter((m) => m.fictional);
    expect(audience.length).toBeGreaterThan(10);
    expect(new Set(chat.map((m) => m.ts)).size).toBe(chat.length);
    expect(chat.map((m) => m.ts)).toEqual([...chat.map((m) => m.ts)].sort((a, b) => a - b));
    show.stop();
  });

  it("asks for one reply per beat, speaks it, and advances when the audio ends", async () => {
    const { show, seen } = setup();
    show.start();
    await flush();
    expect(seen.engine).toHaveLength(1);
    expect(seen.engine[0]?.beat).toBe(0);
    expect(seen.voice).toEqual([show.snapshot().caption?.line]);
    expect(show.snapshot()).toMatchObject({ status: "speaking", caption: { voiced: true, beat: 0 } });
    expect(show.snapshot().chat.at(-1)).toMatchObject({ user: MALAKOR_NAME, text: show.snapshot().caption?.line });
    await vi.advanceTimersByTimeAsync(LINE_MS - 1);
    expect(seen.engine).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    await flush();
    expect(seen.engine).toHaveLength(2); // the audio ended: the next beat, not 9 s later
    expect(seen.engine[1]?.beat).toBe(1);
    show.stop();
  });

  it("never picks the character's own replies (ctx.self is the name replies are posted under)", async () => {
    const { show, seen } = setup();
    show.start();
    await play(LINE_MS * 12);
    const own = new Set(show.snapshot().chat.filter((m) => m.user === MALAKOR_NAME).map((m) => m.id));
    expect(own.size).toBeGreaterThan(3);
    for (const req of seen.engine) if (req.pickedId !== undefined) expect(own.has(req.pickedId)).toBe(false);
    show.stop();
  });

  it("with an empty audience, delivers segment lines and never answers itself", async () => {
    const { show, seen } = setup({ show: { ...malakorShow(), audience: [] } });
    show.start();
    await play(LINE_MS * 4);
    expect(show.snapshot().chat.filter((m) => m.user === MALAKOR_NAME).length).toBeGreaterThan(2);
    expect(seen.engine.length).toBeGreaterThan(2);
    expect(seen.engine.every((req) => req.pickedId === undefined)).toBe(true);
    show.stop();
  });

  it("answers a visitor typed in the same millisecond as a pick on the next beat", async () => {
    // A frozen clock: every pick and every message happens in one millisecond.
    const one: ChatMsg = { id: "a01", user: "GraveMoth", text: "first!", ts: 0, fictional: true };
    const base = malakorShow();
    const { show, seen } = setup({ show: { ...base, audience: [one] }, now: () => 5 });
    show.start();
    await flush();
    expect(seen.engine[0]?.pickedId).toBe("a01"); // the audience message, picked at t = 0
    expect(show.post("  is the orb heavy?  ")).toBe(true); // typed in that same millisecond
    const visitor = show.snapshot().chat.find((m) => m.fromVisitor);
    expect(visitor).toMatchObject({ user: VISITOR_NAME, text: "is the orb heavy?" });
    await vi.advanceTimersByTimeAsync(LINE_MS + 1);
    await flush();
    expect(seen.engine[1]?.pickedId).toBe(visitor?.id);
    await flush();
    expect(show.snapshot().caption?.answered?.id).toBe(visitor?.id); // the replay engine answers visitors
    show.stop();
  });

  it("ignores an empty visitor message and cuts a long one to 300 characters", () => {
    const { show } = setup();
    expect(show.post("   ")).toBe(false);
    expect(show.post("x".repeat(500))).toBe(true);
    expect(show.snapshot().chat.at(-1)?.text).toHaveLength(300);
  });
});

describe("when the voice fails", () => {
  it("retries once, then shows the line as a caption with the mouth closed, and holds a default beat", async () => {
    const { show, seen } = setup({ voiceStatus: 500 });
    show.start();
    await flush();
    expect(seen.voice).toHaveLength(VOICE_ATTEMPTS);
    expect(VOICE_ATTEMPTS).toBe(2);
    expect(seen.played).toEqual([]);
    expect(show.snapshot()).toMatchObject({ status: "speaking", caption: { voiced: false } });
    await vi.advanceTimersByTimeAsync(BEAT_MS - 1);
    expect(seen.engine).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(seen.engine).toHaveLength(2);
    expect(seen.voice).toHaveLength(2 * VOICE_ATTEMPTS);
    show.stop();
  });

  it("plays nothing while the browser blocks sound, and plays again after soundOn", async () => {
    let result: PlayResult = "blocked";
    const { show, seen } = setup({ play: () => result });
    show.start();
    await flush();
    expect(show.snapshot()).toMatchObject({ sound: "blocked", caption: { voiced: false } });
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(seen.played).toHaveLength(1); // the second line was not even tried
    result = "ended";
    show.soundOn();
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(seen.played.length).toBeGreaterThan(1);
    expect(show.snapshot().sound).toBe("on");
    show.stop();
  });
});

describe("when the engine fails", () => {
  it("skips the beat and asks again one beat later", async () => {
    const { show, seen } = setup({ engineFails: 1 });
    show.start();
    await flush();
    expect(seen.engine).toHaveLength(1);
    expect(seen.voice).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    await flush();
    expect(seen.engine).toHaveLength(2);
    expect(seen.voice).toHaveLength(1);
    show.stop();
  });
});
