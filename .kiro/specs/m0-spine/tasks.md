# Implementation plan: M0 spine

- [ ] 1. Workspace skeleton
  - Create `package.json` (scripts dev/build/typecheck/lint/test/test:gates, `packageManager` pnpm, engines node>=22), `pnpm-workspace.yaml`, `tsconfig.base.json`, and stub packages `packages/{rig,avatar,forge,engine,theme}` each with `package.json`, `tsconfig.json`, `src/index.ts`, one passing vitest test.
  - Create `apps/web` (Vite + React 19 + TS) rendering "Shadowrunner" and `api/health.ts`.
  - `pnpm install && pnpm typecheck && pnpm test` green.
  - _Requirements: 1.1, 1.2, 1.4_

- [ ] 2. Lint gates and the line cap
  - [ ] 2.1 eslint flat config with typescript-eslint strict, no-explicit-any, a rule banning `as unknown as`, and eslint-plugin-boundaries encoding the layering in `.kiro/steering/structure.md`.
  - [ ] 2.2 stylelint for `*.module.css` allowing only `var(--sr-*)` for colour, spacing, font-size, radius and shadow values.
  - [ ] 2.3 `scripts/line-cap.mjs` (exit 1 on >400 lines, exit 2 if zero files scanned) wired into `pnpm lint`.
  - [ ] 2.4 `scripts/gate-fixtures/` with one seeded violation per rule (any, as-unknown-as, boundary breach, hex in CSS module, 401-line file) and `pnpm test:gates` asserting each one fails.
  - _Requirements: 1.3, 1.5_

- [ ] 3. Theme package
  - [ ] 3.1 `scales/*.json`, `roles.json` with the initial roles from design.md, `themes/baseline.json` and `themes/halloween.json` (provisional halloween values: near-black soot surfaces, nicotine-paper text, sodium-orange bulb accent, phosphor-green ok, signal red on-air).
  - [ ] 3.2 `build.mjs` emitting `dist/{baseline,halloween}.css`; `pnpm build` runs it before the app.
  - [ ] 3.3 Tests: every role bound in every theme (failing message names the role); WCAG AA contrast for text/surface pairs; baseline sets `haunt-*` to zero.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 4. App shell from one manifest
  - [ ] 4.1 `pages.ts` (landing, creator, air, characters), `router.ts` (history router), `keys.ts` (hotkeys from manifest + Ctrl+K + T).
  - [ ] 4.2 Property test (fast-check): uniqueness check rejects any manifest with duplicate hotkey or path and accepts unique ones.
  - [ ] 4.3 `Shell.tsx`: renders the active page placeholder or the sealed door (`status: "sealed"` + `lore`), the theme toggle (localStorage, halloween default until 2026-12-31), and reduced-motion handling via a `data-motion` attribute.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 5. Planes and health
  - `api/_lib/plane.ts`, `api/health.ts` returning `{ plane, engine, version }`; client `plane.ts` with `?plane=` override and `usePlane()`; the "RECORDED" badge in the shell; unit tests for both sides without network.
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 6. Deploy and quickstart
  - `vercel.json` (static build of apps/web, Node functions for api/), `.env.example` (SR_PLANE, SR_DAILY_USD_CAP, GEMINI_API_KEY, ANTHROPIC_API_KEY, model ids - comments, no values), README quickstart (3 commands). Verify `pnpm build` produces `apps/web/dist`.
  - _Requirements: 5.1, 5.2, 5.3_
