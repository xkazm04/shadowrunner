/// <reference types="node" />
// The clip analyser (perfection-pass task 4, requirement 4.1): synthetic vowels read as the shapes
// a mouth makes for them, silence is rest, the mix is a partition of unity that never jumps, and a
// recorded replay line (Malakor's show, decoded here, never fetched) moves the jaw through its range.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blendParams, dominant, MOUTH_SHAPES, type ShapeWeights } from "../mouth/shapes.js";
import { analyseSpeech, mixOf, trackOf, type MouthTrack } from "../speech/analyse.js";
import { speechFeatures } from "../speech/features.js";
import { shapeLogPosteriors } from "../speech/model.js";
import { clipOf, hiss, silence, SYNTH_RATE, vowel, VOWELS } from "./speechSynth.js";

const { a, i, u, e, o } = VOWELS;
// Several vowels in one clip: the features remove the clip's mean timbre, so a lone vowel has no
// contrast to read (as a lone word would not). /e/ is there for that mean; its reading is not asserted.
const synth = clipOf([
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
const asserted = synth.spans.filter((span) => span.name !== "any");

/** Mono 16-bit PCM WAV -> samples in [-1, 1] and the rate. */
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

const SHOW = JSON.parse(readFileSync(new URL("../../../../assets/replay/shows/malakor-night.json", import.meta.url), "utf8")) as { beats: { wav: string; reply: { line: string } }[] };
const beat = SHOW.beats[0];
if (beat === undefined) throw new Error("the replay show has no beats");
// The shipped clip is AAC (.m4a, perfection-pass task 10); b00.wav is kept beside it as the PCM test source.
const recorded = decodeWav(readFileSync(new URL(`../../../../assets/replay/shows/${beat.wav.replace(/\.m4a$/, ".wav")}`, import.meta.url)));

/** Every 10 ms of the track: sums to 1, no negative weight, and no shape moves more than `step`. */
function expectSmoothUnity(track: MouthTrack, step: number): void {
  let prev: ShapeWeights | undefined;
  for (let t = 0; t <= track.durationS; t += 0.01) {
    const w = track.at(t);
    expect(MOUTH_SHAPES.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 5);
    for (const k of MOUTH_SHAPES) {
      expect(w[k]).toBeGreaterThanOrEqual(-1e-6);
      if (prev !== undefined) expect(Math.abs(w[k] - prev[k]), `${k} at ${t.toFixed(2)} s`).toBeLessThanOrEqual(step);
    }
    prev = w;
  }
}

describe("analyseSpeech", () => {
  it("reads synthetic /ae/ /i/ /u/ /s/ /o/ as open wide, narrow, round, narrow, round, and silence as rest", () => {
    const track = analyseSpeech(synth.samples, SYNTH_RATE);
    expect(track.durationS).toBeCloseTo(synth.samples.length / SYNTH_RATE, 9);
    for (const span of asserted) {
      for (const f of [0.35, 0.5, 0.65]) {
        const w = track.at(span.start + (span.end - span.start) * f);
        expect(dominant(w), `${span.name} at ${f}`).toBe(span.name);
        if (span.name === "rest") expect(w.rest).toBe(1);
      }
    }
  });

  it("is rest outside the clip and for a silent or empty clip", () => {
    const track = analyseSpeech(synth.samples, SYNTH_RATE);
    expect(track.at(-0.1).rest).toBe(1);
    expect(track.at(track.durationS + 0.01).rest).toBe(1);
    expect(track.at(Number.NaN).rest).toBe(1);
    expect(analyseSpeech(silence(0.5), SYNTH_RATE).at(0.25).rest).toBe(1);
    const empty = analyseSpeech(new Float32Array(0), SYNTH_RATE);
    expect(empty.durationS).toBe(0);
    expect(empty.at(0).rest).toBe(1);
  });

  it("is a partition of unity that glides: no shape moves more than 0.3 in 10 ms (coarticulation)", () => {
    expectSmoothUnity(analyseSpeech(synth.samples, SYNTH_RATE), 0.3);
    expectSmoothUnity(analyseSpeech(recorded.samples, recorded.rate), 0.3);
    expectSmoothUnity(analyseSpeech(recorded.samples, recorded.rate, { text: beat.reply.line }), 0.3);
  });

  it("opens the jaw through its range on a recorded replay line and shuts it in the pauses", () => {
    const track = analyseSpeech(recorded.samples, recorded.rate, { text: beat.reply.line });
    const { db } = speechFeatures(recorded.samples, recorded.rate);
    const jaws: number[] = [];
    for (let f = 0; f < db.length; f += 1) {
      const jaw = blendParams(track.at(f / 100)).jaw;
      jaws.push(jaw);
      if ((db[f] ?? 0) < -60 && (db[Math.max(0, f - 4)] ?? 0) < -60 && (db[f + 4] ?? -70) < -60) expect(jaw).toBeLessThan(0.02);
    }
    const sorted = [...jaws].sort((x, y) => x - y);
    expect(sorted[Math.floor(sorted.length * 0.9)]).toBeGreaterThan(0.3);
    // More than the loudness drive's one shape: at least five shapes lead somewhere in the line.
    const leaders = new Set(jaws.map((_, f) => dominant(track.at(f / 100))));
    expect(leaders.size).toBeGreaterThanOrEqual(5);
  });

  it("aligns the text: the line's shapes take TEXT_SHARE, and text with no letters changes nothing", () => {
    const features = speechFeatures(recorded.samples, recorded.rate);
    const logPost = shapeLogPosteriors(features);
    const audio = mixOf(logPost, features.db, undefined);
    expect(mixOf(logPost, features.db, " ... ")).toEqual(audio);
    const said = mixOf(logPost, features.db, beat.reply.line);
    expect(said).not.toEqual(audio);
    expect(trackOf(said, 1).at(0.5)).toEqual(trackOf(said, 1).at(0.5));
  });

  it("is deterministic and resamples any rate to the same reading", () => {
    const once = analyseSpeech(recorded.samples, recorded.rate);
    const again = analyseSpeech(recorded.samples, recorded.rate);
    for (let t = 0; t < 2; t += 0.05) expect(again.at(t)).toEqual(once.at(t));
    // The synthetic clip at 48 kHz (each sample three times) reads as it does at 16 kHz.
    const up = Float32Array.from({ length: synth.samples.length * 3 }, (_, k) => synth.samples[Math.floor(k / 3)] ?? 0);
    const track = analyseSpeech(up, SYNTH_RATE * 3);
    for (const span of asserted) expect(dominant(track.at((span.start + span.end) / 2)), span.name).toBe(span.name);
  });
});
