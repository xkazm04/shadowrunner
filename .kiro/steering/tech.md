---
inclusion: always
---
# Tech

- **TypeScript everywhere**, `strict: true`, ESM. Node 22+. Package manager: **pnpm** workspaces.
- **Web app:** React 19 + Vite, CSS Modules. No UI kit. three.js only where a spec names it;
  the avatar renderer is hand-written WebGL2.
- **Server:** Vercel serverless functions under `api/` (Node runtime). They are the only place
  secrets exist. Keys: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` (never in the client bundle, never
  logged).
- **Models (config, not literals in code):** image `gemini-3-pro-image` (final) and
  `gemini-3.1-flash-image` (drafts); segmentation `gemini-3.8-flash` (polygons, not masks); TTS via Gemini; chat
  engine `claude-haiku-5-5` (Anthropic Messages API).
- **Tests:** vitest; **fast-check** property tests for every pure module (rig math, quota,
  reducers). A property test must be proven red once on a seeded fault before it counts.
- **Planes:** `SR_PLANE=replay|live` on the server; replay serves `assets/replay/**`. Tests
  never call a paid API.

## Gates (run before you report a task done)
```
pnpm typecheck && pnpm lint && pnpm test
```
`pnpm lint` includes eslint (no `any`, no `as unknown as`), stylelint (tokens only: no hex,
`rgb()`, named colours or raw `px` in CSS Modules; use `var(--sr-*)`), and the 400-line file cap.

## Conventions
- Optional JSON fields are **omitted**, never `null`.
- `JSON.parse` of external data only inside a validator (`packages/*/src/validate.ts`).
- Errors crossing the API are `{ error: { code, message } }` with codes from the spec.
- Components consume **role tokens** only (`--sr-surface-*`, `--sr-signal-*`, `--sr-haunt-*`),
  never scale tokens.
