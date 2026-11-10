// The fitting corpus (perfection-pass task 4): Kokoro sentences with Kokoro's own phoneme timings,
// as the Avatar Lab's voice sidecar writes them (tools/lab-voice: one JSON line per clip, PCM s16le
// mono in base64, Oculus-15 viseme spans). corpus.mjs makes the file; this reads it back.
import { readFileSync } from "node:fs";
import { FEATURES } from "../../packages/avatar/src/speech/features.ts";
import type { MouthShape } from "../../packages/avatar/src/mouth/shapes.ts";

/** The lab's viseme -> shape grouping (apps/lab/src/page/lip/mouth/shapes.ts), copied so the
 *  harness runs on plain node without the workspace's package resolution. */
export const VISEME_SHAPE: Readonly<Record<string, MouthShape>> = {
  sil: "rest", PP: "closed", FF: "teeth", TH: "tongue", DD: "tongue", kk: "openMid", CH: "narrow", SS: "narrow",
  nn: "tongue", RR: "round", aa: "openWide", E: "openMid", ih: "narrow", oh: "round", ou: "round",
};
/** Kokoro's timings run about 50 ms late against its own audio (measured by cross-correlating the
 *  speech/rest labels with the frame energy over the corpus). */
export const REF_SHIFT_MS = -50;
/** The frames each classifier input stacks (written to speech/weights.ts as FRAME_OFFSETS). */
export const OFFSETS = [-8, -4, 0, 4, 8] as const;

export interface Span { v: string; startMs: number; endMs: number }
export interface Clip { id: string; voice: string; text: string; rate: number; samples: Float32Array; spans: Span[] }

interface Sentence { id: string; text: string; voice: string }
interface Spoken { id?: string; sampleRate: number; pcmBase64: string; visemes: Span[] }

const lines = (path: string): unknown[] => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as unknown);

/** The clips of `corpusPath`, joined to their sentence (text and voice) in `sentencesPath`. */
export function loadCorpus(corpusPath: string, sentencesPath: string): Clip[] {
  const sentences = new Map((lines(sentencesPath) as Sentence[]).map((s) => [s.id, s]));
  const out: Clip[] = [];
  for (const d of lines(corpusPath) as Spoken[]) {
    if (d.id === undefined) continue; // the sidecar's {"ready": ...} line
    const s = sentences.get(d.id);
    if (s === undefined) throw new Error(`${d.id}: not in ${sentencesPath}`);
    const buf = Buffer.from(d.pcmBase64, "base64");
    const samples = new Float32Array(buf.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(2 * i) / 32768;
    out.push({ id: d.id, voice: s.voice, text: s.text, rate: d.sampleRate, samples, spans: d.visemes });
  }
  return out;
}

/** The reference shape per 10 ms frame (frame i centred at i * 10 ms). */
export function labels(clip: Clip, count: number): MouthShape[] {
  const out = new Array<MouthShape>(count).fill("rest");
  for (const s of clip.spans) {
    const end = Math.min(count, Math.ceil((s.endMs + REF_SHIFT_MS) / 10));
    for (let i = Math.max(0, Math.ceil((s.startMs + REF_SHIFT_MS) / 10)); i < end; i++) out[i] = VISEME_SHAPE[s.v] ?? "rest";
  }
  return out;
}

/** Each frame's classifier input: the FEATURES of the frames at OFFSETS around it (edges clamped). */
export function stack(values: Float32Array, frames: number): number[][] {
  return Array.from({ length: frames }, (_, i) =>
    OFFSETS.flatMap((o) => {
      const j = Math.min(frames - 1, Math.max(0, i + o));
      return [...values.subarray(j * FEATURES, (j + 1) * FEATURES)];
    }),
  );
}
