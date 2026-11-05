// A synthetic clip with a known A/V offset, to validate measure end to end through a real encoder
// and container: a "mouth" box whose opening follows a seeded speech-like envelope (bursts of
// 4-6 Hz syllables), and a tone whose amplitude follows the same envelope `offsetMs` EARLIER, so
// the mouth lags the audio by `offsetMs` (measure must report avOffsetMs = +offsetMs).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWav } from "../director/voice/wav.js";
import { FFMPEG, type Roi } from "./probe.js";

export const SYNTH_W = 320;
export const SYNTH_H = 180;
export const SYNTH_ROI: Roi = { x: 110, y: 50, w: 100, h: 80 };

export interface SynthOptions {
  out: string;
  offsetMs: number;
  seconds?: number;
  fps?: number;
  seed?: number;
  /** "flv" (H.264 + AAC, the O1 path) or "webm" (VP9 + Opus, the O0 path). */
  format?: "flv" | "webm";
}

/** mulberry32: a small seeded PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Speech-like envelope 0..1: bursts with syllable modulation, separated by pauses. */
export function envelope(seconds: number, seed: number): (t: number) => number {
  const r = rng(seed);
  const bursts: { start: number; end: number; hz: number }[] = [];
  let t = 0.5;
  while (t < seconds) {
    const len = 0.4 + r() * 1.4;
    bursts.push({ start: t, end: t + len, hz: 4 + r() * 2 });
    t += len + 0.25 + r() * 0.9;
  }
  return (time: number) => {
    const b = bursts.find((x) => time >= x.start && time < x.end);
    if (b === undefined) return 0;
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * b.hz * (time - b.start));
  };
}

export async function synthClip(o: SynthOptions): Promise<void> {
  const seconds = o.seconds ?? 20;
  const fps = o.fps ?? 30;
  const env = envelope(seconds, o.seed ?? 7);
  const shift = o.offsetMs / 1000;
  const dir = mkdtempSync(join(tmpdir(), "sr-lab-synth-"));
  try {
    const rate = 48_000;
    const pcm = Buffer.alloc(seconds * rate * 2);
    for (let i = 0; i < seconds * rate; i += 1) {
      const t = i / rate;
      pcm.writeInt16LE(Math.round(0.6 * env(t) * Math.sin(2 * Math.PI * 220 * t) * 32767), i * 2);
    }
    const wav = join(dir, "tone.wav");
    writeFileSync(wav, encodeWav(pcm, rate));
    const codec = (o.format ?? "flv") === "flv" ? ["-c:v", "libx264", "-preset", "veryfast", "-g", "60", "-c:a", "aac", "-f", "flv"] : ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-c:a", "libopus", "-f", "webm"];
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${SYNTH_W}x${SYNTH_H}`, "-r", String(fps), "-i", "pipe:0", "-i", wav, "-pix_fmt", "yuv420p", ...codec, o.out];
    const child = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (s: string) => (err += s));
    const done = new Promise<number | null>((resolve) => child.once("close", resolve));
    const r = rng(99);
    for (let k = 0; k < seconds * fps; k += 1) {
      const frame = Buffer.alloc(SYNTH_W * SYNTH_H, 24);
      const open = env(k / fps - shift);
      const half = Math.round(4 + 30 * open);
      for (let y = 90 - half; y < 90 + half; y += 1) for (let x = 130; x < 190; x += 1) frame[y * SYNTH_W + x] = 220;
      for (let i = 0; i < 200; i += 1) frame[Math.floor(r() * frame.length)] = 24 + Math.floor(r() * 20); // sensor-ish noise
      if (!child.stdin.write(frame)) await new Promise((resolve) => child.stdin.once("drain", resolve));
    }
    child.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg could not encode the synthetic clip: ${err.trim()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
