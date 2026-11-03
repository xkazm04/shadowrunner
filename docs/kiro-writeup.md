# How Kiro built Shadowrunner (submission write-up, draft)

> Filled in as we go; every claim links to a spec, hook, agent or log entry in this repo.

## The division of labour
- **Kiro is the builder.** Every line of product code is written by Kiro CLI (custom agent
  `sr-builder`) implementing one task of a spec in `.kiro/specs/` at a time.
- **Claude Code is the director.** It wrote the specs and steering from a design dialogue with the
  owner, dispatches tasks to Kiro (`scripts/kiro-task.sh`), reviews each diff against the spec's
  acceptance criteria, runs the gates and commits. We disclose this openly: the experiment is
  "spec-driven development where one agent plans and Kiro executes against a contract it cannot edit".
- **Where Kiro stopped (disclosed).** Kiro CLI (Opus 5.5) built m0-spine, rig-core, forge-pipeline
  0-5, voice-and-air 1.1, avatar-renderer 1 and landing 1-7 (42 runs, every one reviewed; see
  `docs/kiro-log.md`). On 2026-11-01 the plan's monthly usage limit was reached. Rather than wait
  days for the credit grant, the owner chose to finish the remaining tasks of the same Kiro specs
  with Claude Code subagents under the same contract: the `.kiro/specs` tasks, steering, hooks and
  gates are unchanged, and each such task is marked "Claude Code (Kiro credits exhausted)" in the
  log. Follow-up development returns to Kiro once credits arrive.
- **Art direction came from a design contest, not from Kiro.** Claude Opus and Sonnet seats
  built static HTML prototypes over four rounds, and the owner picked the winner. Images came
  from Gemini 3 Pro Image. The winning prototype is kept as a reference
  (`assets/_incoming/landing-winner/`). The `landing` spec turns it into acceptance criteria, and
  Kiro writes the React port.
- **The costume pass (disclosed).** For the Costume Contest the owner ran two more design rounds
  on 2026-11-01: Claude Opus 5.5 subagents built three static HTML variants per page per round, and
  the owner picked winners on an artifact triage board (`assets/_incoming/costume/`). The `costume`
  spec turns the winners into acceptance criteria; Kiro was still out of credits, so Claude Code lanes
  ported them under the same steering, hooks and gates (log rows "costume / 0-7").
- **The cast-forge overnight (disclosed).** On 2026-11-02 the owner advanced eight contest
  characters, one art style each, and the `cast-forge` spec turned them into Malakor-class rigs one at
  a time, each hardening the forge for the next, then put the same path in front of a streamer's own
  character (a brief, the handshake, live decomposition into named parts). It was built overnight by
  Claude Code Opus 5.5 builders under a Claude Code director, with no Kiro credits used, spec-first
  like the rest: requirements, design and tasks were written before code, under the same steering,
  hooks and gates (log rows "cast-forge / 0-12"; the per-character lessons are in
  `docs/cast-forge-ledger.md`).

## Spec-driven development
(spec structure, how specs prevented drift, spec vs vibe comparison - TODO with evidence)

## Steering
`product.md`, `tech.md`, `structure.md` always included; custom agents load them via `resources`.

## Custom agents
`sr-builder` (Claude Opus 5.5 at high effort; write allow-list; deny rules protect the contract,
steering and git), `sr-reviewer` (Claude Sonnet 5.5 at high effort, a different model from the
builder so the review is not self-grading; read-only verdict per acceptance criterion).
Workspace effort defaults live in `.kiro/settings/cli.json` (`chat.modelDefaults`).

## Agent hooks
`quality-gates.json` (token-only CSS, lint on save, 400-line cap, gates on Stop),
`contract-guards.json` (rig contract drift agent-prompt, secret scan, manual review trigger).

## MCP
Playwright MCP (pinned 0.0.83) for visual checks of UI tasks.

## Property-based testing
fast-check across rig math, validation, driver, quota (TODO: bugs PBT caught).

## Kiro IDE vs CLI
(TODO)
