// Scores the package's pipeline (speech/analyse.ts mixOf + trackOf) on held-out voices: every voice
// is analysed with weights fitted without it, with and without the text, against Kokoro's timed
// visemes; the loudness drive is the baseline. The figures quoted in speech/analyse.ts come from
// here. Last, the shipped analyser's time on the longest clip.
//   node --import ./apps/lab/src/hooks.mjs scripts/lipfit/judge.ts <corpus.jsonl> <sentences.jsonl>
import { MOUTH_SHAPES, type MouthShape } from "../../packages/avatar/src/mouth/shapes.ts";
import { analyseSpeech, mixOf, trackOf } from "../../packages/avatar/src/speech/analyse.ts";
import { speechFeatures } from "../../packages/avatar/src/speech/features.ts";
import { labels, loadCorpus, stack } from "./corpus.ts";
import { fit, logp } from "./lr.ts";
import { Score, loudnessTrack, refTrack } from "./metrics.ts";

const [corpusPath, sentencesPath] = process.argv.slice(2);
if (corpusPath === undefined || sentencesPath === undefined) throw new Error("usage: judge.ts <corpus.jsonl> <sentences.jsonl>");

const K = MOUTH_SHAPES.length;
const clips = loadCorpus(corpusPath, sentencesPath);
const data = clips.map((c) => {
  const f = speechFeatures(c.samples, c.rate);
  return { c, f, X: stack(f.values, f.frames), y: labels(c, f.frames).map((s: MouthShape) => MOUTH_SHAPES.indexOf(s)) };
});
const voices = [...new Set(clips.map((c) => c.voice))];
const S = { loud: new Score(), audio: new Score(), text: new Score(), ref: new Score() };
for (const v of voices) {
  const tr = data.filter((d) => d.c.voice !== v);
  const net = fit(tr.flatMap((d) => d.X), tr.flatMap((d) => d.y), K, { epochs: 15, lr: 0.003 });
  for (const d of data.filter((x) => x.c.voice === v)) {
    const lp = new Float32Array(d.f.frames * K);
    d.X.forEach((x, i) => logp(net, x).forEach((l, k) => (lp[i * K + k] = l)));
    const dur = d.c.samples.length / d.c.rate;
    const n = d.f.frames;
    const audio = trackOf(mixOf(lp, d.f.db, undefined), dur);
    const text = trackOf(mixOf(lp, d.f.db, d.c.text), dur);
    const ref = refTrack(d.c);
    S.loud.add(ref, loudnessTrack(d.c.samples, d.c.rate), n);
    S.audio.add(ref, (i) => audio.at(i / 100), n);
    S.text.add(ref, (i) => text.at(i / 100), n);
    S.ref.add(ref, ref, n);
  }
}
console.log(S.loud.line("loudness (baseline)"));
console.log(S.audio.line("analyser, audio only"));
console.log(S.text.line("analyser + text"));
console.log(S.ref.line("reference (itself)"));

const long = clips.reduce((a, b) => (a.samples.length > b.samples.length ? a : b));
const t0 = performance.now();
for (let i = 0; i < 5; i++) analyseSpeech(long.samples, long.rate, { text: long.text });
const ms = (performance.now() - t0) / 5;
console.log(`analyseSpeech on the longest clip (${(long.samples.length / long.rate).toFixed(1)} s @ ${long.rate} Hz): ${ms.toFixed(0)} ms`);
