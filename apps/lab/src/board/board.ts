// `board --pairs <runA>:<runB>,... [--clip 20] [--seed n]`: a blind verdict board. For each pair it
// cuts both recordings at the same scenario moment (a chat message both runs answered, from the
// `turn` events of their timeline.jsonl) into H.264 MP4 clips (<= 20 s, <= 5 MB, metadata stripped)
// named only x / y in a seeded-random order, and writes var/lab/board/<boardId>/manifest.json
// { boardId, pairs: [{ pairId, axis, clips: { x, y }, hidden: { x: runId, y: runId }, moment }] }.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunConfig } from "../contract.js";
import { runDir, VAR_LAB } from "../director/paths.js";
import { readTimeline } from "../director/timeline.js";
import { readRunConfig } from "../measure/runConfig.js";

export const FFMPEG = process.env.SR_LAB_FFMPEG ?? "ffmpeg";
export const FFPROBE = process.env.SR_LAB_FFPROBE ?? "ffprobe";
export const MAX_CLIP_S = 20;
export const MAX_CLIP_BYTES = 5 * 1024 * 1024;
const RECORDINGS = ["run.webm", "run.flv", "run.mp4"];
/** Video kb/s per attempt; the next is used when a clip comes out over 5 MB. */
const RATES = [1600, 1100, 700];

export interface BoardPair {
  pairId: string;
  axis: string;
  clips: { x: string; y: string };
  hidden: { x: string; y: string };
  /** Where both clips start: the chat message both runs answered, and the cut. */
  /** `by: "chat"`: both answered chat `chatId`; `by: "first-line"`: no shared chat (an external run), cut at each run's first spoken line. */
  moment: { by: "chat" | "first-line"; chatId?: string; startS: { x: number; y: number }; clipS: number };
}

export interface BoardManifest {
  boardId: string;
  pairs: BoardPair[];
}

export interface BoardArgs {
  pairs: [string, string][];
  clipS: number;
  seed?: number;
}

export function parseBoardArgs(argv: readonly string[]): BoardArgs {
  const args = argv.filter((a) => a !== "--");
  const value = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    if (at < 0) return undefined;
    const v = args[at + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  const pairsText = value("--pairs");
  if (pairsText === undefined) throw new Error("board needs --pairs <runA>:<runB>[,<runC>:<runD>...].");
  const pairs = pairsText.split(",").map((p): [string, string] => {
    const [a, b, ...rest] = p.split(":");
    if (a === undefined || b === undefined || a === "" || b === "" || rest.length > 0) throw new Error(`"${p}" is not a pair <runA>:<runB>.`);
    if (a === b) throw new Error(`Pair "${p}" compares a run with itself.`);
    return [a, b];
  });
  const clipText = value("--clip");
  const clipS = clipText === undefined ? MAX_CLIP_S : Number(clipText);
  if (!Number.isFinite(clipS) || clipS < 2 || clipS > MAX_CLIP_S) throw new Error(`--clip must be 2..${MAX_CLIP_S} seconds.`);
  const seedText = value("--seed");
  const seed = seedText === undefined ? undefined : Number(seedText);
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error("--seed must be a whole number.");
  return { pairs, clipS, ...(seed === undefined ? {} : { seed }) };
}

/** Deterministic 0..1 from a string (sha256), for seeded order and moment choice. */
export function unit(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32BE(0) / 2 ** 32;
}

/** The arm keys on which two configs differ ("lip", "control+scene", "external", or "same"). */
export function axisOf(a: RunConfig, b: RunConfig): string {
  if ((a.external ?? "") !== (b.external ?? "")) return "external";
  const keys = (["control", "lip", "scene", "output"] as const).filter((k) => a[k] !== b[k]);
  return keys.length === 0 ? "same" : keys.join("+");
}

interface RunInfo {
  runId: string;
  config: RunConfig;
  file: string;
  durationS: number;
  /** chat id -> seconds into the run when its turn arrived. */
  turns: Map<string, number>;
  /** Seconds into the run of the first spoken line (first audio, else first say). */
  firstLine?: number;
}

function loadRun(runId: string): RunInfo {
  const dir = runDir(runId);
  const name = RECORDINGS.find((f) => existsSync(join(dir, f)));
  if (name === undefined) throw new Error(`Run ${runId} has no recording (${RECORDINGS.join(", ")}) in ${dir}.`);
  const file = join(dir, name);
  const probe = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const times = probe.stdout.split(/\r?\n/).map(Number.parseFloat).filter(Number.isFinite);
  const turns = new Map<string, number>();
  let audio: number | undefined;
  let say: number | undefined;
  if (existsSync(join(dir, "timeline.jsonl"))) {
    for (const e of readTimeline(join(dir, "timeline.jsonl"))) {
      if (e.kind === "turn" && !turns.has(e.chat.id)) turns.set(e.chat.id, e.t / 1000);
      if (e.kind === "audio") audio ??= e.t / 1000;
      if (e.kind === "say") say ??= e.t / 1000;
    }
  }
  const firstLine = audio ?? say;
  return { runId, config: readRunConfig(dir), file, durationS: Math.max(0, ...times), turns, ...(firstLine === undefined ? {} : { firstLine }) };
}

/** A chat both runs answered with a full clip after it, picked by `seed`; else both runs' first line. */
export function pickMoment(a: Pick<RunInfo, "turns" | "durationS" | "firstLine">, b: Pick<RunInfo, "turns" | "durationS" | "firstLine">, clipS: number, seed: string): { by: "chat" | "first-line"; chatId?: string; startA: number; startB: number } {
  const shared = [...a.turns.keys()].filter((id) => {
    const ta = a.turns.get(id);
    const tb = b.turns.get(id);
    return ta !== undefined && tb !== undefined && ta + clipS <= a.durationS && tb + clipS <= b.durationS;
  });
  if (shared.length === 0) {
    const fa = a.firstLine;
    const fb = b.firstLine;
    if (fa !== undefined && fb !== undefined && fa + clipS <= a.durationS && fb + clipS <= b.durationS) return { by: "first-line", startA: fa, startB: fb };
    throw new Error(`The two runs share no chat message, or first spoken line, with ${clipS} s of recording after it in both.`);
  }
  const chatId = shared[Math.floor(unit(seed) * shared.length)] ?? shared[0] ?? "";
  return { by: "chat", chatId, startA: a.turns.get(chatId) ?? 0, startB: b.turns.get(chatId) ?? 0 };
}

/** One anonymised clip; retries at lower rates until it fits MAX_CLIP_BYTES. */
export function cutClip(file: string, startS: number, clipS: number, out: string): void {
  for (const kbps of RATES) {
    const r = spawnSync(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", startS.toFixed(3), "-i", file, "-t", clipS.toFixed(3),
      "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1",
      "-vf", "scale=1280:-2", "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-f", "mp4", out,
    ], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    if (r.status !== 0) throw new Error(`Cutting ${file} at ${startS} s failed: ${r.stderr.trim().split(/\r?\n/).slice(-2).join(" | ")}`);
    if (statSync(out).size <= MAX_CLIP_BYTES) return;
  }
  throw new Error(`${out} stays over ${MAX_CLIP_BYTES} bytes even at ${RATES.at(-1)} kb/s.`);
}

export function buildBoard(args: BoardArgs, log: (line: string) => void, now = new Date()): { dir: string; manifest: BoardManifest } {
  const seed = args.seed ?? Math.floor(unit(args.pairs.map((p) => p.join(":")).join(",")) * 1e9);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const boardId = `${stamp}-${createHash("sha256").update(`${seed}|${JSON.stringify(args.pairs)}`).digest("hex").slice(0, 6)}`;
  const dir = join(VAR_LAB, "board", boardId);
  mkdirSync(dir, { recursive: true });
  const pairs: BoardPair[] = args.pairs.map(([idA, idB], i) => {
    const pairId = `p${i + 1}`;
    const a = loadRun(idA);
    const b = loadRun(idB);
    const m = pickMoment(a, b, args.clipS, `${seed}:${pairId}:moment`);
    const swap = unit(`${seed}:${pairId}:order`) < 0.5;
    const [x, y] = swap ? [b, a] : [a, b];
    const startX = swap ? m.startB : m.startA;
    const startY = swap ? m.startA : m.startB;
    const clips = { x: `${pairId}-x.mp4`, y: `${pairId}-y.mp4` };
    cutClip(x.file, startX, args.clipS, join(dir, clips.x));
    cutClip(y.file, startY, args.clipS, join(dir, clips.y));
    log(`board ${pairId}: ${axisOf(a.config, b.config)} at ${m.by === "chat" ? `chat ${m.chatId ?? ""}` : "each run's first line"} (${args.clipS} s)`);
    return { pairId, axis: axisOf(a.config, b.config), clips, hidden: { x: x.runId, y: y.runId }, moment: { by: m.by, ...(m.chatId === undefined ? {} : { chatId: m.chatId }), startS: { x: Math.round(startX * 1000) / 1000, y: Math.round(startY * 1000) / 1000 }, clipS: args.clipS } };
  });
  const manifest: BoardManifest = { boardId, pairs };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest };
}

export async function boardCommand(argv: readonly string[], log: (line: string) => void): Promise<void> {
  const { dir, manifest } = buildBoard(parseBoardArgs(argv), log);
  log(`board ${manifest.boardId}: ${manifest.pairs.length} pair(s) in ${dir}`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
