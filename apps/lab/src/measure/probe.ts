// What measure reads from a recording, with system ffprobe/ffmpeg only (renderer-agnostic):
// video packet timestamps (frame timing; MediaRecorder WebM has no duration header and may end in a
// truncated Opus packet, so nothing here trusts the header or decodes past an error), the ROI as
// small gray frames with their timestamps, and the audio as mono PCM on the same clock.
import { spawn, spawnSync } from "node:child_process";
import { percentile } from "../director/metrics.js";
import type { AudioTrack, MotionTrack } from "./sync.js";
import { motionEnergy } from "./sync.js";

export const FFMPEG = process.env.SR_LAB_FFMPEG ?? "ffmpeg";
export const FFPROBE = process.env.SR_LAB_FFPROBE ?? "ffprobe";
export const AUDIO_RATE = 16_000;

export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  /** Video packet presentation times, seconds, ascending. */
  times: number[];
  hasAudio: boolean;
}

function run(cmd: string, args: readonly string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.error !== undefined) throw new Error(`${cmd} did not run (${r.error.message}); install ffmpeg on PATH or set SR_LAB_FFMPEG/SR_LAB_FFPROBE.`);
  if (r.status !== 0 && r.stdout.trim() === "") throw new Error(`${cmd} failed: ${r.stderr.trim().split(/\r?\n/).slice(-2).join(" | ")}`);
  return r.stdout;
}

export function probeVideo(file: string): VideoInfo {
  const streams = run(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", file]);
  let width = 0;
  let height = 0;
  let hasAudio = false;
  for (const line of streams.split(/\r?\n/)) {
    const [type, w, h] = line.split(",");
    if (type === "video" && width === 0) {
      width = Number(w);
      height = Number(h);
    }
    if (type === "audio") hasAudio = true;
  }
  if (width === 0) throw new Error(`${file} has no video stream.`);
  const packets = run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file]);
  const times = packets
    .split(/\r?\n/)
    .map((l) => Number.parseFloat(l))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  return { width, height, times, hasAudio };
}

export interface FrameStats {
  fpsP50: number;
  fpsP5: number;
  droppedFrames: number;
  /** The median frame interval, ms (the stream's nominal rate). */
  frameMs: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Per-frame instantaneous fps (as the page meter computes it) and frames missing from the cadence. */
export function frameStats(times: readonly number[]): FrameStats | undefined {
  const dts: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const dt = (times[i] ?? 0) - (times[i - 1] ?? 0);
    if (dt > 0) dts.push(dt);
  }
  if (dts.length < 2) return undefined;
  const nominal = percentile(dts, 50);
  let dropped = 0;
  for (const dt of dts) if (dt > nominal * 1.5) dropped += Math.round(dt / nominal) - 1;
  const fps = dts.map((dt) => 1 / dt);
  return { fpsP50: round1(percentile(fps, 50)), fpsP5: round1(percentile(fps, 5)), droppedFrames: dropped, frameMs: round1(nominal * 1000) };
}

/** Decodes the ROI to small gray frames; returns their times (container clock) and motion energy. */
export async function roiMotion(file: string, roi: Roi): Promise<MotionTrack> {
  const scale = Math.min(1, 96 / roi.w);
  const w = Math.max(8, 2 * Math.round((roi.w * scale) / 2));
  const h = Math.max(8, 2 * Math.round((roi.h * scale) / 2));
  const filter = `crop=${roi.w}:${roi.h}:${roi.x}:${roi.y},scale=${w}:${h}:flags=area,format=gray,showinfo`;
  const args = ["-hide_banner", "-loglevel", "info", "-copyts", "-i", file, "-map", "0:v:0", "-vf", filter, "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"];
  const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const chunks: Buffer[] = [];
  const times: number[] = [];
  let err = "";
  child.stdout.on("data", (b: Buffer) => chunks.push(b));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    err += text;
    const lines = err.split("\n");
    err = lines.pop() ?? "";
    for (const line of lines) {
      const m = /showinfo.*\bpts_time:\s*(-?[\d.]+)/.exec(line);
      if (m?.[1] !== undefined) times.push(Number(m[1]));
    }
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", (e) => reject(new Error(`ffmpeg did not run: ${e.message}`)));
    child.once("close", () => resolve());
  });
  const frames = Buffer.concat(chunks);
  const count = Math.min(times.length, Math.floor(frames.length / (w * h)));
  if (count < 2) throw new Error(`Decoding ${file} produced ${count} frames for the ROI.`);
  return { times: times.slice(0, count), energy: motionEnergy(frames.subarray(0, count * w * h), w * h) };
}

/** The first audio stream as mono PCM where sample 0 is t = 0 on the container clock (gaps filled). */
export function decodeAudio(file: string): AudioTrack {
  const args = ["-hide_banner", "-loglevel", "error", "-copyts", "-i", file, "-map", "0:a:0", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", String(AUDIO_RATE), "-f", "f32le", "pipe:1"];
  const r = spawnSync(FFMPEG, args, { maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  if (r.error !== undefined) throw new Error(`ffmpeg did not run: ${r.error.message}`);
  const bytes = r.stdout;
  if (bytes.length < 4) throw new Error(`${file}: no audio decoded (${r.stderr.toString().trim().split(/\r?\n/).slice(-1)[0] ?? ""}).`);
  const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + Math.floor(bytes.length / 4) * 4));
  return { samples, sampleRate: AUDIO_RATE };
}
