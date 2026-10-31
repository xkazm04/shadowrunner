# How Kiro built Shadowrunner (submission write-up, draft)

> Filled in as we go; every claim links to a spec, hook, agent or log entry in this repo.

## The division of labour
- **Kiro is the builder.** Every line of product code is written by Kiro CLI (custom agent
  `sr-builder`) implementing one task of a spec in `.kiro/specs/` at a time.
- **Claude Code is the director.** It wrote the specs and steering from a design dialogue with the
  owner, dispatches tasks to Kiro (`scripts/kiro-task.sh`), reviews each diff against the spec's
  acceptance criteria, runs the gates and commits. We disclose this openly: the experiment is
  "spec-driven development where one agent plans and Kiro executes against a contract it cannot edit".

## Spec-driven development
(spec structure, how specs prevented drift, spec vs vibe comparison - TODO with evidence)

## Steering
`product.md`, `tech.md`, `structure.md` always included; custom agents load them via `resources`.

## Custom agents
`sr-builder` (Sonnet 4.5; write allow-list; deny rules protect the contract, steering and git),
`sr-reviewer` (Haiku 4.5; read-only verdict per acceptance criterion).

## Agent hooks
`quality-gates.json` (token-only CSS, lint on save, 400-line cap, gates on Stop),
`contract-guards.json` (rig contract drift agent-prompt, secret scan, manual review trigger).

## MCP
Playwright MCP (pinned 0.0.83) for visual checks of UI tasks.

## Property-based testing
fast-check across rig math, validation, driver, quota (TODO: bugs PBT caught).

## Kiro IDE vs CLI
(TODO)
