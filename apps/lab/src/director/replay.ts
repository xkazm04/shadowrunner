// `pnpm lab replay <runId>`: re-render a recorded run from its timeline.jsonl and audio/*.wav with
// zero LLM and zero TTS calls (this module never asks RunDeps for a control arm or a voice). Each
// event is re-emitted at its recorded `t`; audio events send their recorded WAV's PCM first.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RunConfig } from "../contract.js";
import { parseRunConfig } from "./config.js";
import { readJsonFile } from "./json.js";
import { runDir } from "./paths.js";
import { newRunId, runOnStage, type RunDeps, type RunResult } from "./run.js";
import { loadScenario } from "./scenario.js";
import { readTimeline } from "./timeline.js";
import { decodeWav } from "./voice/wav.js";

const PCM_REF = /^audio\/[A-Za-z0-9._-]+\.wav$/;

export interface ReplayOptions {
  sourceRunId: string;
  headless: boolean;
  debug: boolean;
}

/** `deps.createControl` and `deps.startVoice` are never called (replay.test.ts asserts it). */
export async function runReplay(options: ReplayOptions, deps: RunDeps): Promise<RunResult> {
  const source = runDir(options.sourceRunId);
  if (!existsSync(join(source, "timeline.jsonl"))) throw new Error(`Run ${options.sourceRunId} has no timeline.jsonl in ${source}.`);
  const recorded = parseRunConfig(readJsonFile(join(source, "config.json")));
  const events = readTimeline(join(source, "timeline.jsonl"));
  const config: RunConfig = { ...recorded, replayOf: options.sourceRunId };
  const runId = newRunId(config);
  const character = config.character ?? loadScenario(config.scenario).character;
  return runOnStage({ runId, config, character, headless: options.headless, debug: options.debug }, deps, async (session, dir) => {
    for (const event of events) {
      await session.clock.sleep(event.t - session.clock.now());
      if (event.kind === "audio") {
        if (!PCM_REF.test(event.pcmRef)) throw new Error(`${options.sourceRunId}: audio ${event.id} has pcmRef "${event.pcmRef}", not audio/<name>.wav.`);
        const wav = decodeWav(readFileSync(join(source, event.pcmRef)));
        const target = join(dir, event.pcmRef);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(source, event.pcmRef), target);
        session.audio(event.id, wav.sampleRate, wav.pcm, event.pcmRef, event.durationMs);
      } else {
        session.emit(event);
      }
    }
    return undefined;
  });
}
