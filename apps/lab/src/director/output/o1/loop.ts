// `loop <runId> [--times N] [--output O0|O1]`: writes a replay source that plays a recorded run's
// timeline N times back to back (var/lab/runs/<runId>-x<N>-<output>/: config.json, timeline.jsonl,
// audio/), for long output tests with zero LLM and zero TTS: `pnpm lab replay <that id>`.
// Each copy shifts `t` by one period (the last audio's end + a pause), renumbers turns and their
// play marks, and suffixes utterance and chat ids so every copy's audio is distinct on the page.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OutputArmId, RunConfig, TimelineEvent } from "../../../contract.js";
import { parseRunConfig } from "../../config.js";
import { readJsonFile } from "../../json.js";
import { runDir } from "../../paths.js";
import { readTimeline } from "../../timeline.js";

const PAUSE_MS = 3000;
const PLAY = /^play:(\d+)$/;

/** Length of one copy: the latest of every event's `t` and every audio's end, plus a pause. */
export function loopPeriod(events: readonly TimelineEvent[]): number {
  let end = 0;
  for (const e of events) end = Math.max(end, e.t + (e.kind === "audio" ? e.durationMs : 0));
  return end + PAUSE_MS;
}

/** N copies of `events`; copy 0 is unchanged. */
export function loopTimeline(events: readonly TimelineEvent[], times: number): TimelineEvent[] {
  const period = loopPeriod(events);
  const turns = Math.max(0, ...events.map((e) => (e.kind === "turn" ? e.turn : 0)));
  const out: TimelineEvent[] = [];
  for (let k = 0; k < times; k += 1) {
    const dt = k * period;
    const id = (s: string): string => (k === 0 ? s : `${s}~${k}`);
    for (const e of events) {
      const t = e.t + dt;
      switch (e.kind) {
        case "turn":
          out.push({ ...e, t, turn: e.turn + k * turns, chat: { ...e.chat, id: id(e.chat.id), atMs: e.chat.atMs + dt } });
          break;
        case "mark": {
          const play = PLAY.exec(e.name);
          out.push({ ...e, t, name: play?.[1] === undefined ? e.name : `play:${Number(play[1]) + k * turns}` });
          break;
        }
        case "say":
        case "audio":
        case "viseme":
          out.push({ ...e, t, id: id(e.id) });
          break;
        default:
          out.push({ ...e, t });
      }
    }
  }
  return out;
}

export interface LoopOptions {
  runId: string;
  times: number;
  output?: OutputArmId;
}

/** Writes the looped source run; returns its id. */
export function writeLoop({ runId, times, output }: LoopOptions): string {
  const source = runDir(runId);
  if (!existsSync(join(source, "timeline.jsonl"))) throw new Error(`Run ${runId} has no timeline.jsonl in ${source}.`);
  const recorded = parseRunConfig(readJsonFile(join(source, "config.json")));
  const config: RunConfig = { ...recorded, ...(output === undefined ? {} : { output }) };
  delete config.replayOf;
  const id = `${runId}-x${times}-${config.output}`;
  const dir = runDir(id);
  mkdirSync(join(dir, "audio"), { recursive: true });
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  const events = loopTimeline(readTimeline(join(source, "timeline.jsonl")), times);
  writeFileSync(join(dir, "timeline.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  for (const f of readdirSync(join(source, "audio"))) copyFileSync(join(source, "audio", f), join(dir, "audio", f));
  writeFileSync(join(dir, "loop.json"), `${JSON.stringify({ source: runId, times, periodMs: loopPeriod(readTimeline(join(source, "timeline.jsonl"))) }, null, 2)}\n`);
  return id;
}

export async function loopCommand(argv: readonly string[], log: (line: string) => void): Promise<void> {
  const args = argv.filter((a) => a !== "--");
  const runId = args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));
  if (runId === undefined) throw new Error("loop needs a run id: loop <runId> [--times N] [--output O0|O1].");
  const timesAt = args.indexOf("--times");
  const times = timesAt < 0 ? 5 : Number(args[timesAt + 1]);
  if (!Number.isInteger(times) || times < 1 || times > 100) throw new Error("--times must be a whole number from 1 to 100.");
  const outAt = args.indexOf("--output");
  const out = outAt < 0 ? undefined : args[outAt + 1];
  if (out !== undefined && out !== "O0" && out !== "O1") throw new Error("--output must be O0 or O1.");
  const id = writeLoop({ runId, times, ...(out === undefined ? {} : { output: out }) });
  log(`looped replay source: ${runDir(id)}`);
  log(`play it: pnpm lab replay ${id} --headless`);
}
