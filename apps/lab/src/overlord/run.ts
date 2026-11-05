// `overlord --toml <shadowrunr.toml> [--seconds 125] [--seed 1031] [--headed] [--port 7717]
// [--stage-port 5178] [--repo <overlord>]`: the Overlord baseline arm. Starts Overlord's daemon
// (scripted engine) and stage, opens a 5-minute sandbox session, captures the stage with O1's path
// (tab capture -> MediaRecorder chunks -> ffmpeg -> local RTMP -> run.flv) for `seconds`, stops the
// session, and writes a normal run folder var/lab/runs/<runId>/: config.json (external "overlord"
// and why the input differs), run.flv, o1.json, timeline.jsonl (from Overlord's transcript),
// overlord/ (the session's transcript and voice log). `measure run.flv --roi ...` runs on it as on
// any run. Overlord cannot be fed haunt-01's chat (no injection seam: docs/lab.md runbook).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STOP_EXPRESSION } from "../director/output/o1/capture.js";
import { FFMPEG, hasFfmpeg, pickEncoder, PUBLISH_DEFAULTS } from "../director/output/o1/ffmpeg.js";
import { joinSegments } from "../director/output/o1/join.js";
import { RtmpPipeline } from "../director/output/o1/pipeline.js";
import { isRecord } from "../director/json.js";
import { runDir } from "../director/paths.js";
import { openCapturedStage } from "./capture.js";
import { DEFAULT_REPO, rpc, startOverlord } from "./procs.js";
import { transcriptToTimeline } from "./transcript.js";

export const SANDBOX_MINUTES = 5;
/** haunt-01's length as the lab plays it (last line spoken + tail, from its recorded runs). */
export const HAUNT_01_SECONDS = 125;

export interface OverlordArgs {
  toml: string;
  repo: string;
  seconds: number;
  seed: number;
  headless: boolean;
  port: number;
  stagePort: number;
}

export function parseOverlordArgs(argv: readonly string[]): OverlordArgs {
  const args = argv.filter((a) => a !== "--");
  const value = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    if (at < 0) return undefined;
    const v = args[at + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  const num = (flag: string, fallback: number): number => {
    const v = value(flag);
    const n = v === undefined ? fallback : Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a whole number above 0.`);
    return n;
  };
  const toml = value("--toml");
  if (toml === undefined) throw new Error("overlord needs --toml <shadowrunr.toml> (runs/data outside the Overlord repo; docs/lab.md runbook).");
  const seconds = num("--seconds", HAUNT_01_SECONDS);
  if (seconds > SANDBOX_MINUTES * 60 - 10) throw new Error(`--seconds must fit the ${SANDBOX_MINUTES}-minute sandbox session.`);
  return { toml, repo: value("--repo") ?? DEFAULT_REPO, seconds, seed: num("--seed", 1031), headless: !args.includes("--headed"), port: num("--port", 7717), stagePort: num("--stage-port", 5178) };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export async function overlordCommand(argv: readonly string[], log: (line: string) => void): Promise<void> {
  const a = parseOverlordArgs(argv);
  if (!hasFfmpeg()) throw new Error("overlord needs ffmpeg on PATH (or SR_LAB_FFMPEG).");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const runId = `${stamp}-haunt-01-overlord-s${a.seed}`;
  const dir = runDir(runId);
  mkdirSync(join(dir, "overlord"), { recursive: true });
  const procs = await startOverlord({ repo: a.repo, toml: a.toml, port: a.port, stagePort: a.stagePort, log });
  const settings = { encoder: pickEncoder(), ...PUBLISH_DEFAULTS };
  const marks: { atS: number; name: string }[] = [];
  const t0 = performance.now();
  const pipeline = new RtmpPipeline({ ffmpeg: FFMPEG, settings, dir, log, mark: (name) => marks.push({ atS: Math.round(performance.now() - t0) / 1000, name }) });
  let sessionId: string | undefined;
  let sessionDir: string | undefined;
  try {
    const started = await rpc(a.port, "sandbox.start", { minutes: SANDBOX_MINUTES, seed: a.seed, judge: false });
    const sessionWall = performance.now();
    sessionId = String(field(started, "session_id"));
    sessionDir = String(field(started, "dir"));
    log(`overlord: sandbox ${sessionId} (scripted engine, simulated room, seed ${a.seed})`);
    await pipeline.open();
    let chunks = 0;
    let recordWall: number | undefined;
    const ws = a.port === 7717 ? "" : `&ws=${encodeURIComponent(`ws://127.0.0.1:${a.port}/events`)}`;
    const url = `http://localhost:${a.stagePort}/?run=live&broadcast=1&voice=1${ws}`;
    const stage = await openCapturedStage(url, a.headless, (_seq, chunk) => {
      recordWall ??= performance.now();
      chunks += 1;
      pipeline.write(chunk);
    }, log);
    try {
      await delay(3000);
      log(`overlord: tab capture ${await stage.startCapture()}`);
      await delay(a.seconds * 1000);
      await stage.page.evaluate(STOP_EXPRESSION);
    } finally {
      await stage.browser.close();
    }
    const segments = await pipeline.close();
    joinSegments(segments, join(dir, "run.flv"), FFMPEG);
    await rpc(a.port, "sandbox.stop", { session_id: sessionId }).catch((e: unknown) => log(`overlord: sandbox.stop: ${e instanceof Error ? e.message : String(e)}`));
    await delay(2000);
    const offsetMs = Math.round((recordWall ?? sessionWall) - sessionWall);
    for (const f of ["transcript.jsonl", "voice.jsonl", "spec.json", "room.json"]) {
      if (existsSync(join(sessionDir, f))) copyFileSync(join(sessionDir, f), join(dir, "overlord", f));
    }
    const transcript = join(sessionDir, "transcript.jsonl");
    const events = existsSync(transcript) ? transcriptToTimeline(readFileSync(transcript, "utf8"), offsetMs) : [];
    writeFileSync(join(dir, "timeline.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
    writeFileSync(join(dir, "config.json"), `${JSON.stringify({
      external: "overlord",
      scenario: "haunt-01",
      seed: a.seed,
      inputDiffers: true,
      note: `INPUT DIFFERS: Overlord has no seam to inject haunt-01's chat (sandbox chat comes only from its simulated room; Twitch feeds only the moderator; no RPC op). This is a ${SANDBOX_MINUTES}-minute scripted sandbox session (seed ${a.seed}, scripted engine = placeholder lines, Malakor's Kokoro voice) recorded for haunt-01's length (${a.seconds} s).`,
      overlord: { sessionId, engine: "scripted", minutes: SANDBOX_MINUTES, capture: "tab capture (getDisplayMedia, current tab) + tab audio", recordStartAfterSessionMs: offsetMs },
    }, null, 2)}\n`);
    writeFileSync(join(dir, "o1.json"), `${JSON.stringify({ encoder: settings.encoder, settings, reconnects: pipeline.reconnects, chunks, segments: segments.map((s) => ({ file: s.file.slice(dir.length + 1), startMs: s.startMs })), marks }, null, 2)}\n`);
    log(`overlord run ${runId}: ${dir}`);
    log(`measure it: node --import ./apps/lab/src/hooks.mjs apps/lab/src/measure/main.ts ${join(dir, "run.flv")} --roi x,y,w,h`);
  } finally {
    procs.stop();
  }
}
