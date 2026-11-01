# Shadowrunner

**Forge an AI co-host in a cellar you shouldn't have opened.**

Type a description or upload an image. Shadowrunner turns it into a living 2.5D face, cut into
layers, lit, breathing, blinking. Dress it, give it a voice, and put it on air: on a haunted stage
it answers your chat while you stream.

Built for **Kiroween 2026**, Costume Contest category. In this interface the haunting does a job:
when the engine dies, the cellar bulb goes out.

> Status: under construction (M0). Demo URL: _pending_ · Video: _pending_

## Quickstart
Needs Node 22.12 or later. From a fresh clone:

```sh
npm install --global pnpm@11.3.0
pnpm install
pnpm dev
```

Open http://localhost:5173. No keys are needed: the app runs on the replay plane, plays recorded
answers, and shows the RECORDED badge. `pnpm dev` serves only the web app, so the client's `/api/health`
check gets no health answer and it stays on replay.

The gates every change must pass: `pnpm typecheck && pnpm lint && pnpm test`.

## Deploy
`vercel.json` hands the build to the root `vercel-build` script: `pnpm build` writes the static
app to `apps/web/dist`, then `scripts/vercel-output.mjs` bundles each `api/*.ts` function with its
`@sr/*` imports into one file and writes the Vercel Build Output (`.vercel/output`). A deploy with
no variables set runs on replay. To go live, set the server variables listed in
[`.env.example`](.env.example) in the Vercel project, with `SR_PLANE=live`.

## How it is built
Shadowrunner is built **spec-first with Kiro**. Everything Kiro reads lives in [`.kiro/`](.kiro):
- `steering/`: product, tech and structure rules, always in context.
- `specs/`: one spec per milestone (`m0-spine`, `rig-core`, `avatar-renderer`, `creator`,
  `forge-pipeline`, `voice-and-air`, `landing`), each with requirements, design and tasks.
- `agents/`: `sr-builder` (implements one task, and cannot edit the spec it implements) and
  `sr-reviewer` (read-only verdict per acceptance criterion).
- `hooks/`: gates on save and on stop, a contract-drift guard, and a secret scan.
- `settings/mcp.json`: Playwright MCP for visual checks.

The write-up is in [docs/kiro-writeup.md](docs/kiro-writeup.md), and the running log is in
[docs/kiro-log.md](docs/kiro-log.md).

## Provenance
The repo was created 2026-10-31. Pre-existing art and writing (the Malakor character and rig) are
disclosed in [docs/provenance.md](docs/provenance.md).

## License
MIT
