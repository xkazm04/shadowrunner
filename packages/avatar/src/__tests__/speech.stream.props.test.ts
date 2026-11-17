// The streaming speech analyser is chunk-invariant (case 2): any partition of a clip into pushes of
// 1..4096 samples emits, frame for frame, exactly what one push of the whole clip does - at the
// analysis rate and through the streaming resampler (a non-integer 44.1 kHz ratio).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSpeechStream } from "../speech/stream.js";
import { clipOf, hiss, silence, SYNTH_RATE, vowel, VOWELS } from "./speechSynth.js";

const { a, i, u } = VOWELS;
/** 2 s of synthetic speech at 16 kHz. */
const clip = clipOf([
  ["rest", silence(0.2)],
  ["a", vowel(...a, 0.4)],
  ["i", vowel(...i, 0.3)],
  ["s", hiss(0.2)],
  ["u", vowel(...u, 0.4, 0.05)],
  ["rest", silence(0.5)],
]).samples;
const CD = 44100;
/** The clip at 44.1 kHz (nearest sample). */
const cd = Float32Array.from({ length: Math.floor((clip.length * CD) / SYNTH_RATE) }, (_, n) => clip[Math.floor((n * SYNTH_RATE) / CD)] ?? 0);

function inChunks(samples: Float32Array, rate: number, sizes: readonly number[]): { mix: number[]; spoken: number[] } {
  const stream = createSpeechStream(rate);
  const mix: number[] = [];
  const spoken: number[] = [];
  let at = 0;
  for (let k = 0; at < samples.length; k += 1) {
    const size = sizes[k % sizes.length] ?? 1;
    const out = stream.push(samples.subarray(at, at + size));
    mix.push(...out.mix);
    spoken.push(...out.spoken);
    at += size;
  }
  return { mix, spoken };
}

describe("createSpeechStream chunk invariance", () => {
  for (const [name, samples, rate] of [
    ["16 kHz", clip, SYNTH_RATE],
    ["44.1 kHz", cd, CD],
  ] as const) {
    const whole = inChunks(samples, rate, [samples.length]);
    it(`${name}: any partition into chunks of 1..4096 samples emits what one push does`, () => {
      expect(whole.mix.length).toBeGreaterThan(150 * 8);
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 1, max: 4096 }), { minLength: 1, maxLength: 24 }), (sizes) => {
          const parts = inChunks(samples, rate, sizes);
          expect(parts.mix).toEqual(whole.mix);
          expect(parts.spoken).toEqual(whole.spoken);
        }),
        { numRuns: 25 },
      );
    });
  }
});
