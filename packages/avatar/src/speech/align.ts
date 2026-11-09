// Text to audio alignment (perfection-pass task 4, lip-sync): the line's shapes (speech/letters.ts)
// laid over the clip's frames by Viterbi, so a known "p" lands on the closure the audio shows and
// a known "oo" on the vowel after it. Pure, no DOM.
//
// Decisions:
// - States, in order: an optional rest, then each word's shapes, then an optional rest after every
//   word (skippable: connected speech has no gap between most words). Every frame belongs to one
//   state and the path only moves forward, one state per frame or over a skipped rest.
// - Emission: the classifier's log posterior of the state's shape (speech/model.ts). Duration: a
//   geometric prior whose mean is the clip's frames over the line's shapes (each shape has an equal
//   share a priori; the audio moves the boundaries).
// - Cost guard: past MAX_CELLS (frames x states) the alignment is not run and the caller keeps the
//   classifier's own reading (a minute-long monologue would need tens of MB).
import { MOUTH_SHAPES, type MouthShape } from "../mouth/shapes.js";

export const MAX_CELLS = 4_000_000;
const SHAPES = MOUTH_SHAPES.length;
const REST = MOUTH_SHAPES.indexOf("rest");

/**
 * The shape index (MOUTH_SHAPES order) of every frame, or undefined when the line has no shapes or
 * the alignment would cost too much. `logPost` holds MOUTH_SHAPES.length log posteriors per frame.
 */
export function alignShapes(logPost: Float32Array, words: readonly (readonly MouthShape[])[]): Uint8Array | undefined {
  const frames = Math.floor(logPost.length / SHAPES);
  const shape: number[] = [REST];
  const optional: boolean[] = [true];
  for (const word of words) {
    for (const s of word) {
      shape.push(MOUTH_SHAPES.indexOf(s));
      optional.push(false);
    }
    shape.push(REST);
    optional.push(true);
  }
  const states = shape.length;
  const spoken = states - (words.length + 1);
  if (frames === 0 || spoken === 0 || frames * states > MAX_CELLS) return undefined;
  const mean = Math.max(2, frames / spoken);
  const stay = Math.log(1 - 1 / mean);
  const move = Math.log(1 / mean);
  let prev = new Float64Array(states).fill(Infinity);
  let cur = new Float64Array(states);
  const back = new Int32Array(frames * states);
  const emit = (t: number, j: number): number => -(logPost[t * SHAPES + (shape[j] ?? REST)] ?? 0);
  prev[0] = emit(0, 0);
  if (states > 1) prev[1] = emit(0, 1);
  for (let t = 1; t < frames; t += 1) {
    for (let j = 0; j < states; j += 1) {
      let best = (prev[j] ?? Infinity) - (optional[j] === true ? 0 : stay);
      let from = j;
      if (j >= 1) {
        const c = (prev[j - 1] ?? Infinity) - move;
        if (c < best) {
          best = c;
          from = j - 1;
        }
      }
      if (j >= 2 && optional[j - 1] === true) {
        const c = (prev[j - 2] ?? Infinity) - move;
        if (c < best) {
          best = c;
          from = j - 2;
        }
      }
      cur[j] = best + emit(t, j);
      back[t * states + j] = from;
    }
    [prev, cur] = [cur, prev];
  }
  // End in the last word's shape or the rest after it.
  let j = (prev[states - 1] ?? Infinity) <= (prev[states - 2] ?? Infinity) ? states - 1 : states - 2;
  if (!Number.isFinite(prev[j] ?? Infinity)) return undefined;
  const out = new Uint8Array(frames);
  for (let t = frames - 1; t >= 0; t -= 1) {
    out[t] = shape[j] ?? REST;
    j = back[t * states + j] ?? 0;
  }
  return out;
}
