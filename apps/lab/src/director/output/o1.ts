// O1, the streamed output: the stage page runs headless (or headed) exactly as for O0, but its
// composite canvas + audio leave the page as live MediaRecorder chunks (o1/capture.ts, injected,
// no page change) -> Playwright binding -> ffmpeg publisher stdin -> H.264/AAC over RTMP to a local
// ffmpeg sink on 127.0.0.1 -> var/lab/runs/<runId>/run.flv. Never a public ingest.
//
// Why MediaRecorder chunks and not a CDP screencast: the screencast's video is fine (59.4 fps, dt p95
// 16.8 ms, measured on a 1080p canvas page) but it carries no audio, so the audio would need a second
// channel and a Node-side alignment of two clocks: an error in exactly the A/V offset this lab
// measures. The recorder muxes the composite and the stage's own audio on the browser's media clock
// in one stream (what O0 already proved) and hands over a chunk every 250 ms.
// A dead publisher is restarted (o1/pipeline.ts), counted in o1.json and marked.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "../stage/browser.js";
import { captureScript, CAPTURE_DEFAULTS, CHUNK_BINDING, MIME_EXPRESSION, STOP_EXPRESSION } from "./o1/capture.js";
import { FFMPEG, hasFfmpeg, pickEncoder, PUBLISH_DEFAULTS, type PublishSettings } from "./o1/ffmpeg.js";
import { joinSegments } from "./o1/join.js";
import { RtmpPipeline } from "./o1/pipeline.js";
import type { OutputArmFactory } from "./types.js";

export const STREAM_FILE = "run.flv";
export const SIDECAR_FILE = "o1.json";
const STOP_TIMEOUT_MS = 30_000;

/** What O1 writes next to run.flv (not part of the contract's Metrics). */
export interface O1Report {
  encoder: string;
  settings: PublishSettings;
  capture: typeof CAPTURE_DEFAULTS;
  mimeType?: string;
  reconnects: number;
  chunks: number;
  bytes: number;
  /** Chunks that arrived out of sequence (should be 0). */
  outOfOrder: number;
  segments: { file: string; startMs: number }[];
  marks: { atS: number; name: string }[];
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`O1: ${what} did not finish within ${ms / 1000} s.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export const createO1: OutputArmFactory = (ctx) => {
  let stage: Stage | undefined;
  let pipeline: RtmpPipeline | undefined;
  let dir = "";
  let settings: PublishSettings | undefined;
  const t0 = performance.now();
  const marks: O1Report["marks"] = [];
  const stats = { chunks: 0, bytes: 0, outOfOrder: 0, next: 0 };
  const mark = (name: string): void => {
    marks.push({ atS: Math.round(performance.now() - t0) / 1000, name });
    ctx.mark(name);
  };

  return {
    id: "O1",
    async start({ pageUrl, runDir }) {
      if (!hasFfmpeg()) throw new Error(`O1 needs ffmpeg on PATH (or SR_LAB_FFMPEG); "${FFMPEG} -version" did not run.`);
      dir = runDir;
      settings = { encoder: pickEncoder(), ...PUBLISH_DEFAULTS };
      ctx.log(`O1: ${settings.encoder} ${settings.videoKbps} kb/s, keyframe ${settings.keyframeS} s, AAC ${settings.audioKbps} kb/s -> local RTMP sink.`);
      pipeline = new RtmpPipeline({ ffmpeg: FFMPEG, settings, dir, log: ctx.log, mark });
      await pipeline.open();
      const live = pipeline;
      stage = await ctx.launch("about:blank");
      ctx.onStage(stage);
      await stage.page.exposeBinding(CHUNK_BINDING, (_source, seq: unknown, base64: unknown) => {
        if (typeof seq !== "number" || typeof base64 !== "string") return;
        if (seq !== stats.next) stats.outOfOrder += 1;
        stats.next = seq + 1;
        const chunk = Buffer.from(base64, "base64");
        stats.chunks += 1;
        stats.bytes += chunk.length;
        live.write(chunk);
      });
      await stage.page.addInitScript(captureScript());
      const url = new URL(pageUrl);
      url.searchParams.set("record", "webm");
      await stage.page.goto(url.toString());
    },
    async stop() {
      if (stage === undefined || pipeline === undefined || settings === undefined) throw new Error("O1.stop() before start().");
      let mimeType: unknown;
      try {
        mimeType = await stage.page.evaluate(MIME_EXPRESSION);
        await withTimeout(stage.page.evaluate(STOP_EXPRESSION), STOP_TIMEOUT_MS, "the page recorder stop");
      } finally {
        await stage.close();
        stage = undefined;
      }
      const segments = await pipeline.close();
      const file = join(dir, STREAM_FILE);
      joinSegments(segments, file, FFMPEG);
      const report: O1Report = {
        encoder: settings.encoder,
        settings,
        capture: CAPTURE_DEFAULTS,
        ...(typeof mimeType === "string" ? { mimeType } : {}),
        reconnects: pipeline.reconnects,
        chunks: stats.chunks,
        bytes: stats.bytes,
        outOfOrder: stats.outOfOrder,
        segments: segments.map((s) => ({ file: s.file.slice(dir.length + 1), startMs: s.startMs })),
        marks,
      };
      writeFileSync(join(dir, SIDECAR_FILE), `${JSON.stringify(report, null, 2)}\n`);
      ctx.log(`O1: ${STREAM_FILE} closed; ${stats.chunks} chunks, ${(stats.bytes / 1e6).toFixed(1)} MB from the page, ${pipeline.reconnects} reconnect(s).`);
      return { file };
    },
  };
};
