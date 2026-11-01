// Test kit for the show controller (show.test.ts, stage.test.ts): fake fetch (the replay engine
// answers from the recorded show, the voice is a blob or an error), fake health, fake player, on
// vitest's fake timers. Test-only: never imported by app code, so never bundled.
import { ScriptedEngine, type EngineRequest, type ShowScript } from "@sr/engine";
import { vi } from "vitest";
import { MALAKOR_NAME, MALAKOR_PERSONA, malakorShow } from "./malakor";
import { createShow, type PlayResult, type ShowDeps } from "./show";

export interface Seen {
  engine: EngineRequest[];
  voice: string[];
  played: string[];
}

export interface Options {
  show?: ShowScript;
  voiceStatus?: number;
  play?: () => PlayResult | Promise<PlayResult>;
  now?: () => number;
  engineFails?: number;
  /** /api/health answers, in order; the last one repeats. Default: always healthy. */
  health?: boolean[];
}

/** The audio of every line lasts this long in the fake player. */
export const LINE_MS = 12_000;

export function setup(options: Options = {}) {
  const show = options.show ?? malakorShow();
  const engine = new ScriptedEngine(show);
  const seen: Seen = { engine: [], voice: [], played: [] };
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
  const health = [...(options.health ?? [true])];
  const healthCalls: number[] = [];
  const deps: ShowDeps = {
    show,
    health: () => {
      healthCalls.push(Date.now());
      return Promise.resolve(health.length > 1 ? (health.shift() ?? true) : (health[0] ?? true));
    },
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
  return { show: createShow(deps), seen, healthCalls };
}

/**
 * Lets the loop's awaited responses settle without moving the clock. (A zero-delay timer set
 * while fake timers are ticking is due 1 ms later, so a test that crosses an audio end moves 1 ms.)
 */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0);
}

/** Runs the show for `ms` in small steps, letting responses settle at each. */
export async function play(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 250) {
    await vi.advanceTimersByTimeAsync(Math.min(250, ms - t));
    await flush();
  }
}

