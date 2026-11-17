// The shape classifier (perfection-pass task 4, lip-sync): per 10 ms frame, the log posterior of
// each of the eight mouth shapes given the sound around it (speech/features.ts's frames at
// FRAME_OFFSETS, i.e. +-80 ms of context). A linear model (weights.ts), so it is a few thousand
// multiply-adds per frame and the same on every machine. Pure, no DOM. `frameLogPosteriors` is the
// per-frame core: the whole clip below, the live stream (speech/stream.ts) one frame at a time.
import { MOUTH_SHAPES } from "../mouth/shapes.js";
import { FEATURES, type SpeechFeatures } from "./features.js";
import { FRAME_OFFSETS, SHAPE_BIAS, SHAPE_WEIGHTS } from "./weights.js";

const SHAPES = MOUTH_SHAPES.length;
const z = new Float64Array(SHAPES);

/**
 * One frame's MOUTH_SHAPES.length log posteriors into out[at ..): `rows[o]` is where, in `values`,
 * the features of the frame at FRAME_OFFSETS[o] start (the caller clamps at the edges).
 */
export function frameLogPosteriors(values: ArrayLike<number>, rows: ArrayLike<number>, out: Float32Array, at: number): void {
  for (let k = 0; k < SHAPES; k += 1) z[k] = SHAPE_BIAS[k] ?? 0;
  FRAME_OFFSETS.forEach((_, o) => {
    const row = rows[o] ?? 0;
    for (let k = 0; k < SHAPES; k += 1) {
      const weights = SHAPE_WEIGHTS[k];
      if (weights === undefined) continue;
      let acc = 0;
      for (let d = 0; d < FEATURES; d += 1) acc += (weights[o * FEATURES + d] ?? 0) * (values[row + d] ?? 0);
      z[k] = (z[k] ?? 0) + acc;
    }
  });
  let max = -Infinity;
  for (let k = 0; k < SHAPES; k += 1) max = Math.max(max, z[k] ?? 0);
  let sum = 0;
  for (let k = 0; k < SHAPES; k += 1) sum += Math.exp((z[k] ?? 0) - max);
  const norm = max + Math.log(sum);
  for (let k = 0; k < SHAPES; k += 1) out[at + k] = (z[k] ?? 0) - norm;
}

/** MOUTH_SHAPES.length log posteriors per frame (each frame's sum of exp is 1). */
export function shapeLogPosteriors(features: SpeechFeatures): Float32Array {
  const { values, frames } = features;
  const out = new Float32Array(frames * SHAPES);
  const rows = new Int32Array(FRAME_OFFSETS.length);
  for (let t = 0; t < frames; t += 1) {
    FRAME_OFFSETS.forEach((offset, o) => (rows[o] = Math.min(frames - 1, Math.max(0, t + offset)) * FEATURES));
    frameLogPosteriors(values, rows, out, t * SHAPES);
  }
  return out;
}
