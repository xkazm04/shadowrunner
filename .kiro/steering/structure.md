---
inclusion: always
---
# Structure

```
apps/web/            React app: landing, creator, on-air stage (one page manifest drives routes)
  src/app/           shell, page manifest (pages.ts), router
  src/creator/       customize, forge, library
  src/air/           on-air stage, chat
packages/rig/        Rig v1 format, validation, compositor math (pure, no DOM)
packages/avatar/     WebGL2 2.5D renderer + driver (blink, drift, mouth, emotions, gestures)
packages/forge/      portrait -> masks -> layers -> Rig (pure parts testable without network)
packages/engine/     Engine interface, ScriptedEngine, AnthropicEngine
packages/theme/      tokens: scales/, roles.json, themes/{baseline,halloween}.json -> CSS
api/                 Vercel functions: forge, voice, engine (thin; logic lives in packages/)
assets/              committed art: characters/malakor/{rig,bible.md}, replay/, plates/
docs/                rig-format.md, provenance.md, kiro-log.md, kiro-writeup.md, decisions/
.kiro/               steering, specs, hooks, agents (tracked - hackathon rule)
var/                 all runtime output (git-ignored)
```

- Layering: `apps/web` -> `packages/*`; `api/` -> `packages/*`; `packages/rig` depends on
  nothing; `packages/avatar` -> `rig`; `packages/forge` -> `rig`; `packages/engine` -> `rig` (types: `Emotion`,
  `Gesture`; director decision 2026-11-01). No package imports `apps/`.
- One owner per noun: the Rig type lives only in `packages/rig`.
- Stay inside the file scope of the task you were given. If a task needs a file outside it,
  stop and say so.
