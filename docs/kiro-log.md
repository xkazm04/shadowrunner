# Kiro usage log

One entry per spec task Kiro implemented. Written by the orchestrator after reviewing the run
(`var/kiro-runs/<run>/build.jsonl` is the raw transcript). Kept from day one because the
submission write-up is impossible to reconstruct in week 5.

| Date | Spec / task | Kiro surface + agent + model | Outcome | What Kiro got right | What it got wrong / we corrected | Commit |
|---|---|---|---|---|---|---|
| 2026-11-01 | m0-spine / 1 workspace skeleton | CLI 2.37 v3 headless, sr-builder, Opus 5.5 xhigh; sr-reviewer Sonnet 5.5 | done, reviewer `accept` | pnpm workspace with 5 `@sr/*` stubs, Vite + React 19 app, `api/health.ts`, strict TS with `noUncheckedIndexedAccess`; typecheck, 7 tests and `pnpm build` green (re-run by director) | `pnpm lint` left as an honest warning stub until task 2; used `vitest.config.ts` `projects` instead of design's `vitest.workspace.ts` (accepted); health stub returns `{ ok: true }` until task 5 | (this commit) |

## Setup notes
- 2026-11-01: Kiro plan upgraded; kiro-cli 2.37.0. `claude-opus-5.5` (2.0x credits) verified headless
  (`--v3 --no-interactive --model claude-opus-5.5` answered as Opus 5.5). sr-builder moved to Opus 5.5 at
  xhigh effort (`--effort` per run plus `.kiro/settings/cli.json` defaults), sr-reviewer to Sonnet 5.5 at high.
  `scripts/kiro-task.sh` refuses `claude-sonnet-4.5` as builder. m0-spine 1 ran at xhigh; the owner then
  set the builder default to high effort (2026-11-01).
- 2026-10-31: landing design decided outside Kiro (contest skill, 4 rounds, Claude Opus 5.5 seats); spec `landing` rewritten by the director, so Kiro builds the port. Disclosed in docs/kiro-writeup.md.
- 2026-10-31: kiro-cli 2.34.0. Headless `chat --v3 --agent sr-builder --no-interactive --trust-all-tools`
  verified: allow-listed writes go through; the agent profile's deny rules block `git commit` and
  edits to `.kiro/steering|agents|hooks` and spec requirements/design even under trust-all
  (probe transcript summarised here, raw output not kept).
- Hooks `scripts/hooks/secret-scan.mjs` and `line-cap.mjs` proven red on seeded faults.
