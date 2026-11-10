# Lip-sync fitting (`scripts/lipfit`)

These scripts make and judge the shape classifier that `@sr/avatar`'s analyser reads
(`packages/avatar/src/speech/weights.ts`, perfection-pass task 4). One command does all of it:

```
node scripts/lipfit/fit.mjs                          # speak the corpus if needed, fit, judge
node scripts/lipfit/fit.mjs --corpus <corpus.jsonl>  # fit and judge an existing corpus
node scripts/lipfit/fit.mjs --fresh                  # speak the corpus again
node scripts/lipfit/fit.mjs --no-judge               # fit only (about 10 s; the judge takes about 50 s)
```

Then `git diff packages/avatar/src/speech/weights.ts` shows what changed.

## Steps

1. **Corpus.** `sentences.jsonl` lists 101 sentences, each with one of 7 Kokoro voices. Each line
   is spoken through the Avatar Lab's voice sidecar (`tools/lab-voice`; `pnpm lab setup` installs it
   and its models in `var/lab/models/`). The clips land in `var/lipfit/corpus.jsonl`: about 18 MB of
   PCM, with Kokoro's own phoneme timings as Oculus-15 visemes. The corpus is never committed.
   `SR_LAB_PYTHON` and `SR_LAB_MODELS` point at another sidecar or another model folder.
2. **Fit** (`train.ts`, `lr.ts`, `corpus.ts`). This is a multinomial logistic regression over
   `speech/features.ts` frames stacked at -80..+80 ms. Labels are the visemes grouped into the eight
   shapes the way the lab groups them, shifted 50 ms earlier. It prints the held-out-voice frame
   accuracy and writes `weights.ts`.
3. **Judge** (`judge.ts`, `metrics.ts`). The package pipeline (`mixOf` + `trackOf`) is scored on
   each voice with weights fitted without that voice. Audio only and with text are both scored
   against the reference and the old loudness drive. The figures quoted in `speech/analyse.ts`
   come from here.

`lag.ts` measures how late Kokoro's timings run against its audio (57-58 ms pooled). It also
writes the fixture for the lab's lip-lag test:

```
node --import ./apps/lab/src/hooks.mjs scripts/lipfit/lag.ts var/lipfit/corpus.jsonl scripts/lipfit/sentences.jsonl \
  --fixture apps/lab/src/page/lip/mouth/__tests__/kokoro-lag.fixture.json
```

## Reproducing the shipped weights

The fit is deterministic: the same corpus gives byte-identical weights. Kokoro is not
deterministic. Two runs of the same sentences differ in about 13 of 101 clip lengths, so a newly
spoken corpus gives slightly different weights. The shipped `weights.ts` came from the corpus with
sha256 `1f401a6baac31dfbc202ffa293c89ff23a7e679f263ee2703accbd7ea59db00b` (27599 frames,
held-out accuracy 0.459). `fit.mjs` prints the sha256 of the corpus it used. Passing that corpus
with `--corpus` rebuilds `weights.ts` with no diff.

A corpus spoken again here (sha256 `e25ab562...`) gave 27597 frames and accuracy 0.461. Every
judged correlation stayed within 0.02 of the shipped figures (jaw 0.58/0.58, press 0.32/0.49,
rounding 0.53/0.56, audio only / with text).
