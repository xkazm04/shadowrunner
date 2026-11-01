// Gemini TTS (voice-and-air requirement 3.1, design.md "api/_lib/tts.ts"): text + one of our
// voices -> Gemini `generateContent` with an AUDIO response -> raw PCM -> a WAV file.
// `fetch` is injected, so tests never call the network. The key travels only in the
// `x-goog-api-key` header; failures are `ApiError("upstream")` with our own message, and the
// upstream body is never copied into an error or a log.
import { decodeJson, VOICES, type VoiceId } from "@sr/engine";
import { ApiError } from "./errors.js";
import type { FetchLike } from "./kv.js";
import type { Env } from "./plane.js";

/** Default TTS model when `SR_TTS_MODEL` is empty (chosen by the task 4 render, docs/provenance.md). */
export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts";
export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
export const TTS_TIMEOUT_MS = 30_000;
/** Gemini TTS answers 16-bit little-endian mono PCM at 24 kHz unless the mime type says otherwise. */
export const DEFAULT_SAMPLE_RATE = 24_000;

/**
 * What is sent to the model: the line itself and nothing else. A spoken-style prefix ("Say this
 * as ...:") is read aloud by the TTS model (measured in the task 4 render, docs/provenance.md),
 * so the voice's character comes from the prebuilt voice alone.
 */
export function ttsModel(env: Env = process.env): string {
  return env.SR_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
}

export function ttsPrompt(text: string): string {
  return text.trim();
}

/** Sample rate from a mime type such as `audio/L16;codec=pcm;rate=24000`. */
export function pcmRate(mimeType: string): number {
  const match = /(?:^|;)\s*rate=(\d+)/i.exec(mimeType);
  const rate = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(rate) && rate >= 8_000 && rate <= 192_000 ? rate : DEFAULT_SAMPLE_RATE;
}

export const WAV_HEADER_BYTES = 44;

/** Wraps 16-bit little-endian PCM in a canonical 44-byte RIFF/WAVE header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = DEFAULT_SAMPLE_RATE, channels = 1): Uint8Array {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = pcm.length - (pcm.length % blockAlign);
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  out.set(pcm.subarray(0, dataBytes), WAV_HEADER_BYTES);
  return out;
}

/** True when the bytes already are a RIFF/WAVE file. */
export function isWav(bytes: Uint8Array): boolean {
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  return bytes.length >= 12 && tag(0) === "RIFF" && tag(8) === "WAVE";
}

/**
 * The model's audio as a WAV file. Gemini TTS models answer either raw PCM (`audio/L16;rate=...`)
 * or a complete WAV (`audio/wav`, seen from gemini-3.8-flash-tts); a WAV is kept as is, never
 * wrapped twice.
 */
export function toWav(audio: Uint8Array, mimeType: string): Uint8Array {
  return isWav(audio) ? audio : pcmToWav(audio, pcmRate(mimeType));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first audio part of a generateContent body, or undefined. */
export function audioPart(body: unknown): { mimeType: string; data: string } | undefined {
  if (!isRecord(body) || !Array.isArray(body.candidates)) return undefined;
  const first: unknown = body.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return undefined;
  for (const part of first.content.parts) {
    const inline = isRecord(part) ? part.inlineData : undefined;
    if (isRecord(inline) && typeof inline.data === "string" && inline.data.length > 0) {
      const mimeType = typeof inline.mimeType === "string" ? inline.mimeType : "audio/L16";
      if (mimeType.startsWith("audio/")) return { mimeType, data: inline.data };
    }
  }
  return undefined;
}

export interface TtsConfig {
  apiKey: string | undefined;
  model: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

const FAILED = "The voice did not come through.";

/** One spoken line as WAV bytes. Every failure is `ApiError("upstream")`. */
export async function synthesize(text: string, voice: VoiceId, config: TtsConfig): Promise<Uint8Array> {
  const key = config.apiKey?.trim();
  if (!key) throw new ApiError("upstream", "The voice is not configured.");
  const body = {
    contents: [{ role: "user", parts: [{ text: ttsPrompt(text) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[voice].gemini } } },
    },
  };
  let raw: string;
  try {
    const res = await config.fetch(`${GEMINI_API}/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs ?? TTS_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ApiError("upstream", res.status === 429 ? "The voice is busy. Try again in a minute." : FAILED);
    }
    raw = await res.text();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("upstream", FAILED);
  }
  const audio = audioPart(decodeJson(raw));
  if (audio === undefined) throw new ApiError("upstream", FAILED);
  const bytes = new Uint8Array(Buffer.from(audio.data, "base64"));
  if (bytes.length < 2) throw new ApiError("upstream", FAILED);
  return toWav(bytes, audio.mimeType);
}
