# How Kiro built Shadowrunner (submission write-up, draft)

> Filled in as we go; every claim links to a spec, hook, agent or log entry in this repo.

## The division of labour
- **Kiro is the builder.** Every line of product code is written by Kiro CLI (custom agent
  `sr-builder`) implementing one task of a spec in `.kiro/specs/` at a time.
- **Claude Code is the director.** It wrote the specs and steering from a design dialogue with the
  owner, dispatches tasks to Kiro (`scripts/kiro-task.sh`), reviews each diff against the spec's
  acceptance criteria, runs the gates and commits. We disclose this openly: the experiment is
  "spec-driven development where one agent plans and Kiro executes against a contract it cannot edit".
- **Art direction came from a design contest, not from Kiro.** Claude Opus and Sonnet seats
  built static HTML prototypes over four rounds, and the owner picked the winner. Images came
  from Gemini 3 Pro Image. The winning prototype is kept as a reference
  (`assets/_incoming/landing-winner/`). The `landing` spec turns it into acceptance criteria, and
  Kiro writes the React port.

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
