// Director side of the Kokoro sidecar (tools/lab-voice): one Python process per run, JSON lines
// over stdio, requests answered in order. Our VoiceIds map to stock Kokoro voices.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { VoiceId } from "@sr/engine";
import { VISEMES, type Viseme } from "../../contract.js";
import { isFiniteNumber, isRecord, oneOf, parseJson } from "../json.js";
import { MODELS_DIR, VOICE_DIR, VOICE_PYTHON } from "../paths.js";

/** Our voice ids -> Kokoro v1.0 stock voices (Apache-2.0), chosen by ear for each label. */
export const KOKORO_VOICES: Readonly<Record<VoiceId, string>> = {
  crypt: "bm_george",
  velvet: "af_heart",
  rasp: "am_onyx",
  choir: "af_aoede",
  clerk: "bm_lewis",
};

export interface Spoken {
  sampleRate: number;
  pcm: Buffer;
  visemes: { v: Viseme; startMs: number; endMs: number }[];
  visemeSource: "durations" | "uniform";
}

/** The TTS seam the director uses; replay never creates one. */
export interface VoiceSynth {
  speak(id: string, text: string, voice: VoiceId): Promise<Spoken>;
  close(): Promise<void>;
}

function parseSpoken(value: Readonly<Record<string, unknown>>): Spoken {
  const { sampleRate, pcmBase64, visemes, visemeSource } = value;
  if (!isFiniteNumber(sampleRate) || typeof pcmBase64 !== "string" || !Array.isArray(visemes)) {
    throw new Error("lab-voice answered without sampleRate, pcmBase64 and visemes.");
  }
  const spans: Spoken["visemes"] = [];
  for (const s of visemes) {
    if (isRecord(s) && oneOf(VISEMES, s.v) && isFiniteNumber(s.startMs) && isFiniteNumber(s.endMs)) {
      spans.push({ v: s.v, startMs: s.startMs, endMs: s.endMs });
    }
  }
  return {
    sampleRate,
    pcm: Buffer.from(pcmBase64, "base64"),
    visemes: spans,
    visemeSource: visemeSource === "durations" ? "durations" : "uniform",
  };
}

export async function startKokoro(log: (line: string) => void): Promise<VoiceSynth> {
  if (!existsSync(VOICE_PYTHON)) throw new Error(`The voice sidecar is not set up (${VOICE_PYTHON} is missing): run \`pnpm lab setup\`.`);
  const child: ChildProcessWithoutNullStreams = spawn(VOICE_PYTHON, ["-m", "lab_voice.server", "--models", MODELS_DIR], {
    cwd: VOICE_DIR,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    windowsHide: true,
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => {
    for (const line of d.split("\n")) if (line.trim() !== "") log(`lab-voice: ${line.trim()}`);
  });
  const waiting = new Map<string, { resolve: (s: Spoken) => void; reject: (e: Error) => void }>();
  let ready: (() => void) | undefined;
  let failed: ((e: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const failAll = (error: Error): void => {
    failed?.(error);
    for (const w of waiting.values()) w.reject(error);
    waiting.clear();
  };
  child.once("error", (e) => failAll(new Error(`lab-voice could not start: ${e.message}`)));
  child.once("close", (code) => failAll(new Error(`lab-voice exited (code ${code ?? "signal"}).`)));
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    const value = parseJson(line);
    if (!isRecord(value)) return;
    if (value.ready === true) return ready?.();
    const id = typeof value.id === "string" ? value.id : undefined;
    const w = id === undefined ? undefined : waiting.get(id);
    if (w === undefined || id === undefined) return;
    waiting.delete(id);
    if (typeof value.error === "string") w.reject(new Error(`lab-voice: ${value.error}`));
    else {
      try {
        w.resolve(parseSpoken(value));
      } catch (error) {
        w.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
  await readyPromise;
  return {
    speak(id, text, voice) {
      return new Promise<Spoken>((resolve, reject) => {
        if (waiting.has(id)) return reject(new Error(`lab-voice: request id ${id} is already in flight.`));
        waiting.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ id, text, voice: KOKORO_VOICES[voice] })}\n`, "utf8");
      });
    },
    async close() {
      if (child.exitCode !== null) return;
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 3000);
      await closed;
      clearTimeout(timer);
    },
  };
}
