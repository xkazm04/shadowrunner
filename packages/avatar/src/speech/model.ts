// The shape classifier (perfection-pass task 4, lip-sync): per 10 ms frame, the log posterior of
// each of the eight mouth shapes given the sound around it (speech/features.ts's frames at
// FRAME_OFFSETS, i.e. +-80 ms of context). A linear model (weights.ts), so it is a few thousand
// multiply-adds per frame and the same on every machine. Pure, no DOM.
import { MOUTH_SHAPES } from "../mouth/shapes.js";
import { FEATURES, type SpeechFeatures } from "./features.js";
import { FRAME_OFFSETS, SHAPE_BIAS, SHAPE_WEIGHTS } from "./weights.js";

const SHAPES = MOUTH_SHAPES.length;

/** MOUTH_SHAPES.length log posteriors per frame (each frame's sum of exp is 1). */
export function shapeLogPosteriors(features: SpeechFeatures): Float32Array {
  const { values, frames } = features;
  const out = new Float32Array(frames * SHAPES);
  const z = new Float64Array(SHAPES);
  for (let t = 0; t < frames; t += 1) {
    for (let k = 0; k < SHAPES; k += 1) z[k] = SHAPE_BIAS[k] ?? 0;
    FRAME_OFFSETS.forEach((offset, o) => {
      const at = Math.min(frames - 1, Math.max(0, t + offset)) * FEATURES;
      for (let k = 0; k < SHAPES; k += 1) {
        const row = SHAPE_WEIGHTS[k];
        if (row === undefined) continue;
        let acc = 0;
        for (let d = 0; d < FEATURES; d += 1) acc += (row[o * FEATURES + d] ?? 0) * (values[at + d] ?? 0);
        z[k] = (z[k] ?? 0) + acc;
      }
    });
    let max = -Infinity;
    for (let k = 0; k < SHAPES; k += 1) max = Math.max(max, z[k] ?? 0);
    let sum = 0;
    for (let k = 0; k < SHAPES; k += 1) sum += Math.exp((z[k] ?? 0) - max);
    const norm = max + Math.log(sum);
    for (let k = 0; k < SHAPES; k += 1) out[t * SHAPES + k] = (z[k] ?? 0) - norm;
  }
  return out;
}
