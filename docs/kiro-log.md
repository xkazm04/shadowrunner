# Kiro usage log

One entry per spec task Kiro implemented. Written by the orchestrator after reviewing the run
(`var/kiro-runs/<run>/build.jsonl` is the raw transcript). Kept from day one because the
submission write-up is impossible to reconstruct in week 5.

| Date | Spec / task | Kiro surface + agent + model | Outcome | What Kiro got right | What it got wrong / we corrected | Commit |
|---|---|---|---|---|---|---|
| 2026-11-01 | m0-spine / 1 workspace skeleton | CLI 2.37 v3 headless, sr-builder, Opus 5.5 xhigh; sr-reviewer Sonnet 5.5 | done, reviewer `accept` | pnpm workspace with 5 `@sr/*` stubs, Vite + React 19 app, `api/health.ts`, strict TS with `noUncheckedIndexedAccess`; typecheck, 7 tests and `pnpm build` green (re-run by director) | `pnpm lint` left as an honest warning stub until task 2; used `vitest.config.ts` `projects` instead of design's `vitest.workspace.ts` (accepted); health stub returns `{ ok: true }` until task 5 | (this commit) |
| 2026-11-01 | m0-spine / 2 lint gates and line cap | CLI 2.37 v3 headless, sr-builder, Opus 5.5 high; sr-reviewer Sonnet 5.5 | done, reviewer `accept` | eslint strict + `as unknown as` ban + boundaries layering, two-layer stylelint token rule, `scripts/line-cap.mjs`; 15 gate fixtures with clean controls, runner checks the exact rule that fired; Kiro mutated the configs itself to prove the runner goes red (11/15) | touched `pnpm-workspace.yaml` (outside task scope) to unblock pnpm 11 build-script approval for `unrs-resolver`, accepted; director aligned the save hook's line count with the repo cap (trailing newline) | (this commit) |
| 2026-11-01 | m0-spine / 3 theme package | CLI 2.37 v3 headless, sr-builder, Opus 5.5 high; sr-reviewer Sonnet 5.5 | done, reviewer `accept` | scales + 31 roles + baseline/halloween, `build.mjs` -> `dist/*.css`, single `JSON.parse` in `validate.ts`; 93 tests incl. fast-check over resolve/contrast. Proved red: 7 code faults (skipped role, swapped hex channels, contrast formula, ...) and 3 data faults each turned the matching test red; it caught its own weak `resolveRef` generator and rewrote it | contrast rule holds `signal-*`/`accent` to 3:1 (large labels only) - landing task 1.1 must hold `paper-ink-signal` (16 px chat text) to 4.5:1; `face-glow` and haunt values unbounded; theme build not watched in `dev` | (this commit) |
| 2026-11-01 | m0-spine / 4 app shell from one manifest (2 passes) | CLI 2.37 v3 headless, sr-builder, Opus 5.5 high; sr-reviewer Sonnet 5.5 | done after revise; reviewer `revise` x2, director accepted | `pages.ts` single manifest (channels 2/3/4/6/9, air O), keymap built from it and throwing on clash, fast-check uniqueness (3 seeded faults red), history router keeping `?plane=`, theme date default, Ctrl+K go-to; checked hotkeys in a real browser via Playwright MCP. Pass 2: wired `@sr/theme` CSS, removed its duplicate theme list, pre-paint boot script with a fast-check agreement test against `resolveTheme` (seeded year fault red), token-only `Shell.module.css` | pass 1 judged the theme dependency out of scope although `apps/**` was allow-listed; reviewer could not see the builder's red proofs (fixed: reviewer now reads `report.txt`); `prefers-color-scheme` resolved by director amending m0 req 3.5 (exposed as `data-scheme` only, both themes dark) | (this commit) |
| 2026-11-01 | m0-spine / 5 planes and health | CLI 2.37 v3 headless, sr-builder, Opus 5.5 high; sr-reviewer Sonnet 5.5 | done, reviewer `accept` | `SR_PLANE` (default replay), `/api/health` `{ plane, engine, version }` no-store, `?plane=` can only force replay (property test over arbitrary strings), client stays on replay until health answers, sticky RECORDED badge; 6 property tests each proven red, strengthened one weak generator itself | duplicated `Health`/`Plane` types across api and web (flagged by builder and reviewer) and the override being client-only -> director added steering rule `x-sr-plane` and m0 task 7 | (this commit) |

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
