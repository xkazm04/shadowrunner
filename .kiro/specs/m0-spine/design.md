# Design: M0 spine

## Overview
A pnpm workspace with one Vite app, thin Vercel functions, and five packages. Tooling is plain:
`tsc -b` for typecheck, eslint flat config with `eslint-plugin-boundaries`, stylelint with
`stylelint-declaration-strict-value`, vitest workspace mode with fast-check, and a 40-line Node
line-cap script. Nothing here knows about avatars yet; it only makes the next specs cheap.

## Layout
```
package.json                 scripts: dev, build, typecheck, lint, test, test:gates
pnpm-workspace.yaml          apps/*, packages/*, api
tsconfig.base.json           strict, ESNext, moduleResolution bundler, noUncheckedIndexedAccess
eslint.config.js             boundaries: app -> packages; packages/rig -> none; avatar,forge -> rig
stylelint.config.js          *.module.css: color/background/border/box-shadow/font-size/... only var(--sr-*)
vitest.workspace.ts
scripts/line-cap.mjs         walks apps/ packages/ api/ (*.ts,*.tsx,*.css); exit 1 on >400, exit 2 on 0 files
scripts/gate-fixtures/       one seeded violation per rule + a runner (pnpm test:gates)
apps/web/                    Vite + React 19; src/app/{main.tsx,Shell.tsx,pages.ts,router.ts,keys.ts,theme.ts,plane.ts}
api/health.ts                GET -> { plane, engine, version }
packages/theme/              scales/, roles.json, themes/, build.mjs -> dist/{baseline,halloween}.css, contrast.test.ts
packages/{rig,avatar,forge,engine}/  package.json + src/index.ts stub + one passing test each
```
Package names (wire-level, every spec imports by these): `@sr/rig`, `@sr/avatar`, `@sr/forge`,
`@sr/engine`, `@sr/theme`; the app is `@sr/web`, the functions package `@sr/api`. Workspace
dependencies use `workspace:*`; packages export TypeScript source via `exports` (no build step
for internal packages; Vite and vitest resolve `.ts` directly).
```
vercel.json, .env.example
```

## Page manifest
```ts
export type PageStatus = "live" | "sealed";
export interface PageDef { id: PageId; title: string; path: `/${string}`; hotkey: string; status: PageStatus; lore?: string }
export type PageId = "landing" | "creator" | "air" | "characters";
export const PAGES: readonly PageDef[];
```
Router: a 60-line history router (pathname -> PageDef) is enough; no router dependency. The
keyboard map binds `hotkey` per page plus `Ctrl+K` (go to) and `T` (theme toggle); `keys.test.ts`
asserts uniqueness across the manifest and the globals.

## Tokens
Two layers per the design-tokens standard. `roles.json` is an array of role names; each theme maps
role -> scale reference (`"surface-0": "soot.950"`). `build.mjs` resolves references and writes
`[data-theme="halloween"] { --sr-surface-0: #0b0a09; ... }` (hex only in generated CSS, which is
exempt from stylelint). Initial roles (extend later, never rename):
`surface-0..3, text-strong, text, text-muted, line, signal-onair, signal-offline, signal-warn,
signal-ok, accent, face-glow, haunt-fog, haunt-flicker, haunt-glow, font-display, font-body,
font-mono, radius-1, space-1..6, size-text-sm, size-text, size-text-lg, size-display`.
The halloween values are provisional until the landing contest verdict (spec `landing`).

## Planes
`api/_lib/plane.ts` exports `plane(): "replay" | "live"` from `SR_PLANE`. `apps/web/src/app/plane.ts`
fetches `/api/health` once, honours `?plane=`, and exposes a `usePlane()` hook. The badge lives in
the shell, outside any page, so no page can forget it.

## Testing strategy
- `keys.test.ts`: property test over random manifests (fast-check) that the uniqueness check
  rejects any duplicate hotkey/path and accepts any unique set.
- `themes.test.ts`: every role bound in every theme; contrast pairs per theme.
- `gate-fixtures`: each fixture is run by the real tool and must fail.
