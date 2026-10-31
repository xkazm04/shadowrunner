# Kiro usage log

One entry per spec task Kiro implemented. Written by the orchestrator after reviewing the run
(`var/kiro-runs/<run>/build.jsonl` is the raw transcript). Kept from day one because the
submission write-up is impossible to reconstruct in week 5.

| Date | Spec / task | Kiro surface + agent + model | Outcome | What Kiro got right | What it got wrong / we corrected | Commit |
|---|---|---|---|---|---|---|

## Setup notes
- 2026-10-31: landing design decided outside Kiro (contest skill, 4 rounds, Claude Opus 5.5 seats); spec `landing` rewritten by the director, so Kiro builds the port. Disclosed in docs/kiro-writeup.md.
- 2026-10-31: kiro-cli 2.34.0. Headless `chat --v3 --agent sr-builder --no-interactive --trust-all-tools`
  verified: allow-listed writes go through; the agent profile's deny rules block `git commit` and
  edits to `.kiro/steering|agents|hooks` and spec requirements/design even under trust-all
  (probe transcript summarised here, raw output not kept).
- Hooks `scripts/hooks/secret-scan.mjs` and `line-cap.mjs` proven red on seeded faults.
