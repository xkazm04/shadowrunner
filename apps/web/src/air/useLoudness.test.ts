// useLoudness (voice-and-air task 5.1): RMS of synthetic buffers -> jawOpen with attack 30 ms and
// release 90 ms. The analyser is replaced by a reader over the buffers; the RMS is @sr/avatar's.
import { rms } from "@sr/avatar";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createJawMeter, followJaw, JAW_ATTACK_MS, JAW_RELEASE_MS, jawTarget, RMS_FLOOR, RMS_FULL } from "./useLoudness";

const RATE = 48_000;
const FRAME = 2048;

/** One analyser frame of a sine at `amplitude`. */
function sine(amplitude: number, hz = 180): Float32Array {
  const out = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

const silence = () => new Float32Array(FRAME);

/** A reader that serves `frames` one per read, then silence. */
function reader(frames: Float32Array[]) {
  let i = 0;
  return { level: () => rms(frames[i++] ?? silence()) };
}

/** Reads the meter every `stepMs` for `count` frames; returns every jawOpen. */
function run(frames: Float32Array[], stepMs: number, count: number): number[] {
  const meter = createJawMeter(reader(frames));
  return Array.from({ length: count }, (_, k) => meter.read(k * stepMs));
}

describe("jawTarget", () => {
  it("is shut on silence and room noise, and full for loud speech", () => {
    expect(jawTarget(rms(silence()))).toBe(0);
    expect(jawTarget(rms(sine(RMS_FLOOR)))).toBe(0); // RMS of a sine is amplitude / sqrt 2
    expect(jawTarget(rms(sine(0.9)))).toBe(1);
  });

  it("rises with loudness and stays in [0, 1]", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(jawTarget(lo)).toBeLessThanOrEqual(jawTarget(hi));
        expect(jawTarget(hi)).toBeGreaterThanOrEqual(0);
        expect(jawTarget(hi)).toBeLessThanOrEqual(1);
      }),
    );
    expect(jawTarget(RMS_FULL)).toBe(1);
  });
});

describe("followJaw", () => {
  it("covers 95% of a rise in the attack time and of a fall in the release time", () => {
    expect(followJaw(0, 1, JAW_ATTACK_MS)).toBeCloseTo(0.95, 6);
    expect(followJaw(1, 0, JAW_RELEASE_MS)).toBeCloseTo(0.05, 6);
    // Release is slower than attack: the same 30 ms moves a fall less than a rise.
    expect(1 - followJaw(1, 0, JAW_ATTACK_MS)).toBeLessThan(followJaw(0, 1, JAW_ATTACK_MS));
  });

  it("never overshoots the target, never leaves [0, 1], and ignores bad time", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.oneof(fc.double({ min: 0, max: 1e4, noNaN: true }), fc.constantFrom(Number.NaN, -5, Number.POSITIVE_INFINITY)),
        (prev, target, dt) => {
          const next = followJaw(prev, target, dt);
          expect(next).toBeGreaterThanOrEqual(Math.min(prev, target) - 1e-12);
          expect(next).toBeLessThanOrEqual(Math.max(prev, target) + 1e-12);
          if (!(Number.isFinite(dt) && dt > 0)) expect(next).toBe(prev);
        },
      ),
    );
  });
});

describe("createJawMeter on synthetic buffers", () => {
  it("opens within the attack time on speech and closes within the release time after it", () => {
    const speech = Array.from({ length: 12 }, () => sine(0.5)); // 12 frames of loud speech (RMS 0.35), then silence
    const jaw = run(speech, 10, 30); // one read every 10 ms
    expect(jaw[0]).toBe(0); // the first read has no elapsed time
    expect(jaw[3]).toBeGreaterThan(0.9); // 30 ms in: at least 95% of the way (target 1)
    expect(jaw[11]).toBeGreaterThan(0.99);
    expect(jaw[12]).toBeLessThan(jaw[11] ?? 0); // the voice stops at frame 12
    expect(jaw[12 + 9]).toBeLessThan(0.06); // 90 ms later: within 5%
    expect(jaw[29]).toBeLessThan(0.01);
  });

  it("follows a quiet voice part of the way and keeps the jaw shut on silence", () => {
    const quiet = run(Array.from({ length: 20 }, () => sine(0.1)), 16, 20);
    const settled = quiet[19] ?? 0;
    expect(settled).toBeGreaterThan(0.1);
    expect(settled).toBeLessThan(0.5);
    expect(run([], 16, 20).every((v) => v === 0)).toBe(true);
  });
});
