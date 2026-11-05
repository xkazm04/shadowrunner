// `measure <file> [--roi x,y,w,h] [--run <runId>]`: renderer-agnostic numbers from a recorded file
// alone (run.webm, run.flv, run.mp4, an external pipeline's capture). Merges fpsP50 / fpsP5 /
// droppedFrames (from video packet timestamps) and avOffsetMs (mouth motion vs audio envelope
// change, sync.ts) into the run's metrics.json, and writes measure.json beside it with the
// confidence, the ROI and the page meter's values it replaced. measure-roi.png shows the ROI on the
// frame with the most mouth motion, so the automatic ROI can be checked by eye.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Metrics } from "../contract.js";
import { isFiniteNumber, isRecord, readJsonFile } from "../director/json.js";
import { runDir, runsRoot } from "../director/paths.js";
import { loadScenario } from "../director/scenario.js";
import { decodeAudio, FFMPEG, frameStats, probeVideo, roiMotion, type Roi } from "./probe.js";
import { castRoi, parseRoi } from "./roi.js";
import { readRunConfig } from "./runConfig.js";
import { findOffset, type SyncResult } from "./sync.js";

export interface MeasureReport {
  file: string;
  roi: Roi;
  roiSource: string;
  frameMs?: number;
  sync?: SyncResult;
  /** Why avOffsetMs is absent, when it is. */
  syncError?: string;
  /** metrics.json values measure replaced (the page's frame meter), kept for comparison. */
  replaced: Partial<Pick<Metrics, "fpsP50" | "fpsP5" | "droppedFrames" | "avOffsetMs">>;
}

export interface MeasureArgs {
  file: string;
  roi?: Roi;
  runId?: string;
}

export function parseMeasureArgs(argv: readonly string[]): MeasureArgs {
  const args = argv.filter((a) => a !== "--");
  let file: string | undefined;
  let roi: Roi | undefined;
  let runId: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "--roi" || a === "--run") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value.`);
      if (a === "--roi") roi = parseRoi(v);
      else runId = v;
      i += 1;
    } else if (a.startsWith("--")) throw new Error(`Unknown flag "${a}" for measure.`);
    else file = a;
  }
  if (file === undefined) throw new Error("measure needs a recording: measure <file> [--roi x,y,w,h] [--run <runId>].");
  return { file, ...(roi === undefined ? {} : { roi }), ...(runId === undefined ? {} : { runId }) };
}

/** The run a file belongs to: --run, else its folder when that folder is a run under the runs root. */
function runOf(file: string, runId: string | undefined): string | undefined {
  if (runId !== undefined) return runId;
  const dir = dirname(resolve(file));
  return resolve(dirname(dir)) === resolve(runsRoot()) && existsSync(join(dir, "config.json")) ? basename(dir) : undefined;
}

async function autoRoi(runId: string | undefined, width: number, height: number): Promise<{ roi: Roi; source: string }> {
  if (runId === undefined) throw new Error("No --roi and the file is not in a run folder, so the mouth ROI is unknown; pass --roi x,y,w,h or --run <runId>.");
  const config = readRunConfig(runDir(runId));
  if (config.external !== undefined) throw new Error(`Run ${runId} is an external (${config.external}) run with no lab pack; pass --roi x,y,w,h.`);
  const character = config.character ?? loadScenario(config.scenario).character;
  return { roi: castRoi(character, width, height), source: `rig:${character}` };
}

/** Writes the ROI box onto the frame at `t` seconds. Best effort: a failure only logs. */
function roiPreview(file: string, roi: Roi, t: number, out: string, log: (l: string) => void): void {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `drawbox=x=${roi.x}:y=${roi.y}:w=${roi.w}:h=${roi.h}:color=red:t=4`, out], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  if (r.status !== 0) log(`measure: could not write ${out}.`);
}

export async function measureFile(args: MeasureArgs, log: (line: string) => void): Promise<{ metrics?: Metrics; report: MeasureReport }> {
  if (!existsSync(args.file)) throw new Error(`${args.file} does not exist.`);
  const runId = runOf(args.file, args.runId);
  const video = probeVideo(args.file);
  const { roi, source } = args.roi === undefined ? await autoRoi(runId, video.width, video.height) : { roi: args.roi, source: "explicit" };
  if (roi.x + roi.w > video.width || roi.y + roi.h > video.height) throw new Error(`ROI ${roi.x},${roi.y},${roi.w},${roi.h} is outside the ${video.width}x${video.height} video.`);
  const stats = frameStats(video.times);
  const report: MeasureReport = { file: args.file, roi, roiSource: source, ...(stats === undefined ? {} : { frameMs: stats.frameMs }), replaced: {} };
  let peakT: number | undefined;
  if (video.hasAudio) {
    try {
      const motion = await roiMotion(args.file, roi);
      report.sync = findOffset(motion, decodeAudio(args.file));
      const peak = motion.energy.reduce((best, e, i) => (e > (motion.energy[best] ?? 0) ? i : best), 0);
      peakT = motion.times[peak];
    } catch (error) {
      report.syncError = error instanceof Error ? error.message : String(error);
    }
  } else report.syncError = "the recording has no audio stream";

  const outDir = runId === undefined ? dirname(resolve(args.file)) : runDir(runId);
  if (peakT !== undefined) roiPreview(args.file, roi, peakT, join(outDir, "measure-roi.png"), log);
  let metrics: Metrics | undefined;
  const metricsPath = join(outDir, "metrics.json");
  if (runId !== undefined) {
    const existing: unknown = existsSync(metricsPath) ? readJsonFile(metricsPath) : undefined;
    const config = readRunConfig(outDir);
    const durationS = Math.round(((video.times.at(-1) ?? 0) - (video.times[0] ?? 0)) * 10) / 10;
    // An existing metrics.json keeps every key it has; measure only overwrites its own four.
    const base: Metrics = isRecord(existing)
      ? { ...existing, runId, config, durationS: isFiniteNumber(existing.durationS) ? existing.durationS : durationS }
      : { runId, config, durationS };
    for (const key of ["fpsP50", "fpsP5", "droppedFrames", "avOffsetMs"] as const) if (base[key] !== undefined) report.replaced[key] = base[key];
    metrics = {
      ...base,
      ...(stats === undefined ? {} : { fpsP50: stats.fpsP50, fpsP5: stats.fpsP5, droppedFrames: stats.droppedFrames }),
      ...(report.sync === undefined ? {} : { avOffsetMs: report.sync.avOffsetMs }),
    };
    if (report.sync === undefined) delete metrics.avOffsetMs;
    writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  }
  writeFileSync(join(outDir, runId === undefined ? `${basename(args.file)}.measure.json` : "measure.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { ...(metrics === undefined ? {} : { metrics }), report };
}

export async function measureCommand(argv: readonly string[], log: (line: string) => void): Promise<void> {
  const { metrics, report } = await measureFile(parseMeasureArgs(argv), log);
  const s = report.sync;
  log(`measure ${report.file}: ROI ${report.roi.x},${report.roi.y},${report.roi.w},${report.roi.h} (${report.roiSource})`);
  log(s === undefined ? `avOffsetMs: not measured (${report.syncError ?? "unknown"})` : `avOffsetMs ${s.avOffsetMs} (r ${s.peakR}, runner-up ${s.runnerUpR}, z ${s.z}, ${s.confidence}; ${s.frames} frames)`);
  process.stdout.write(`${JSON.stringify(metrics ?? report, null, 2)}\n`);
}
