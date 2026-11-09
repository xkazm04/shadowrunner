// Spelling to mouth shapes (perfection-pass task 4, lip-sync): the line's text read as the sequence
// of shapes a speaker's lips pass through, word by word, for the aligner (speech/align.ts) to lay
// over the audio. Pure, no DOM. English only.
//
// Decisions:
// - No pronouncing dictionary ships (the product has no phonemes anywhere): a short list of the
//   commonest words, then letter rules longest-first, the way the shapes group sounds (the lab's
//   Oculus-15 grouping, apps/lab/src/page/lip/mouth/shapes.ts): p b m close the lips; f v bite;
//   th t d n l show the tongue; s z sh ch j are narrow; r w oo o are round; a and "ow" open wide;
//   e, k, g, h open mid. A final silent e lengthens the vowel before it (a_e -> open mid, i_e -> wide).
// - Doubled letters count once and neighbouring repeats merge: a shape is a mouth position, not a
//   letter. Digits read as one generic word.
// - The result is a guide, not a transcript: the aligner may skip nothing in a word, but the audio
//   decides how long each shape lasts, and the classifier's own reading is mixed in after.
import type { MouthShape } from "../mouth/shapes.js";

const W: MouthShape = "openWide";
const M: MouthShape = "openMid";
const R: MouthShape = "round";
const C: MouthShape = "closed";
const F: MouthShape = "teeth";
const T: MouthShape = "tongue";
const N: MouthShape = "narrow";

const WORDS: Readonly<Record<string, readonly MouthShape[]>> = {
  the: [T, M], a: [M], an: [M, T], and: [W, T], to: [T, R], of: [M, F], i: [W], you: [N, R], your: [N, R], is: [N], it: [N, T],
  in: [N, T], my: [C, W], me: [C, N], we: [R, N], he: [M, N], she: [N], be: [C, N], are: [W, R], was: [R, W, N], were: [R],
  have: [M, W, F], one: [R, W, T], said: [N, M, T], do: [T, R], does: [T, W, N], for: [F, R], not: [T, W, T], no: [T, R],
  so: [N, R], what: [R, W, T], who: [M, R], there: [T, M, R], their: [T, M, R], they: [T, M], this: [T, N], that: [T, W, T],
  with: [R, N, T], all: [R, T], or: [R], but: [C, W, T], if: [N, F], as: [W, N], at: [W, T], on: [W, T], by: [C, W], up: [W, C],
  out: [W, T], our: [W, R], eye: [W], been: [C, N, T], from: [F, R, W, C], will: [R, N, T], can: [M, W, T], would: [R, T],
  should: [N, R, T], could: [M, R, T], some: [N, W, C], come: [M, W, C], done: [T, W, T], gone: [M, W, T], two: [T, R],
};

/** Letter groups, longest first where one is a prefix of another. */
const RULES: readonly (readonly [string, readonly MouthShape[]])[] = [
  ["tion", [N, M, T]], ["sion", [N, M, T]], ["igh", [W]], ["tch", [N]], ["th", [T]], ["sh", [N]], ["ch", [N]], ["ph", [F]],
  ["wh", [R]], ["qu", [M, R]], ["ng", [M]], ["ck", [M]], ["gh", []], ["kn", [T]], ["wr", [R]],
  ["oo", [R]], ["ue", [R]], ["ui", [R]], ["ou", [W]], ["ow", [W]], ["oa", [R]], ["oi", [R]], ["oy", [R]],
  ["ee", [N]], ["ea", [N]], ["ie", [N]], ["ei", [M]], ["ey", [M]], ["ai", [M]], ["ay", [M]],
  ["au", [R]], ["aw", [R]], ["er", [R]], ["ir", [R]], ["ur", [R]], ["ar", [W, R]], ["or", [R]],
  ["a", [W]], ["e", [M]], ["i", [N]], ["o", [R]], ["u", [W]], ["y", [N]],
  ["p", [C]], ["b", [C]], ["m", [C]], ["f", [F]], ["v", [F]], ["t", [T]], ["d", [T]], ["n", [T]], ["l", [T]],
  ["s", [N]], ["z", [N]], ["j", [N]], ["x", [M, N]], ["k", [M]], ["g", [M]], ["q", [M]], ["h", [M]], ["r", [R]], ["w", [R]],
];

/** The long vowel a final silent e makes (a_e, i_e, o_e, u_e, e_e). */
const LONG: Readonly<Record<string, MouthShape>> = { a: M, i: W, o: R, u: R, e: N };
/** Stand-ins for a rewritten long vowel inside the word. */
const LONG_MARK = "1";
const WIDE_MARK = "2";

/** One lower-case word's shapes, neighbours merged. */
export function wordShapes(word: string): MouthShape[] {
  const known = WORDS[word];
  if (known !== undefined) return [...known];
  let w = word;
  let long: MouthShape | undefined;
  const magic = /([aeiou])([^aeiouwy])e$/.exec(w);
  if (magic !== null && w.length > 3) {
    long = LONG[magic[1] ?? ""];
    w = `${w.slice(0, magic.index)}${LONG_MARK}${magic[2] ?? ""}`;
  }
  if (/[^aeiou]le$/.test(w)) w = `${w.slice(0, -2)}l`;
  if (/[^aeiouy]y$/.test(w) && !/[aeiou]/.test(w.slice(0, -1))) w = `${w.slice(0, -1)}${WIDE_MARK}`;
  const shapes: MouthShape[] = [];
  for (let i = 0; i < w.length; ) {
    const ch = w[i] ?? "";
    if (ch === LONG_MARK && long !== undefined) {
      shapes.push(long);
      i += 1;
      continue;
    }
    if (ch === WIDE_MARK) {
      shapes.push(W);
      i += 1;
      continue;
    }
    if (i > 0 && ch === w[i - 1]) {
      i += 1;
      continue;
    }
    const rule = RULES.find(([letters]) => w.startsWith(letters, i));
    if (rule === undefined && ch === "c") shapes.push(/[eiy]/.test(w[i + 1] ?? "") ? N : M);
    if (rule !== undefined) shapes.push(...rule[1]);
    i += rule?.[0].length ?? 1;
  }
  return shapes.filter((shape, i) => i === 0 || shape !== shapes[i - 1]);
}

/** The line's words as shapes, in order (words with no shape are dropped). */
export function textShapes(text: string): MouthShape[][] {
  const words: MouthShape[][] = [];
  for (const match of text.toLowerCase().matchAll(/[a-z']+|[0-9]+/g)) {
    const raw = match[0].replace(/'/g, "");
    const shapes = wordShapes(/^[0-9]+$/.test(raw) ? "number" : raw);
    if (shapes.length > 0) words.push(shapes);
  }
  return words;
}
