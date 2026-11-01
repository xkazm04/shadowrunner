# Implementation plan: M0 spine

- [x] 1. Workspace skeleton
  - Create `package.json` (scripts dev/build/typecheck/lint/test/test:gates, `packageManager` pnpm, engines node>=22), `pnpm-workspace.yaml`, `tsconfig.base.json`, and stub packages `packages/{rig,avatar,forge,engine,theme}` each with `package.json`, `tsconfig.json`, `src/index.ts`, one passing vitest test.
  - Create `apps/web` (Vite + React 19 + TS) rendering "Shadowrunner" and `api/health.ts`.
  - `pnpm install && pnpm typecheck && pnpm test` green.
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. Lint gates and the line cap
  - [x] 2.1 eslint flat config with typescript-eslint strict, no-explicit-any, a rule banning `as unknown as`, and eslint-plugin-boundaries encoding the layering in `.kiro/steering/structure.md`.
  - [x] 2.2 stylelint for `*.module.css` allowing only `var(--sr-*)` for colour, spacing, font-size, radius and shadow values.
  - [x] 2.3 `scripts/line-cap.mjs` (exit 1 on >400 lines, exit 2 if zero files scanned) wired into `pnpm lint`.
  - [x] 2.4 `scripts/gate-fixtures/` with one seeded violation per rule (any, as-unknown-as, boundary breach, hex in CSS module, 401-line file) and `pnpm test:gates` asserting each one fails.
  - _Requirements: 1.3, 1.5_

- [x] 3. Theme package
  - [x] 3.1 `scales/*.json`, `roles.json` with the initial roles from design.md, `themes/baseline.json` and `themes/halloween.json` (provisional halloween values: near-black soot surfaces, nicotine-paper text, sodium-orange bulb accent, phosphor-green ok, signal red on-air).
  - [x] 3.2 `build.mjs` emitting `dist/{baseline,halloween}.css`; `pnpm build` runs it before the app.
  - [x] 3.3 Tests: every role bound in every theme (failing message names the role); WCAG AA contrast for text/surface pairs; baseline sets `haunt-*` to zero.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4. App shell from one manifest
  - [x] 4.1 `pages.ts` (landing 2, creator 3, characters 4, daemon 6, sealed 9, air O - see requirements 3.3), `router.ts` (history router), `keys.ts` (hotkeys from manifest + Ctrl+K + T).
  - [x] 4.2 Property test (fast-check): uniqueness check rejects any manifest with duplicate hotkey or path and accepts unique ones.
  - [x] 4.3 `Shell.tsx`: renders the active page placeholder or the sealed door (`status: "sealed"` + `lore`), the theme toggle (localStorage, halloween default until 2026-12-31), and reduced-motion handling via a `data-motion` attribute.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 5. Planes and health
  - `api/_lib/plane.ts`, `api/health.ts` returning `{ plane, engine, version }`; client `plane.ts` with `?plane=` override and `usePlane()`; the "RECORDED" badge in the shell; unit tests for both sides without network.
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 6. Deploy and quickstart
  - `vercel.json` (static build of apps/web, Node functions for api/), `.env.example` (SR_PLANE, SR_DAILY_USD_CAP, GEMINI_API_KEY, ANTHROPIC_API_KEY, model ids - comments, no values), README quickstart (3 commands). Verify `pnpm build` produces `apps/web/dist`.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 7. One owner for the health contract (director follow-up from task 5 review)
  - Move `Plane`, `EngineState`, `Health` and `parseHealth` into `packages/engine/src/health.ts` (types) and `packages/engine/src/validate.ts` (the only parse). Export them from `@sr/engine`. `api/_lib/plane.ts`, `api/health.ts` and `apps/web/src/app/plane.ts` import them instead of declaring their own copies. Add `@sr/engine` as a `workspace:*` dependency where needed.
  - The client sends `x-sr-plane: replay` on every `/api/*` request while the `?plane=replay` override is active (steering tech.md, "Plane override reaches the server"). Add `planeFromRequest(req, env)` to `api/_lib/plane.ts`: the header can force replay, never live. Property test proven red once.
  - Gates green; existing health and plane tests keep passing after the move.
  - _Requirements: 4.1, 4.3_

- [x] 8. Deploy wiring for the full app (director, 2026-11-01)
  - `scripts/vercel-output.mjs`: dynamic routes (`/api/forge/:jobId` -> `api/forge/[jobId]`, and any other `[param]` file generically), register `api/cron/forge-gc` in `config.json` `crons` (daily), copy `assets/replay/**` to static `/replay/**` and `assets/plates/**` as needed, and keep the static/SPA fallback order. Test the generated `config.json` (routes, crons) and run every bundled function once under plain node with replay env.
  - `vercel.json` / README deploy notes: `ENABLE_EXPERIMENTAL_COREPACK=1`, `CRON_SECRET`, KV/Blob env names.
  - _Requirements: 5.1_
