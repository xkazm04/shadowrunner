// The stage's sound: one AudioContext whose time is the page clock. Utterances (s16le mono PCM from
// the director) play back to back through one output gain, which feeds the speakers, the lip
// driver, the scene's level and the recording stream.
import { attachAudio } from "@sr/avatar/core";
import type { StageAudio } from "./types.js";

/** Lead before the first sample, so scheduling never lands in the past. */
const LEAD_S = 0.03;

export interface StageSound extends StageAudio {
  /** The output as a MediaStream, for the recorder. */
  readonly stream: MediaStream;
  /** Keeps the PCM of utterance `id` until its audio event arrives. */
  store(id: string, sampleRate: number, pcmBase64: string): void;
  /** Schedules `id` after whatever is queued; `onStart` gets the audio-clock ms of its first sample. */
  play(id: string, onStart: (atMs: number) => void): number | undefined;
  stop(): void;
}

function decodePcm(base64: string): Float32Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(new ArrayBuffer(Math.floor(bytes.length / 2) * 4));
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function createStageSound(): StageSound {
  const context = new AudioContext({ latencyHint: "interactive" });
  const output = context.createGain();
  output.connect(context.destination);
  const sink = context.createMediaStreamDestination();
  output.connect(sink);
  const tap = attachAudio(output);
  const base = context.currentTime;
  const pending = new Map<string, AudioBuffer>();
  const sources = new Set<AudioBufferSourceNode>();
  let queueEnd = 0;
  const nowMs = (): number => (context.currentTime - base) * 1000;

  return {
    context,
    output,
    stream: sink.stream,
    nowMs,
    level: () => tap.level(),
    store(id, sampleRate, pcmBase64) {
      const samples = decodePcm(pcmBase64);
      const buffer = context.createBuffer(1, Math.max(1, samples.length), sampleRate);
      buffer.copyToChannel(samples, 0);
      pending.set(id, buffer);
    },
    play(id, onStart) {
      const buffer = pending.get(id);
      if (buffer === undefined) return undefined;
      pending.delete(id);
      if (context.state === "suspended") void context.resume();
      const startAt = Math.max(context.currentTime + LEAD_S, queueEnd);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      source.start(startAt);
      sources.add(source);
      source.onended = () => sources.delete(source);
      queueEnd = startAt + buffer.duration;
      const atMs = (startAt - base) * 1000;
      setTimeout(() => onStart(atMs), Math.max(0, atMs - nowMs()));
      return atMs;
    },
    stop() {
      for (const s of sources) s.stop();
      sources.clear();
      tap.detach();
    },
  };
}
