// Test doubles for RunDeps: a virtual clock, a stage server that plays the page's part, and an
// output arm that writes a stand-in recording. No browser, no model, no TTS.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DirectorMessage, PageMessage } from "../../contract.js";
import type { RunDeps } from "../run.js";
import type { Clock } from "../session.js";
import type { StageServer } from "../stage/server.js";

export function virtualClock(): Clock {
  let t = 0;
  return {
    now: () => t,
    reset: () => {
      t = 0;
    },
    sleep: async (ms) => {
      t += Math.max(0, ms);
    },
  };
}

/** Answers `load` with ready and every audio event with audioStarted (at once, on `clock`). */
export function fakeStage(clock: Clock, sent: DirectorMessage[]): StageServer {
  const listeners: ((m: PageMessage) => void)[] = [];
  const emit = (m: PageMessage): void => {
    for (const l of listeners) l(m);
  };
  return {
    pageUrl: () => "http://stage.invalid/",
    send(message) {
      sent.push(message);
      if (message.type === "load") queueMicrotask(() => emit({ type: "ready", renderBackend: "swiftshader" }));
      if (message.type === "event" && message.event.kind === "audio") {
        const id = message.event.id;
        queueMicrotask(() => emit({ type: "audioStarted", id, atMs: clock.now() }));
        emit({ type: "frameStats", fps: [60, 59, 30], dropped: 1 });
      }
    },
    onMessage: (l) => listeners.push(l),
    awaitUpload: () => new Promise<string>(() => undefined),
    close: async () => undefined,
  };
}

export interface Calls {
  control: number;
  voice: number;
}

/** Deps whose control and voice factories throw and count calls (replay must make none). */
export function fakeDeps(clock: Clock, sent: DirectorMessage[], calls: Calls): RunDeps {
  return {
    prepare: () => undefined,
    openStage: async () => fakeStage(clock, sent),
    launch: () => Promise.reject(new Error("no browser in tests")),
    createOutput: (_id, ctx) => {
      let dir = "";
      return {
        id: "O0",
        start: async ({ runDir }) => {
          dir = runDir;
        },
        stop: async () => {
          const file = join(dir, "run.webm");
          writeFileSync(file, "fake webm");
          void ctx;
          return { file };
        },
      };
    },
    createControl: () => {
      calls.control += 1;
      throw new Error("LLM call attempted");
    },
    startVoice: () => {
      calls.voice += 1;
      return Promise.reject(new Error("TTS call attempted"));
    },
    clock: () => clock,
    log: () => undefined,
  };
}
