// POST /api/voice and the TTS helpers (voice-and-air requirement 3), fake fetch only.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VOICE_IDS, VOICES } from "@sr/engine";
import { createQuota, DEFAULT_LIMITS, MemoryQuotaStore, type QuotaKind } from "../_lib/quota.js";
import { replayShow } from "../_lib/show.js";
import { audioPart, DEFAULT_SAMPLE_RATE, isWav, pcmRate, pcmToWav, synthesize, toWav, ttsModel, ttsPrompt, WAV_HEADER_BYTES } from "../_lib/tts.js";
import type { FetchLike } from "../_lib/kv.js";
import { handleVoice, readShowAsset, recordedWav, type VoiceDeps } from "../voice.js";

const LIVE = { SR_PLANE: "live", GEMINI_API_KEY: "g-test-not-real" };
const PCM = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function ttsFetch(seen: Seen[] = [], status = 200): FetchLike {
  return (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    seen.push({ url, headers, body: JSON.parse(String(init.body)) });
    const body = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from(PCM).toString("base64") } }] } }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

const throwingFetch: FetchLike = () => {
  throw new Error("no network on replay");
};

function memoryQuota(perIp: Partial<Record<QuotaKind, number>> = {}) {
  const charges: QuotaKind[] = [];
  const inner = createQuota({ store: new MemoryQuotaStore(), salt: "s", limits: { ...DEFAULT_LIMITS, perIp: { ...DEFAULT_LIMITS.perIp, ...perIp } } });
  return {
    charges,
    quota: {
      checkAndCharge: (ip: string, kind: QuotaKind, usd: number) => {
        charges.push(kind);
        return inner.checkAndCharge(ip, kind, usd);
      },
    },
  };
}

/** Fake recordings: the bytes spell the file name, so a test can see which one was served. */
const readAsset = (path: string) => Promise.resolve(new TextEncoder().encode(`RIFF:${path}`));

function deps(env: Record<string, string>, fetch: FetchLike, quota = memoryQuota().quota): VoiceDeps {
  return { env, fetch, quota, readAsset };
}

function post(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://sr.test/api/voice", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.4", ...headers },
    body: JSON.stringify(payload),
  });
}

describe("pcmToWav", () => {
  it("writes a canonical 44-byte header that describes the PCM exactly", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2000 }), fc.constantFrom(16_000, 24_000, 48_000), (pcm, rate) => {
        const wav = pcmToWav(pcm, rate);
        const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
        const tag = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));
        const data = pcm.length - (pcm.length % 2);
        expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
        expect(view.getUint32(4, true)).toBe(wav.length - 8);
        expect(view.getUint16(20, true)).toBe(1);
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(rate);
        expect(view.getUint32(28, true)).toBe(rate * 2);
        expect(view.getUint16(32, true)).toBe(2);
        expect(view.getUint16(34, true)).toBe(16);
        expect(view.getUint32(40, true)).toBe(data);
        expect(wav.length).toBe(WAV_HEADER_BYTES + data);
        expect([...wav.subarray(WAV_HEADER_BYTES)]).toEqual([...pcm.subarray(0, data)]);
      }),
    );
  });

  it("reads the sample rate from the mime type, defaulting to 24 kHz", () => {
    expect(pcmRate("audio/L16;codec=pcm;rate=24000")).toBe(24_000);
    expect(pcmRate("audio/L16; rate=16000")).toBe(16_000);
    expect(pcmRate("audio/L16")).toBe(DEFAULT_SAMPLE_RATE);
    expect(pcmRate("audio/L16;rate=7")).toBe(DEFAULT_SAMPLE_RATE);
  });

  it("finds the audio part and ignores anything else", () => {
    expect(audioPart({ candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { mimeType: "audio/L16", data: "AA==" } }] } }] })).toEqual({ mimeType: "audio/L16", data: "AA==" });
    for (const bad of [null, {}, { candidates: [] }, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AA==" } }] } }] }]) {
      expect(audioPart(bad)).toBeUndefined();
    }
  });
});

describe("toWav and the prompt", () => {
  it("keeps a reply that already is a WAV and wraps raw PCM exactly once", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 2, maxLength: 400 }), (pcm) => {
        const once = toWav(pcm, "audio/L16;rate=24000");
        expect(isWav(once)).toBe(true);
        expect(toWav(once, "audio/wav")).toBe(once);
        expect(once.length).toBe(WAV_HEADER_BYTES + pcm.length - (pcm.length % 2));
      }),
    );
  });

  it("sends the line alone: a style prefix would be read aloud", () => {
    expect(ttsPrompt("  Hail, minion.  ")).toBe("Hail, minion.");
  });
});

describe("synthesize", () => {
  it("sends the Gemini voice for our id, the model from SR_TTS_MODEL and the key only in a header", async () => {
    for (const voice of VOICE_IDS) {
      const seen: Seen[] = [];
      const wav = await synthesize("Hail.", voice, { apiKey: "g-key", model: ttsModel({ SR_TTS_MODEL: " tts-x " }), fetch: ttsFetch(seen) });
      expect(seen[0]?.url).toMatch(/\/tts-x:generateContent$/);
      expect(seen[0]?.url).not.toContain("g-key");
      expect(seen[0]?.headers["x-goog-api-key"]).toBe("g-key");
      expect(JSON.stringify(seen[0]?.body)).toContain(`"voiceName":"${VOICES[voice].gemini}"`);
      expect(JSON.stringify(seen[0]?.body)).toContain('"responseModalities":["AUDIO"]');
      expect(JSON.stringify(seen[0]?.body)).toContain('"parts":[{"text":"Hail."}]');
      expect(wav.length).toBe(WAV_HEADER_BYTES + PCM.length);
    }
  });

  it("fails as upstream on HTTP errors and on a body without audio", async () => {
    await expect(synthesize("x", "clerk", { apiKey: "k", model: "m", fetch: ttsFetch([], 500) })).rejects.toMatchObject({ code: "upstream" });
    const empty: FetchLike = () => Promise.resolve(new Response("{}"));
    await expect(synthesize("x", "clerk", { apiKey: "k", model: "m", fetch: empty })).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("POST /api/voice on replay", () => {
  it("returns the recorded WAV of a known show line, with zero fetches and no charge", async () => {
    const q = memoryQuota();
    const beat = replayShow().beats[5];
    const res = await handleVoice(post({ text: beat?.reply.line, voice: "clerk" }), deps({}, throwingFetch, q.quota));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-sr-recorded")).toBe("line");
    expect(await res.text()).toBe(`RIFF:${beat?.wav}`);
    expect(q.charges).toEqual([]);
  });

  it("returns the recorded fallback phrase for any other text", async () => {
    const res = await handleVoice(post({ text: "Something never recorded.", voice: "crypt" }), deps({}, throwingFetch));
    expect(res.headers.get("x-sr-recorded")).toBe("fallback");
    expect(await res.text()).toBe(`RIFF:${recordedWav(replayShow(), "-").wav}`);
  });

  it("serves replay when x-sr-plane: replay is sent, even on a live deploy with a key", async () => {
    const q = memoryQuota();
    const res = await handleVoice(post({ text: "Hail.", voice: "clerk" }, { "x-sr-plane": "replay" }), deps(LIVE, throwingFetch, q.quota));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sr-recorded")).toBe("fallback");
    expect(q.charges).toEqual([]);
  });

  it("rejects an unknown voice, an empty text and a text over 300 characters with bad_input", async () => {
    for (const payload of [{ text: "Hail.", voice: "opera" }, { text: "Hail." }, { text: "  ", voice: "clerk" }, { text: "x".repeat(301), voice: "clerk" }]) {
      const res = await handleVoice(post(payload), deps({}, throwingFetch));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "bad_input" } });
    }
  });
});

describe("POST /api/voice on live", () => {
  it("charges quota kind voice before the call and returns audio/wav", async () => {
    const q = memoryQuota();
    const seen: Seen[] = [];
    const res = await handleVoice(post({ text: "Hail, minion.", voice: "clerk" }), deps(LIVE, ttsFetch(seen), q.quota));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(WAV_HEADER_BYTES + PCM.length);
    expect(q.charges).toEqual(["voice"]);
    expect(seen).toHaveLength(1);
  });

  it("fails with quota before any call when the voice quota is exhausted", async () => {
    const seen: Seen[] = [];
    const res = await handleVoice(post({ text: "Hail.", voice: "clerk" }), deps(LIVE, ttsFetch(seen), memoryQuota({ voice: 0 }).quota));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: "quota" } });
    expect(seen).toHaveLength(0);
  });
});

describe("recorded show WAVs (assets/replay/shows/malakor-night/)", () => {
  it("exist for every line as 16-bit mono 24 kHz WAV within the 15 MB budget", async () => {
    let total = 0;
    for (const beat of replayShow().beats) {
      const wav = await readShowAsset(beat.wav);
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(isWav(wav)).toBe(true);
      expect([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([1, 24_000, 16]);
      expect(view.getUint32(40, true)).toBe(wav.length - WAV_HEADER_BYTES);
      expect(wav.length).toBeGreaterThan(24_000 * 2); // more than a second of audio
      total += wav.length;
    }
    expect(total).toBeLessThanOrEqual(15 * 1024 * 1024);
  });

  it("refuses an asset path that climbs out of the shows folder", async () => {
    await expect(readShowAsset("../../package.json")).rejects.toThrow();
  });
});
