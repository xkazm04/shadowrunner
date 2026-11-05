// O1's ffmpeg processes (system ffmpeg on PATH): the RTMP sink (one listener per connection,
// recording a segment with stream copy) and the publisher (live Matroska/WebM on stdin -> H.264 +
// AAC FLV over RTMP). Ingest norms of Twitch/YouTube: H.264 CBR, a keyframe every 2 s, AAC 48 kHz.
// Frame timestamps pass through untouched (no CFR resampling), so measure sees real frame timing.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export const FFMPEG = process.env.SR_LAB_FFMPEG ?? "ffmpeg";
export const RTMP_PATH = "live/lab";

export type VideoEncoder = "h264_nvenc" | "libx264";

export interface PublishSettings {
  encoder: VideoEncoder;
  videoKbps: number;
  audioKbps: number;
  keyframeS: number;
}

export const PUBLISH_DEFAULTS: Omit<PublishSettings, "encoder"> = { videoKbps: 6000, audioKbps: 160, keyframeS: 2 };

/** h264_nvenc when this ffmpeg has it and a GPU accepts a tiny encode, else libx264. */
export function pickEncoder(ffmpeg = FFMPEG): VideoEncoder {
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=s=256x256:d=0.2", "-c:v", "h264_nvenc", "-f", "null", "-"], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 20_000,
  });
  return probe.status === 0 ? "h264_nvenc" : "libx264";
}

/** True when `ffmpeg -version` runs. */
export function hasFfmpeg(ffmpeg = FFMPEG): boolean {
  const r = spawnSync(ffmpeg, ["-version"], { stdio: "ignore", timeout: 10_000 });
  return r.status === 0;
}

/** A TCP port that was free a moment ago on 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export const rtmpUrl = (port: number): string => `rtmp://127.0.0.1:${port}/${RTMP_PATH}`;

/** Sink arguments: listen for one RTMP publisher and copy its streams into `file` (FLV). */
export function sinkArgs(port: number, file: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-y", "-listen", "1", "-i", rtmpUrl(port), "-c", "copy", "-f", "flv", file];
}

/** Publisher arguments: live Matroska/WebM on stdin -> H.264 + AAC FLV over RTMP. */
export function publishArgs(port: number, s: PublishSettings): string[] {
  const rate = `${s.videoKbps}k`;
  const video =
    s.encoder === "h264_nvenc"
      ? ["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll", "-rc", "cbr", "-bf", "0", "-forced-idr", "1"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-bf", "0"];
  return [
    "-hide_banner", "-loglevel", "error",
    "-fflags", "+genpts",
    "-i", "pipe:0",
    "-map", "0:v:0", "-map", "0:a:0?",
    ...video,
    "-b:v", rate, "-maxrate", rate, "-bufsize", `${s.videoKbps * 2}k`,
    "-pix_fmt", "yuv420p",
    "-force_key_frames", `expr:gte(t,n_forced*${s.keyframeS})`,
    "-fps_mode", "passthrough",
    "-c:a", "aac", "-b:a", `${s.audioKbps}k`, "-ar", "48000", "-ac", "2",
    "-f", "flv", rtmpUrl(port),
  ];
}

export interface Proc {
  child: ChildProcess;
  /** Resolves with the exit code (null when killed by a signal). */
  exited: Promise<number | null>;
  /** Last stderr lines, for error sentences. */
  tail(): string;
}

export function startProc(ffmpeg: string, args: readonly string[], stdin: "pipe" | "ignore"): Proc {
  const child = spawn(ffmpeg, args, { stdio: [stdin, "ignore", "pipe"], windowsHide: true });
  const lines: string[] = [];
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (text: string) => {
    lines.push(...text.split(/\r?\n/).filter((l) => l.trim() !== ""));
    if (lines.length > 20) lines.splice(0, lines.length - 20);
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(-1));
  });
  return { child, exited, tail: () => lines.slice(-4).join(" | ") };
}

/** Waits up to `ms` for the process to exit; kills it after that. */
export async function settle(proc: Proc, ms: number): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  const r = await Promise.race([proc.exited, timeout]);
  clearTimeout(timer);
  if (r !== "timeout") return r;
  proc.child.kill();
  return proc.exited;
}
