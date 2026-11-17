// The streaming speech analyser (perfection-pass, live lip-sync): a live voice pushed in chunks of
// any size, read as the clip analyser (speech/analyse.ts) reads a whole clip, frame by frame, with
// STREAM_LATENCY_S of lookahead. What the live surfaces (a microphone, an audio tap with
// `{ shapes: true }`, audio/level.ts) show instead of the loudness jaw. Pure, no DOM.
//
// Decisions (where a stream cannot do what the clip does):
// - Same per-frame core: the clip's resampler taps, frames, cepstra (speech/features.ts
//   `frameFeatures`) and classifier (speech/model.ts `frameLogPosteriors`); only the normalisation
//   and the smoothing are causal.
// - Resampling carries its state across pushes (the low-pass's last taps, the interpolation's
//   position), so any partition of the same samples emits the same frames (chunk invariance).
// - Level: against a running peak that decays with time constant PEAK_DECAY_S (the clip uses its
//   loudest frame), so a voice that drops reads as speech again once the peak has come down.
// - Cepstral mean: a running mean of voiced frames (the clip uses its mean over all of them). It
//   starts at 0 (no correction) weighted as CMN_PRIOR_S of voice, so a first lone vowel keeps its
//   colour instead of cancelling to nothing, and settles to an exponential mean with time constant
//   CMN_S. Measured against the clip analyser on the recorded replay line (b00, 15.7 s), the
//   leading shape agrees on 79.5 % of its speech frames (a 2 s mean without the prior: 77 %;
//   a lone /ae/ read "tongue" without the prior).
// - Smoothing: the clip averages posteriors over +-POSTERIOR_SPAN frames; the stream averages the
//   last POSTERIOR_SPAN + 1 (a centred box would add 30 ms of latency past the classifier's 80 ms).
// - Frame f (centred at f * FRAME_S of the stream) is emitted once the classifier's last context
//   frame, f + 8, is complete: 8 * FRAME_S + half a 25 ms window, 92.5 ms, plus under a sample of
//   the resampler's own lookahead: STREAM_LATENCY_S.
// - Non-finite samples are silence. `gateRms` (audio/level.ts passes SPEECH_FLOOR): a frame whose
//   RMS is under it is silence too, fading in to speech at twice it - a decaying peak alone would
//   in time read a microphone's room tone as speech.
import { MOUTH_SHAPES, restWeights, type ShapeWeights } from "../mouth/shapes.js";
import { POSTERIOR_SPAN, QUIET_DB, SILENCE_DB } from "./analyse.js";
import { ANALYSIS_RATE, CEPSTRA, FEATURES, FLOOR_DB, FRAME_S, frameFeatures, HALF_WINDOW, HOP, lowPassFor, RAW, VOICED_DB } from "./features.js";
import { frameLogPosteriors } from "./model.js";
import { FRAME_OFFSETS } from "./weights.js";

/** Seconds of audio past a frame's centre the stream needs before it emits that frame (<= 0.1). */
export const STREAM_LATENCY_S = 0.095;
/** Time constant (s) of the running peak's decay. */
export const PEAK_DECAY_S = 2;
/** Time constant (s) of the running cepstral mean once settled. */
export const CMN_S = 5;
/** Seconds of voice the running cepstral mean's starting value (0) counts as. */
export const CMN_PRIOR_S = 1;

const SHAPES = MOUTH_SHAPES.length;
const REST = MOUTH_SHAPES.indexOf("rest");
const LOOKAHEAD = Math.max(...FRAME_OFFSETS);
const BEHIND = -Math.min(...FRAME_OFFSETS);
/** Normalised feature frames kept: the classifier's whole context. */
const RING = LOOKAHEAD + BEHIND + 1;
/** Posterior frames kept for the trailing box. */
const BOX = POSTERIOR_SPAN + 1;
const PEAK_STEP = Math.exp(-FRAME_S / PEAK_DECAY_S);
const CMN_FRAMES = CMN_S / FRAME_S;

export interface SpeechStreamOptions {
  /** Frames quieter than this RMS read as silence, fading in to speech at twice it (default 0: off). */
  gateRms?: number;
}

/** What one push completed: frames in order, frame i of the stream centred at i * FRAME_S. */
export interface StreamFrames {
  /** MOUTH_SHAPES.length weights per frame (each sums to 1), frame-major. */
  mix: Float32Array;
  /** Each frame's speech share, 0 (silence) to 1, smoothed as the mix is. */
  spoken: Float32Array;
}

export interface SpeechStream {
  /** Mono PCM in [-1, 1] at the stream's rate, the next samples after the last push. */
  push(chunk: Float32Array): StreamFrames;
  /** Frames emitted so far. */
  frames(): number;
  /** The newest frame's mix (rest before the first). Read only; the same object every call. */
  shapes(): ShapeWeights;
}

/** A sample tape with absolute positions; samples before `base` are gone, before 0 read as 0. */
class Tape {
  data = new Float32Array(1024);
  base = 0;
  length = 0;
  get end(): number {
    return this.base + this.length;
  }
  push(x: number): void {
    if (this.length === this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length] = x;
    this.length += 1;
  }
  at(i: number): number {
    return this.data[i - this.base] ?? 0;
  }
  /** Forgets samples before `i`. */
  dropBefore(i: number): void {
    const drop = Math.min(this.length, i - this.base);
    if (drop <= 0 || drop < this.data.length / 2) return;
    this.data.copyWithin(0, drop, this.length);
    this.base += drop;
    this.length -= drop;
  }
}

/** A stream of `sampleRate` audio (a non-positive or non-finite rate is treated as ANALYSIS_RATE). */
export function createSpeechStream(sampleRate: number, options: SpeechStreamOptions = {}): SpeechStream {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : ANALYSIS_RATE;
  const ratio = rate / ANALYSIS_RATE;
  const gate = Math.max(0, options.gateRms ?? 0);
  const lowPass = ratio > 1 ? lowPassFor(rate) : undefined;
  const source = new Tape();
  const filtered = lowPass === undefined ? source : new Tape();
  const analysis = new Tape();
  let nextOut = 0;

  const window = new Float32Array(2 * HALF_WINDOW);
  const raw = new Float64Array(RAW);
  const values = new Float32Array(RING * FEATURES);
  const keeps = new Float64Array(RING);
  const rows = new Int32Array(FRAME_OFFSETS.length);
  const logPost = new Float32Array(SHAPES);
  const probs = new Float64Array(BOX * (SHAPES + 1));
  const mean = new Float64Array(CEPSTRA);
  /** Voiced frames the mean has seen, the prior's included. */
  let voiced = CMN_PRIOR_S / FRAME_S;
  let peak = 1e-6;
  let features = 0;
  let emitted = 0;
  const latest = restWeights();

  /** Low-passes source samples whose taps are all in. */
  function filter(): void {
    if (lowPass === undefined) return;
    const { taps, half, sum } = lowPass;
    while (filtered.end + half < source.end) {
      const k = filtered.end;
      let acc = 0;
      for (let t = -half; t <= half; t += 1) acc += source.at(k + t) * (taps[t + half] ?? 0);
      filtered.push(acc / sum);
    }
    source.dropBefore(filtered.end - half);
  }

  /** Interpolates analysis-rate samples whose two neighbours are in. */
  function interpolate(): void {
    for (;;) {
      const x = nextOut * ratio;
      const k = Math.floor(x);
      if (k + 1 >= filtered.end) break;
      const f = x - k;
      analysis.push(filtered.at(k) * (1 - f) + filtered.at(k + 1) * f);
      nextOut += 1;
    }
    filtered.dropBefore(Math.floor(nextOut * ratio));
  }

  /** Feature frame g, normalised by what came before it, and its speech share into the ring. */
  function measure(g: number): void {
    const start = g * HOP - HALF_WINDOW;
    for (let i = 0; i < window.length; i += 1) window[i] = analysis.at(start + i);
    frameFeatures(window, 0, raw, 0);
    const energy = raw[0] ?? 0;
    peak = Math.max(peak * PEAK_STEP, energy, 1e-6);
    const db = Math.max(FLOOR_DB, 20 * Math.log10(energy / peak + 1e-9));
    const loud = gate > 0 ? Math.min(1, Math.max(0, (energy - gate) / gate)) : 1;
    if (db > VOICED_DB && loud > 0) {
      voiced += 1;
      const alpha = 1 / Math.min(voiced, CMN_FRAMES);
      for (let c = 0; c < CEPSTRA; c += 1) mean[c] = (mean[c] ?? 0) + alpha * ((raw[2 + c] ?? 0) - (mean[c] ?? 0));
    }
    const slot = g % RING;
    const at = slot * FEATURES;
    values[at] = db / 10;
    values[at + 1] = (raw[1] ?? 0) * 10;
    for (let c = 0; c < CEPSTRA; c += 1) values[at + 2 + c] = (raw[2 + c] ?? 0) - (mean[c] ?? 0);
    keeps[slot] = loud * Math.min(1, Math.max(0, (db - SILENCE_DB) / (QUIET_DB - SILENCE_DB)));
  }

  /** Frame f's mix (its context is in the ring) into out[f - first]. */
  function emit(f: number, mix: number[], spoken: number[]): void {
    FRAME_OFFSETS.forEach((offset, o) => (rows[o] = (Math.max(0, f + offset) % RING) * FEATURES));
    frameLogPosteriors(values, rows, logPost, 0);
    const keep = keeps[f % RING] ?? 0;
    const at = (f % BOX) * (SHAPES + 1);
    for (let k = 0; k < SHAPES; k += 1) probs[at + k] = keep * Math.exp(logPost[k] ?? -Infinity) + (k === REST ? 1 - keep : 0);
    probs[at + SHAPES] = keep;
    const span = Math.min(BOX, f + 1);
    for (let k = 0; k <= SHAPES; k += 1) {
      let acc = 0;
      for (let b = 0; b < span; b += 1) acc += probs[((f - b) % BOX) * (SHAPES + 1) + k] ?? 0;
      const v = Math.fround(acc / span);
      if (k < SHAPES) {
        mix.push(v);
        const shape = MOUTH_SHAPES[k];
        if (shape !== undefined) latest[shape] = v;
      } else spoken.push(v);
    }
  }

  return {
    push(chunk) {
      for (let i = 0; i < chunk.length; i += 1) {
        const x = chunk[i] ?? 0;
        source.push(Number.isFinite(x) ? x : 0);
      }
      filter();
      interpolate();
      const mix: number[] = [];
      const spoken: number[] = [];
      while (features * HOP + HALF_WINDOW <= analysis.end) {
        measure(features);
        features += 1;
        if (features - 1 - LOOKAHEAD >= emitted) {
          emit(emitted, mix, spoken);
          emitted += 1;
        }
      }
      analysis.dropBefore(features * HOP - HALF_WINDOW);
      return { mix: Float32Array.from(mix), spoken: Float32Array.from(spoken) };
    },
    frames: () => emitted,
    shapes: () => latest,
  };
}
