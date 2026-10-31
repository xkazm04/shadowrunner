# Requirements: M0 spine

## Introduction
The skeleton every other spec builds on: a pnpm TypeScript monorepo, a React/Vite web app shell
driven by one page manifest, the two-theme token system, the replay/live plane switch, quality
gates proven red once, and a Vercel deployment that works with no keys. Exit criterion for the
milestone: `pnpm dev` and the deployed URL both show the shell in both themes on the replay plane,
and `pnpm typecheck && pnpm lint && pnpm test` is green on a fresh clone.

## Requirement 1: Workspace and gates
**User story:** As a builder agent, I want one command per gate, so that every task ends with the same verdict.

#### Acceptance criteria
1. WHEN `pnpm install` runs on a fresh clone THEN the workspace SHALL install `apps/web`, `api`, and `packages/{rig,avatar,forge,engine,theme}` with Node >= 22.
2. WHEN `pnpm typecheck` runs THEN every package SHALL compile under `strict: true` with no emitted errors.
3. WHEN `pnpm lint` runs THEN eslint SHALL reject `any`, `as unknown as`, and imports that break the layering in `structure.md`; stylelint SHALL reject hex, `rgb()`, named colours and raw `px` in `*.module.css`; the line-cap check SHALL reject any `.ts/.tsx/.css` file over 400 lines and SHALL exit 2 if it scanned zero files.
4. WHEN `pnpm test` runs THEN vitest SHALL run every package's tests, including fast-check property tests, without network access.
5. Each of the three lint rules and the line cap SHALL have a fixture proving it fails on a seeded violation (kept under `scripts/gate-fixtures/`, excluded from normal runs, exercised by `pnpm test:gates`).

## Requirement 2: Theme tokens
**User story:** As a designer, I want themes to rebind roles only, so that a third theme needs no component change.

#### Acceptance criteria
1. `packages/theme` SHALL hold `scales/*.json` (raw ramps), `roles.json` (the closed role vocabulary) and `themes/baseline.json` + `themes/halloween.json`.
2. WHEN the build runs THEN it SHALL emit one CSS file per theme defining `--sr-<role>` custom properties under `[data-theme="<name>"]`.
3. IF a theme leaves any role in `roles.json` unbound THEN `pnpm test` SHALL fail naming the role.
4. The role vocabulary SHALL include surface, text, signal (on-air, offline, warning), and a `haunt` axis (`--sr-haunt-fog`, `--sr-haunt-flicker`, `--sr-haunt-glow`) that baseline sets to zero.
5. A contrast test SHALL check every text/surface role pair per theme against WCAG AA (4.5:1 body, 3:1 large).

## Requirement 3: App shell and page manifest
**User story:** As a visitor, I want every surface one action away, so that I never get lost in the cellar.

#### Acceptance criteria
1. `apps/web/src/app/pages.ts` SHALL be the only declaration of pages: `id`, `title`, `path`, `hotkey`, `status` (`live` | `sealed`).
2. The router, the keyboard map and the navigation SHALL derive from the manifest; a test SHALL fail if two pages share a hotkey or path.
3. The initial manifest SHALL list these pages and render a placeholder for each:
   - `landing` (`/`, channel 2, key `2`);
   - `creator` (`/creator`, channel 3, key `3`);
   - `characters` (`/characters`, channel 4, key `4`);
   - `daemon` (`/daemon`, channel 6, key `6`);
   - `sealed` (`/sealed`, channel 9, key `9`, status `sealed`);
   - `air` (`/air`, no channel, key `O`).
   `PageDef` SHALL carry the optional `channel` and `subtitle` fields. The page set and the keys follow the landing verdict, The Harvest Floor (spec `landing`, design.md "Channels and the manifest").
4. WHEN a page has `status: "sealed"` THEN the shell SHALL render a sealed door with one line of lore instead of the page.
5. The shell SHALL switch theme via `data-theme` on `<html>`, persisted in localStorage, defaulting to `halloween` until 2026-12-31 and `baseline` after, and SHALL honour `prefers-reduced-motion` and `prefers-color-scheme` as inputs.

## Requirement 4: Planes
**User story:** As a judge, I want the app to work on first visit with no credentials, so that I can evaluate it at once.

#### Acceptance criteria
1. The server SHALL read `SR_PLANE` (`replay` default, `live`), and `GET /api/health` SHALL return `{ plane, engine, version }`.
2. WHEN the plane is `replay` THEN the shell SHALL show a persistent, legible "RECORDED" badge.
3. The client SHALL accept `?plane=replay` to force replay in dev and on the deployed site.
4. No test or build step SHALL require `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`.

## Requirement 5: Deploy
**User story:** As the owner, I want a public URL from day one, so that the submission URL is never a last-week risk.

#### Acceptance criteria
1. `vercel.json` SHALL build `apps/web` to static output and expose `api/*` as Node functions.
2. `.env.example` SHALL list every server variable with a comment and no values.
3. The README quickstart SHALL get a fresh clone to `pnpm dev` in three commands.
