import { describe, expect, it } from "vitest";
import { createChunker, MIC_CHUNK, rms } from "./pcm";

const tone = (rate: number, hz: number, seconds: number, from = 0): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * (i + from)) / rate));

describe("createChunker", () => {
  it("turns 48 kHz into 40 ms PCM16 chunks at 16 kHz, whatever the block size", () => {
    const chunker = createChunker(48000);
    const input = tone(48000, 220, 1);
    const chunks: Int16Array[] = [];
    for (let at = 0; at < input.length; at += 128) chunks.push(...chunker.push(input.subarray(at, at + 128)));
    // 1 s at 16 kHz is 25 chunks of 640 (the last output needs only sample 47998 of 48000).
    expect(chunks.length).toBe(25);
    expect(chunks.every((c) => c.length === MIC_CHUNK)).toBe(true);
  });

  it("keeps the tone: same frequency and level after resampling", () => {
    const chunker = createChunker(48000);
    const out = chunker.push(tone(48000, 200, 0.5)).flatMap((c) => [...c].map((s) => s / 32768));
    let crossings = 0;
    for (let i = 1; i < out.length; i += 1) if ((out[i - 1] ?? 0) < 0 && (out[i] ?? 0) >= 0) crossings += 1;
    // 200 Hz over 0.48 s of output is ~96 upward crossings.
    expect(crossings).toBeGreaterThanOrEqual(94);
    expect(crossings).toBeLessThanOrEqual(97);
    expect(rms(Float32Array.from(out))).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  it("passes 16 kHz straight through", () => {
    const chunker = createChunker(16000);
    const input = tone(16000, 300, 0.1);
    const [first] = chunker.push(input);
    expect(first?.[10]).toBe(Math.round((input[10] ?? 0) * 32767));
  });
});

describe("rms", () => {
  it("is 0 for silence and nothing", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(new Float32Array(64))).toBe(0);
  });
});
