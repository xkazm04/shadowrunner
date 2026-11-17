// @vitest-environment happy-dom
/// <reference types="node" />
// The streaming speech analyser (perfection-pass, live lip-sync): a voice pushed in chunks reads as
// the batch analyser reads the whole clip, within STREAM_LATENCY_S; an audio tap with
// `{ shapes: true }` feeds it from its AnalyserNode and the player shows its shapes. Synthetic
// speech (speechSynth.ts), fake Web Audio nodes, a fake renderer: no audio device, no GL.
import { readFileSync } from "node:fs";
import { URL as FileUrl } from "node:url";
import { defaultLook, type Rig } from "@sr/rig";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachAudio, SPEECH_FLOOR } from "../audio/level.js";
import { dominant, MOUTH_SHAPES, restWeights, type ShapeWeights } from "../mouth/shapes.js";
import type { MouthShapesInput } from "../mouth/state.js";
import { runPlayer, type RendererFactory } from "../player/run.js";
import type { Renderer } from "../render/types.js";
import { analyseSpeech } from "../speech/analyse.js";
import { FRAME_S } from "../speech/features.js";
import { createSpeechStream, STREAM_LATENCY_S } from "../speech/stream.js";
import { fakeAssets, malakorRig } from "./malakor.js";
import { clipOf, hiss, silence, SYNTH_RATE, vowel, VOWELS } from "./speechSynth.js";

const mouthInputs = vi.hoisted(() => ({ seen: [] as (MouthShapesInput | undefined)[] }));
vi.mock("../mouth/state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mouth/state.js")>();
  return {
    ...actual,
    createMouthState: () => {
      const step = actual.createMouthState();
      return (p: Parameters<typeof step>[0]) => {
        mouthInputs.seen.push(p.input === undefined ? undefined : { ...p.input, shapes: { ...p.input.shapes } });
        return step(p);
      };
    },
  };
});

const { a, i, u, e, o } = VOWELS;
const SHAPES = MOUTH_SHAPES.length;

/** Mono 16-bit PCM WAV -> samples in [-1, 1] and the rate (as speech.analyse.test decodes it). */
function decodeWav(bytes: Uint8Array): { samples: Float32Array; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  let rate = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "fmt ") rate = view.getUint32(at + 12, true);
    if (tag(at) === "data") {
      const count = Math.floor(Math.min(size, bytes.length - at - 8) / 2);
      return { samples: Float32Array.from({ length: count }, (_, k) => view.getInt16(at + 8 + 2 * k, true) / 32768), rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}
/** Malakor's first replay line, kept as PCM beside its shipped .m4a (decoded here, never fetched; node's URL: happy-dom's cannot read a file URL). */
const recorded = decodeWav(readFileSync(new FileUrl("../../../../assets/replay/shows/malakor-night/b00.wav", import.meta.url)));

/** speech.analyse.test's clip, preceded by 0.3 s of /ae/ (the running normalisation's warm-up). */
const agreement = clipOf([
  ["warm", vowel(...a, 0.3)],
  ["rest", silence(0.3)],
  ["openWide", vowel(...a, 0.4)],
  ["rest", silence(0.2)],
  ["narrow", vowel(...i, 0.4)],
  ["rest", silence(0.2)],
  ["round", vowel(...u, 0.4)],
  ["rest", silence(0.2)],
  ["narrow", hiss(0.3)],
  ["rest", silence(0.2)],
  ["any", vowel(...e, 0.4)],
  ["rest", silence(0.2)],
  ["round", vowel(...o, 0.4)],
  ["rest", silence(0.3)],
]);
const spoken = agreement.spans.filter((span) => span.name !== "any" && span.name !== "rest" && span.name !== "warm");

const weightsAt = (mix: Float32Array, f: number): ShapeWeights => {
  const w = restWeights();
  MOUTH_SHAPES.forEach((shape, k) => (w[shape] = mix[f * SHAPES + k] ?? 0));
  return w;
};

/** The dominant shape of the mean mix over a span's middle third (frames at f * FRAME_S). */
function spanShape(at: (f: number) => ShapeWeights, span: { start: number; end: number }): string {
  const sum = restWeights();
  sum.rest = 0;
  const from = Math.ceil((span.start + (span.end - span.start) * 0.35) / FRAME_S);
  const to = Math.floor((span.start + (span.end - span.start) * 0.65) / FRAME_S);
  for (let f = from; f <= to; f += 1) {
    const w = at(f);
    for (const shape of MOUTH_SHAPES) sum[shape] += w[shape];
  }
  return dominant(sum);
}

/** Everything a stream emits for `samples` pushed at once, then `tail` s of silence. */
function streamAll(samples: Float32Array, rate: number, tail = 0.2): { mix: Float32Array; spoken: Float32Array } {
  const stream = createSpeechStream(rate);
  const first = stream.push(samples);
  const second = stream.push(new Float32Array(Math.round(tail * rate)));
  const mix = new Float32Array(first.mix.length + second.mix.length);
  mix.set(first.mix);
  mix.set(second.mix, first.mix.length);
  const share = new Float32Array(first.spoken.length + second.spoken.length);
  share.set(first.spoken);
  share.set(second.spoken, first.spoken.length);
  return { mix, spoken: share };
}

/** Each sample `k` times (a 16 kHz clip at 16k * k Hz, as speech.analyse.test does). */
const upsample = (samples: Float32Array, k: number): Float32Array => Float32Array.from({ length: samples.length * k }, (_, n) => samples[Math.floor(n / k)] ?? 0);

describe("createSpeechStream", () => {
  it("case 1: reads /ae/ between silences as open wide, and the silence after as rest", () => {
    const clip = clipOf([
      ["rest", silence(0.3)],
      ["openWide", vowel(...a, 0.4)],
      ["rest", silence(0.3)],
    ]);
    const { mix } = streamAll(clip.samples, SYNTH_RATE);
    expect(dominant(weightsAt(mix, Math.round(0.5 / FRAME_S)))).toBe("openWide");
    expect(weightsAt(mix, Math.round(0.95 / FRAME_S)).rest).toBeGreaterThanOrEqual(0.9);
  });

  it("case 3: the frame centred at t is out once samples up to t + STREAM_LATENCY_S are in (<= 0.1 s), at any rate", () => {
    expect(STREAM_LATENCY_S).toBeLessThanOrEqual(0.1);
    for (const rate of [16000, 44100, 48000, 8000]) {
      for (const t of [0, 0.25, 0.5, 1.37]) {
        const stream = createSpeechStream(rate);
        stream.push(new Float32Array(Math.ceil((t + STREAM_LATENCY_S) * rate)).fill(0.1));
        expect(stream.frames(), `${rate} Hz, t ${t}`).toBeGreaterThan(Math.round(t / FRAME_S));
      }
    }
  });

  it("case 4 (guard of the fitted weights): agrees with analyseSpeech on 5 of 5 spoken segments", () => {
    const batch = analyseSpeech(agreement.samples, SYNTH_RATE);
    const { mix } = streamAll(agreement.samples, SYNTH_RATE);
    expect(spoken).toHaveLength(5);
    for (const span of spoken) {
      const fromBatch = spanShape((f) => batch.at(f * FRAME_S), span);
      expect(fromBatch, `batch ${span.name}`).toBe(span.name);
      expect(spanShape((f) => weightsAt(mix, f), span), span.name).toBe(fromBatch);
    }
  });

  it("case 5: a voice that drops 20 dB keeps reading as speech once the running peak decays", () => {
    const clip = clipOf([
      ["loud", vowel(...a, 1, 0.3)],
      ["soft", vowel(...a, 3, 0.03)],
    ]);
    const stream = createSpeechStream(SYNTH_RATE);
    const { mix, spoken: share } = stream.push(clip.samples);
    const last = Math.floor(3 / FRAME_S);
    expect(share.length).toBeGreaterThan(last + 50);
    for (let f = last; f < share.length; f += 1) {
      expect(share[f], `frame ${f}`).toBeCloseTo(1, 6);
      expect(dominant(weightsAt(mix, f))).not.toBe("rest");
    }
  });

  it("case 6: an empty chunk and non-finite samples never throw; every mix sums to 1 and NaN reads as rest", () => {
    const stream = createSpeechStream(SYNTH_RATE);
    expect(stream.push(new Float32Array(0)).mix).toHaveLength(0);
    expect(stream.shapes().rest).toBe(1);
    const nan = new Float32Array(Math.round(0.4 * SYNTH_RATE)).fill(Number.NaN);
    nan[100] = Number.POSITIVE_INFINITY;
    const clip = clipOf([
      ["openWide", vowel(...a, 0.4)],
      ["nan", nan],
      ["rest", silence(0.3)],
    ]);
    const { mix } = stream.push(clip.samples);
    expect(stream.push(new Float32Array(0)).mix).toHaveLength(0);
    for (let f = 0; f < mix.length / SHAPES; f += 1) {
      const w = weightsAt(mix, f);
      expect(MOUTH_SHAPES.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 5);
      for (const k of MOUTH_SHAPES) expect(Number.isFinite(w[k])).toBe(true);
    }
    expect(weightsAt(mix, Math.round(0.6 / FRAME_S)).rest).toBeGreaterThanOrEqual(0.9);
    const shown = stream.shapes();
    expect(MOUTH_SHAPES.reduce((s, k) => s + shown[k], 0)).toBeCloseTo(1, 5);
  });

  it("guard: on the recorded replay line the stream's leading shape is the clip analyser's on >= 75 % of speech frames", () => {
    const batch = analyseSpeech(recorded.samples, recorded.rate);
    const { mix } = streamAll(recorded.samples, recorded.rate);
    let speech = 0;
    let agree = 0;
    for (let f = 0; f < mix.length / SHAPES; f += 1) {
      const fromBatch = batch.at(f * FRAME_S);
      const fromStream = weightsAt(mix, f);
      if (fromBatch.rest > 0.5 && fromStream.rest > 0.5) continue;
      speech += 1;
      if (dominant(fromBatch) === dominant(fromStream)) agree += 1;
    }
    expect(speech).toBeGreaterThan(500);
    expect(agree / speech).toBeGreaterThanOrEqual(0.75);
  });

  it("case 7: the clip at 48 kHz reads segment for segment as at 16 kHz (streaming resampler)", () => {
    const low = streamAll(agreement.samples, SYNTH_RATE).mix;
    const high = streamAll(upsample(agreement.samples, 3), SYNTH_RATE * 3).mix;
    for (const span of agreement.spans.filter((s) => s.name !== "any" && s.name !== "warm")) {
      expect(spanShape((f) => weightsAt(high, f), span), `${span.name} at ${span.start}`).toBe(spanShape((f) => weightsAt(low, f), span));
    }
  });
});

/** A context whose AnalyserNode shows the last `fftSize` samples of `clip` played up to `currentTime`. */
class ClipContext {
  currentTime = 0;
  readonly destination = {};
  readonly clip: Float32Array;
  readonly sampleRate: number;
  constructor(clip: Float32Array, sampleRate: number) {
    this.clip = clip;
    this.sampleRate = sampleRate;
  }
  createAnalyser() {
    return {
      fftSize: 0,
      connect: () => undefined,
      disconnect: () => undefined,
      getFloatTimeDomainData: (out: Float32Array) => {
        const end = Math.round(this.currentTime * this.sampleRate);
        for (let k = 0; k < out.length; k += 1) out[k] = this.clip[end - out.length + k] ?? 0;
      },
    };
  }
}

/** An AudioNode source in `context` (attachAudio taps it in its own context). */
const nodeIn = (context: ClipContext): AudioNode => ({ context, connect: () => undefined, disconnect: () => undefined }) as object as AudioNode;

/** Jittered poll gaps of 8-45 ms (a seeded LCG). */
function* jitter(seed = 11): Generator<number> {
  let s = seed;
  for (;;) {
    s = (s * 1103515245 + 12345) % 2147483648;
    yield 0.008 + (s / 2147483648) * 0.037;
  }
}

describe("attachAudio({ shapes: true })", () => {
  it("critic case: an AnalyserNode showing only its last LEVEL_FFT_SIZE samples, polled at 8-45 ms, reads as one push", () => {
    const context = new ClipContext(agreement.samples, SYNTH_RATE);
    const tap = attachAudio(nodeIn(context), { shapes: true });
    const reference = createSpeechStream(SYNTH_RATE, { gateRms: SPEECH_FLOOR });
    const once = createSpeechStream(SYNTH_RATE, { gateRms: SPEECH_FLOOR }).push(agreement.samples).mix;
    const polled = new Map<number, ShapeWeights>();
    let fed = 0;
    const gaps = jitter();
    while (context.currentTime < agreement.samples.length / SYNTH_RATE) {
      context.currentTime += gaps.next().value ?? 0.016;
      tap.level();
      const shown = tap.shapes?.();
      // Past the clip's end the analyser shows silence; so does the reference.
      const end = Math.round(context.currentTime * SYNTH_RATE);
      const next = new Float32Array(end - fed);
      next.set(agreement.samples.subarray(fed, end));
      reference.push(next);
      fed = end;
      expect(shown).toEqual(reference.shapes());
      if (shown !== undefined && reference.frames() > 0) polled.set(reference.frames() - 1, { ...shown });
    }
    for (const span of spoken) {
      const near = (f: number): ShapeWeights => {
        for (let d = 0; d < 5; d += 1) {
          const hit = polled.get(f + d) ?? polled.get(f - d);
          if (hit !== undefined) return hit;
        }
        return restWeights();
      };
      expect(spanShape(near, span), span.name).toBe(spanShape((f) => weightsAt(once, f), span));
    }
    tap.detach();
    expect(tap.shapes?.().rest).toBe(1);
  });

  it("without shapes: true the tap has no shapes()", () => {
    const tap = attachAudio(nodeIn(new ClipContext(agreement.samples, SYNTH_RATE)));
    expect(tap.shapes).toBeUndefined();
    tap.detach();
  });
});

describe("runPlayer with a shapes tap (case 8)", () => {
  const rig: Rig = { ...malakorRig(), mouth: { cx: 512, lineY: 600, width: 120, render: "drawn" } };
  const factory: RendererFactory = () =>
    ({
      setRig: () => undefined,
      setLook: () => undefined,
      draw: () => undefined,
      resize: () => undefined,
      info: () => ({ mode: "2d", drawCalls: 0, textureUploads: 0 }),
      dispose: () => undefined,
    }) satisfies Renderer;

  afterEach(() => {
    mouthInputs.seen.length = 0;
    document.body.replaceChildren();
  });

  function play(shapes: boolean): (MouthShapesInput | undefined)[] {
    const clip = clipOf([
      ["rest", silence(0.3)],
      ["openWide", vowel(...a, 0.6)],
    ]);
    const context = new ClipContext(clip.samples, SYNTH_RATE);
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const player = runPlayer(canvas, { rig, look: defaultLook(rig), assets: fakeAssets(rig), reducedMotion: false, autoSize: false }, factory);
    player.attachAudio(nodeIn(context), shapes ? { shapes: true } : {});
    mouthInputs.seen.length = 0;
    while (context.currentTime < 0.8) {
      context.currentTime += 1 / 60;
      player.renderFrame(1 / 60);
    }
    player.dispose();
    return [...mouthInputs.seen];
  }

  it("with shapes: true, a drawn mouth shows the tap's shapes: open wide on /ae/", () => {
    const last = play(true).at(-1);
    expect(last).toBeDefined();
    expect(dominant(last?.shapes ?? restWeights())).toBe("openWide");
  });

  it("guard: without shapes: true the mouth is the level drive, as today (no mix handed to the mouth)", () => {
    const seen = play(false);
    expect(seen.length).toBeGreaterThan(0);
    for (const input of seen) expect(input).toBeUndefined();
  });
});
