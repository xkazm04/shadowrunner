// Fits the shape classifier on the corpus and writes packages/avatar/src/speech/weights.ts. Labels
// are Kokoro's own phoneme timings grouped into the eight shapes, 50 ms earlier (corpus.ts). The
// leave-one-voice-out figure (each voice scored by a model fitted without it) is printed first and
// written into the weights' header.
//   node --import ./apps/lab/src/hooks.mjs scripts/lipfit/train.ts <corpus.jsonl> <sentences.jsonl> [weights.ts]
import { writeFileSync } from "node:fs";
import { MOUTH_SHAPES, type MouthShape } from "../../packages/avatar/src/mouth/shapes.ts";
import { speechFeatures } from "../../packages/avatar/src/speech/features.ts";
import { OFFSETS, labels, loadCorpus, stack } from "./corpus.ts";
import { fit, logp } from "./lr.ts";

const [corpusPath, sentencesPath, out = "packages/avatar/src/speech/weights.ts"] = process.argv.slice(2);
if (corpusPath === undefined || sentencesPath === undefined) throw new Error("usage: train.ts <corpus.jsonl> <sentences.jsonl> [weights.ts]");

const FIT = { epochs: 15, lr: 0.003 };
const shapeIndex = (s: MouthShape) => MOUTH_SHAPES.indexOf(s);
const argmax = (a: readonly number[]) => a.indexOf(Math.max(...a));

const clips = loadCorpus(corpusPath, sentencesPath);
const data = clips.map((c) => {
  const f = speechFeatures(c.samples, c.rate);
  return { c, X: stack(f.values, f.frames), y: labels(c, f.frames).map(shapeIndex) };
});
const voices = [...new Set(clips.map((c) => c.voice))];

let ok = 0;
let tot = 0;
for (const v of voices) {
  const tr = data.filter((d) => d.c.voice !== v);
  const net = fit(tr.flatMap((d) => d.X), tr.flatMap((d) => d.y), MOUTH_SHAPES.length, FIT);
  for (const d of data.filter((x) => x.c.voice === v)) {
    d.X.forEach((x, i) => {
      if (argmax(logp(net, x)) === d.y[i]) ok++;
      tot++;
    });
  }
}
console.log("LOVO frame acc", (ok / tot).toFixed(3), "frames", tot);

const net = fit(data.flatMap((d) => d.X), data.flatMap((d) => d.y), MOUTH_SHAPES.length, FIT);
// Fold the normalisation into the weights, so the package reads raw features.
const sdOf = (d: number) => net.sd[d] ?? 1;
const muOf = (d: number) => net.mu[d] ?? 0;
const W = net.W.map((row) => row.map((w, d) => w / sdOf(d)));
const b = net.b.map((bk, k) => bk - (net.W[k] ?? []).reduce((s, w, d) => s + (w * muOf(d)) / sdOf(d), 0));
const r = (x: number) => Number(x.toPrecision(4));
const rows = W.map((row, k) => `  // ${MOUTH_SHAPES[k] ?? k}\n  [${row.map(r).join(", ")}],`).join("\n");
writeFileSync(
  out,
  `// The shape classifier's fitted weights (perfection-pass task 4; generated, do not edit by hand).
// A multinomial logistic regression over speech/features.ts's frames stacked at FRAME_OFFSETS: one
// row per mouth shape (MOUTH_SHAPES order), FEATURES x FRAME_OFFSETS.length weights each, the
// feature normalisation folded in. Fitted on ${tot} frames (${clips.length} Kokoro sentences, ${voices.length} voices) whose labels are
// Kokoro's own phoneme timings grouped into the eight shapes; held-out-voice frame accuracy ${(ok / tot).toFixed(3)}
// (chance 0.125). How it was made and judged: speech/analyse.ts.
export const FRAME_OFFSETS = [${OFFSETS.join(", ")}] as const;

export const SHAPE_BIAS: readonly number[] = [${b.map(r).join(", ")}];

export const SHAPE_WEIGHTS: readonly (readonly number[])[] = [
${rows}
];
`,
);
console.log("wrote", out);
