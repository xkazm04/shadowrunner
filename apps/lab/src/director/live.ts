// A live run: the scenario's chat arrives on the scaled clock; each message is one control-arm
// turn (queued behind the previous one); every `say` is voiced by Kokoro and emitted as say, pcm,
// audio and viseme events. Audio lands in audio/<utteranceId>.wav.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { castVoice, type VoiceId } from "@sr/engine";
import type { ControlArm, RunConfig, Scenario } from "../contract.js";
import type { ControlFixture } from "./arms/control/fixture.js";
import type { ControlUsage } from "./arms/control/index.js";
import type { LlmTransport } from "./llm/index.js";
import { newRunId, runOnStage, type RunDeps, type RunResult } from "./run.js";
import { playMark, type Session } from "./session.js";
import type { VoiceSynth } from "./voice/kokoro.js";
import { encodeWav, pcmDurationMs } from "./voice/wav.js";

export interface LiveOptions {
  config: RunConfig;
  scenario: Scenario;
  llm: LlmTransport;
  apiKey?: string;
  fixture?: ControlFixture;
  model?: string;
  /** How the control arm reaches its model, recorded as a `wire:` mark (e.g. "cli claude-haiku-5-5"). */
  wire: string;
  /** Multiplies every chat `atMs` (0.5 plays twice as fast). */
  timeScale: number;
  headless: boolean;
  debug: boolean;
}

/** Characters' voice ids: the cast map, or "crypt" (as scripts/build-packs.mjs does). */
export function voiceOf(character: string): VoiceId {
  return castVoice(character) ?? "crypt";
}

async function playTurn(
  session: Session,
  dir: string,
  arm: ControlArm,
  voice: VoiceSynth,
  input: { turn: number; scenario: Scenario; chat: Scenario["chat"][number]; history: string[]; voiceId: VoiceId; used: Set<string> },
): Promise<void> {
  session.emit({ kind: "mark", name: playMark(input.turn) });
  for await (const event of arm.turn({ scenario: input.scenario, chat: input.chat, history: input.history })) {
    if (event.kind !== "say") {
      session.emit(event);
      continue;
    }
    // The id names audio/<id>.wav, so it is made file-safe and unique within the run.
    const base = event.id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "say";
    let id = base;
    for (let n = 2; input.used.has(id); n += 1) id = `${base}-${n}`;
    input.used.add(id);
    session.emit({ kind: "say", id, text: event.text });
    input.history.push(event.text);
    const spoken = await voice.speak(id, event.text, input.voiceId);
    const pcmRef = `audio/${id}.wav`;
    writeFileSync(join(dir, pcmRef), encodeWav(spoken.pcm, spoken.sampleRate));
    session.audio(id, spoken.sampleRate, spoken.pcm, pcmRef, pcmDurationMs(spoken.pcm, spoken.sampleRate));
    for (const v of spoken.visemes) session.emit({ kind: "viseme", id, v: v.v, startMs: v.startMs, endMs: v.endMs });
  }
}

export async function runLive(options: LiveOptions, deps: RunDeps): Promise<RunResult> {
  const { config, scenario } = options;
  const character = config.character ?? scenario.character;
  const voiceId = voiceOf(character);
  // Built before anything opens, so an unbuilt arm fails with its sentence and nothing to clean up.
  const arm = deps.createControl(config.control, {
    llm: options.llm,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.fixture === undefined ? {} : { fixture: options.fixture }),
    ...(options.model === undefined ? {} : { model: options.model }),
    voice: voiceId,
    seed: config.seed,
    log: deps.log,
  });
  const voice = await deps.startVoice(deps.log);
  try {
    const runId = newRunId(config);
    return await runOnStage({ runId, config, character, headless: options.headless, debug: options.debug }, deps, async (session, dir) => {
      session.emit({ kind: "mark", name: `wire:${options.wire}` });
      const history: string[] = [];
      const used = new Set<string>();
      let chain: Promise<void> = Promise.resolve();
      for (const [i, chat] of scenario.chat.entries()) {
        await session.clock.sleep(chat.atMs * options.timeScale - session.clock.now());
        session.emit({ kind: "turn", turn: i + 1, chat });
        chain = chain.then(() =>
          playTurn(session, dir, arm, voice, { turn: i + 1, scenario, chat, history, voiceId, used }).catch((error: unknown) => {
            const why = error instanceof Error ? error.message : String(error);
            deps.log(`turn ${i + 1} (${chat.id}) failed: ${why}`);
            session.emit({ kind: "mark", name: `turn-failed:${chat.id}` });
          }),
        );
      }
      await chain;
      const usage: ControlUsage = arm.usage();
      return usage;
    });
  } finally {
    await voice.close();
  }
}
