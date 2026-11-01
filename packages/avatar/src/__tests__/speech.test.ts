/// <reference types="node" />
// Speech gain (task 7, req 4.1, 4.2): `speechLevel` maps RMS to the driver's level as
// clamp((rms - SPEECH_FLOOR) * SPEECH_GAIN, 0, 1), and a recorded line of Malakor's replay show
// opens the jaw through its range. The WAV is decoded here (16-bit PCM RIFF), never fetched; the
// node types are referenced by this test alone (the package is DOM-only).
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rms, SPEECH_FLOOR, SPEECH_GAIN, speechLevel } from "../audio/level.js";
import { initialState, type DriverState } from "../driver/state.js";
import { step } from "../driver/step.js";

const WAV = new URL("../../../../assets/replay/shows/malakor-night/b00.wav", import.meta.url);

/** Mono 16-bit PCM WAV -> samples in [-1, 1] and the sample rate. */
function decodeWav(bytes: Uint8Array): { samples: Float32Array; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let rate = 0;
  let channels = 0;
  let bits = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (channels !== 1 || bits !== 16) throw new Error(`expected mono 16-bit PCM, got ${channels} ch ${bits} bit`);
      const count = Math.floor(Math.min(size, bytes.length - body) / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(body + 2 * i, true) / 32768;
      return { samples, rate };
    }
    at = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const quantile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? NaN;
};

describe("speechLevel", () => {
  it("is clamp((rms - floor) * gain, 0, 1) for any RMS, finite or not", () => {
    fc.assert(
      // Mostly the RMS range that matters (unbounded doubles alone rarely land in 0.02-0.27).
      fc.property(fc.oneof(fc.double({ min: -0.1, max: 1.1, noNaN: true }), fc.double({ noNaN: false })), (value) => {
        const level = speechLevel(value);
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
        const expected = (value - SPEECH_FLOOR) * SPEECH_GAIN;
        if (Number.isFinite(expected)) expect(level).toBeCloseTo(Math.min(1, Math.max(0, expected)), 12);
        else expect(level).toBe(0);
      }),
    );
  });

  it("is monotonic, silent at and under the floor, and spans normal speech (RMS 0.05-0.3)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(speechLevel(lo)).toBeLessThanOrEqual(speechLevel(hi));
      }),
    );
    expect(speechLevel(SPEECH_FLOOR)).toBe(0);
    expect(speechLevel(0.05)).toBeCloseTo(0.12, 12);
    expect(speechLevel(0.3)).toBe(1);
  });
});

describe("a recorded line of Malakor (malakor-night/b00.wav)", () => {
  const { samples, rate } = decodeWav(readFileSync(WAV));
  /** One analyser frame per animation frame: 1024 samples, about 43 ms at 24 kHz. */
  const FRAME = 1024;
  const frames: number[] = [];
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) frames.push(rms(samples.subarray(i, i + FRAME)));
  const levels = frames.map(speechLevel);

  /** Drives the jaw through the line, one driver step per analyser frame. */
  const jaws = (input: (value: number) => number): number[] => {
    let s: DriverState = initialState(7);
    const out: number[] = [];
    for (const value of frames) {
      s = step(s, FRAME / rate, { level: input(value), gaze: "host", reducedMotion: true });
      out.push(s.jaw);
    }
    return out;
  };

  it("decodes to seconds of speech whose voiced RMS sits in 0.05-0.4", () => {
    expect(rate).toBe(24000);
    expect(samples.length / rate).toBeGreaterThan(5);
    const voiced = frames.filter((r) => r > SPEECH_FLOOR);
    expect(quantile(voiced, 0.5)).toBeGreaterThan(0.05);
    expect(quantile(voiced, 0.9)).toBeLessThan(0.4);
  });

  it("opens the jaw through its range: closed in pauses, past half for typical syllables, fully on peaks", () => {
    const jaw = jaws(speechLevel);
    expect(Math.min(...jaw)).toBeLessThan(0.01);
    expect(quantile(jaw, 0.75)).toBeGreaterThan(0.5);
    expect(Math.max(...jaw)).toBeGreaterThan(0.95);
    expect(Math.max(...levels)).toBe(1);
  });

  it("would have stayed under half open on the raw RMS (the bug the gain fixes)", () => {
    expect(Math.max(...jaws((value) => value))).toBeLessThan(0.5);
  });
});
