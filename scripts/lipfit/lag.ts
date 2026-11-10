// How late Kokoro's viseme timings run against its own audio, and the lab's lip-lag fixture.
// The lag L (1 ms steps over +-100 ms) maximises sum_i s(t_i + L) * (db_i + 30): s is +1 inside a
// spoken (non-sil) viseme span and -1 outside, db_i the clip's 10 ms frame level (speech/features.ts).
// + means the timings are late. Pooled over the corpus it is the shift the fit's labels take
// (corpus.ts REF_SHIFT_MS) and the lead the lab's lip arms read the visemes with
// (apps/lab/src/page/lip/mouth/driver.ts KOKORO_VISEME_LAG_MS). With `--fixture <out.json>` it also
// writes the first clip of every voice (spans as Kokoro gave them, frame levels in whole dB), which
// the lab's lip-lag test (mouth/__tests__/lag.test.ts) scores the drawn mouth against.
//   node --import ./apps/lab/src/hooks.mjs scripts/lipfit/lag.ts <corpus.jsonl> <sentences.jsonl> [--fixture <out.json>]
import { writeFileSync } from "node:fs";
import { speechFeatures } from "../../packages/avatar/src/speech/features.ts";
import { VISEME_SHAPE, loadCorpus, type Clip } from "./corpus.ts";

const [corpusPath, sentencesPath, flag, out] = process.argv.slice(2);
if (corpusPath === undefined || sentencesPath === undefined) throw new Error("usage: lag.ts <corpus.jsonl> <sentences.jsonl> [--fixture <out.json>]");

const SEARCH_MS = 100;
const spoken = (c: Clip, tMs: number): number => (c.spans.some((s) => VISEME_SHAPE[s.v] !== "rest" && tMs >= s.startMs && tMs < s.endMs) ? 1 : -1);
/** The score of every lag (index = lag + SEARCH_MS) for one clip. */
function scores(c: Clip, db: Float32Array): number[] {
  return Array.from({ length: 2 * SEARCH_MS + 1 }, (_, k) => {
    let s = 0;
    db.forEach((d, i) => (s += spoken(c, i * 10 + k - SEARCH_MS) * (d + 30)));
    return s;
  });
}
const best = (s: readonly number[]): number => s.indexOf(Math.max(...s)) - SEARCH_MS;

const clips = loadCorpus(corpusPath, sentencesPath);
const pooled = new Array<number>(2 * SEARCH_MS + 1).fill(0);
const per: number[] = [];
const levels = new Map<string, Float32Array>();
for (const c of clips) {
  const { db } = speechFeatures(c.samples, c.rate);
  levels.set(c.id, db);
  const s = scores(c, db);
  s.forEach((v, k) => (pooled[k] = (pooled[k] ?? 0) + v));
  per.push(best(s));
}
per.sort((a, b) => a - b);
const q = (p: number) => per[Math.floor((per.length - 1) * p)];
console.log(`Kokoro viseme lag over ${clips.length} clips: pooled ${best(pooled)} ms; per clip p10 ${q(0.1)} / p50 ${q(0.5)} / p90 ${q(0.9)} ms`);

if (flag === "--fixture" && out !== undefined) {
  const voices = new Set<string>();
  const picked = clips.filter((c) => !voices.has(c.voice) && voices.add(c.voice) !== undefined);
  const fixture = {
    note: "scripts/lipfit/lag.ts: the first Kokoro clip of each voice, spans as Kokoro timed them, 10 ms frame levels (dB under the clip's peak).",
    clips: picked.map((c) => ({
      id: c.id,
      voice: c.voice,
      spans: c.spans.filter((s) => s.v !== "sil"),
      db: [...(levels.get(c.id) ?? [])].map(Math.round),
    })),
  };
  writeFileSync(out, `${JSON.stringify(fixture)}\n`);
  const sum = new Array<number>(2 * SEARCH_MS + 1).fill(0);
  for (const c of picked) scores(c, levels.get(c.id) ?? new Float32Array()).forEach((v, k) => (sum[k] = (sum[k] ?? 0) + v));
  console.log(`fixture: ${picked.length} clips -> ${out}; their pooled lag ${best(sum)} ms`);
}
