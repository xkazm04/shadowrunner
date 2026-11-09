// Real lip-sync (perfection-pass task 4, requirement 4.1): a decoded voice clip, and its text when
// known, turned into a timed mix of the eight mouth shapes (`MouthTrack`), React-free and pure.
// AvatarCanvas reads it on the clip's clock (`mouth` prop, speech/drive.ts); the stage, the
// creator's "speak a line" and the studio produce it (apps/web air/mouthTrack.ts, reach/studio).
//
// How (no TTS here gives phoneme timings, so the shapes come from the sound itself):
// 1. Frames: 10 ms steps of energy, zero crossings and cepstra (speech/features.ts).
// 2. Silence: a frame under SILENCE_DB against the clip's peak is rest, whatever the classifier
//    says, and speech fades in from rest up to QUIET_DB (room tone and breath are not words).
// 3. Classifier: a linear model reads +-80 ms of frames and gives each shape a probability
//    (speech/model.ts, weights.ts). Those probabilities, averaged over +-POSTERIOR_SPAN frames (the
//    coarticulation: a mouth glides, it never flicks), are the mix.
// 4. Text, when given: its shapes (speech/letters.ts) are aligned to the frames (speech/align.ts)
//    and the aligned shapes, crossfaded like the lab's viseme spans (mouth/track.ts), take
//    TEXT_SHARE of the mix; the classifier keeps the rest. Text knows WHICH shapes, the audio WHEN.
//
// How good, and how it was judged: against Kokoro's own phoneme timings (the Avatar Lab's voice,
// run locally: 101 sentences, 7 voices, 4.6 minutes; labels grouped to the eight shapes as the lab
// groups visemes, shifted 50 ms earlier because Kokoro's timings lag its audio), every voice scored
// by a model fitted without it. Frame-level shape agreement 46 % (chance 12.5 %). Correlation of the
// drawn mouth's jaw opening with the reference: 0.58 audio only, 0.57 with text; lip closure
// (press) 0.32 audio only, 0.47 with text; lip rounding 0.52 / 0.56; today's loudness drive scores
// jaw 0.30, press 0.00, rounding 0.23. So it is a clear step up from loudness, not phoneme-exact:
// shapes are right about half the time, the opening follows the speech, and closures land on
// p/b/m mostly when the text is known. Synthetic /ae/ /i/ /u/ /s/ /o/ read as openWide, narrow,
// round, narrow, round (speech.analyse.test.ts).
import { MOUTH_SHAPES, restWeights, type ShapeWeights } from "../mouth/shapes.js";
import { mixSpans, type ShapeSpan } from "../mouth/track.js";
import { alignShapes } from "./align.js";
import { FRAME_S, speechFeatures } from "./features.js";
import { textShapes } from "./letters.js";
import { shapeLogPosteriors } from "./model.js";

/** A clip's mouth: the shape mix at any time of the clip. */
export interface MouthTrack {
  /** The clip's length, seconds. */
  readonly durationS: number;
  /** The mix at `tS` seconds into the clip (sums to 1); rest outside [0, durationS]. */
  at(tS: number): ShapeWeights;
}

export interface AnalyseOptions {
  /** The words the clip speaks (English): sharpens which shapes, see TEXT_SHARE. */
  text?: string;
}

/** Frames each side averaged into a frame's mix. */
export const POSTERIOR_SPAN = 3;
/** The aligned text's share of the mix when text is given. */
export const TEXT_SHARE = 0.5;
/** Frames this far under the clip's loudest are silence; up to QUIET_DB the mix fades in from rest. */
export const SILENCE_DB = -55;
export const QUIET_DB = -45;

const SHAPES = MOUTH_SHAPES.length;
const REST = MOUTH_SHAPES.indexOf("rest");
const FRAME_MS = FRAME_S * 1000;

/** Runs of one shape as spans (frame i covers i*10 +-5 ms); rest runs are left out. */
function spansOf(shapes: Uint8Array): ShapeSpan[] {
  const spans: ShapeSpan[] = [];
  for (let i = 0; i < shapes.length; ) {
    let j = i;
    while (j < shapes.length && shapes[j] === shapes[i]) j += 1;
    const shape = MOUTH_SHAPES[shapes[i] ?? REST];
    if (shape !== undefined && shape !== "rest") spans.push({ shape, startMs: (i - 0.5) * FRAME_MS, endMs: (j - 0.5) * FRAME_MS });
    i = j;
  }
  return spans;
}

/** A track over `mix` (SHAPES weights per frame, frame i at i * FRAME_S). */
export function trackOf(mix: Float32Array, durationS: number): MouthTrack {
  const frames = Math.floor(mix.length / SHAPES);
  return {
    durationS,
    at(tS) {
      const out = restWeights();
      if (!(tS >= 0 && tS <= durationS) || frames === 0) return out;
      const x = Math.min(frames - 1, tS / FRAME_S);
      const i = Math.floor(x);
      const f = x - i;
      const j = Math.min(frames - 1, i + 1);
      MOUTH_SHAPES.forEach((shape, k) => {
        out[shape] = (mix[i * SHAPES + k] ?? 0) * (1 - f) + (mix[j * SHAPES + k] ?? 0) * f;
      });
      return out;
    },
  };
}

/** The clip's mouth track. `samples` is mono PCM in [-1, 1] at `sampleRate`. */
export function analyseSpeech(samples: Float32Array, sampleRate: number, options: AnalyseOptions = {}): MouthTrack {
  const durationS = sampleRate > 0 ? samples.length / sampleRate : 0;
  const features = speechFeatures(samples, sampleRate);
  return trackOf(mixOf(shapeLogPosteriors(features), features.db, options.text), durationS);
}

/**
 * Steps 2-4 above: SHAPES weights per frame from the classifier's log posteriors, each frame's
 * level (dB under the clip's peak) and the text. Exported for the fitting harness, which scores
 * held-out voices with their own weights.
 */
export function mixOf(logPost: Float32Array, db: Float32Array, text: string | undefined): Float32Array {
  const frames = Math.floor(logPost.length / SHAPES);
  const mix = new Float32Array(frames * SHAPES);

  // Step 4 first, per frame: how much of a frame is speech (0 under SILENCE_DB, 1 from QUIET_DB).
  const keep = new Float64Array(frames);
  for (let t = 0; t < frames; t += 1) keep[t] = Math.min(1, Math.max(0, ((db[t] ?? SILENCE_DB) - SILENCE_DB) / (QUIET_DB - SILENCE_DB)));

  // The classifier's probabilities (rest for the share that is not speech), box-averaged over
  // +-POSTERIOR_SPAN frames with running sums; the last column carries the smoothed speech share.
  const cols = SHAPES + 1;
  const sums = new Float64Array((frames + 1) * cols);
  for (let t = 0; t < frames; t += 1) {
    const k0 = keep[t] ?? 0;
    for (let k = 0; k < SHAPES; k += 1) {
      const p = k0 * Math.exp(logPost[t * SHAPES + k] ?? -Infinity) + (k === REST ? 1 - k0 : 0);
      sums[(t + 1) * cols + k] = (sums[t * cols + k] ?? 0) + p;
    }
    sums[(t + 1) * cols + SHAPES] = (sums[t * cols + SHAPES] ?? 0) + k0;
  }
  const spoken = new Float64Array(frames);
  for (let t = 0; t < frames; t += 1) {
    const a = Math.max(0, t - POSTERIOR_SPAN);
    const b = Math.min(frames, t + POSTERIOR_SPAN + 1);
    for (let k = 0; k <= SHAPES; k += 1) {
      const v = ((sums[b * cols + k] ?? 0) - (sums[a * cols + k] ?? 0)) / (b - a);
      if (k < SHAPES) mix[t * SHAPES + k] = v;
      else spoken[t] = v;
    }
  }

  const words = text === undefined ? [] : textShapes(text);
  const aligned = words.length === 0 ? undefined : alignShapes(logPost, words);
  if (aligned !== undefined) {
    const spans = spansOf(aligned);
    let from = 0;
    for (let t = 0; t < frames; t += 1) {
      const now = t * FRAME_MS;
      while (from < spans.length && (spans[from]?.endMs ?? 0) + FRAME_MS * 5 < now) from += 1;
      const said = mixSpans(spans, now, { from, sorted: true });
      const share = spoken[t] ?? 0;
      MOUTH_SHAPES.forEach((shape, k) => {
        const fromText = share * said[shape] + (k === REST ? 1 - share : 0);
        mix[t * SHAPES + k] = TEXT_SHARE * fromText + (1 - TEXT_SHARE) * (mix[t * SHAPES + k] ?? 0);
      });
    }
  }
  return mix;
}
