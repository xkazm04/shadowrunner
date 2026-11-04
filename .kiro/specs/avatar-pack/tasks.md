# Implementation plan: avatar-pack

- [x] 0. Wire types and stubs (director)
  - `packages/pack` package (package.json, tsconfig, `fflate` dependency), `src/types.ts` exactly
    as design, `src/index.ts` exporting stubs with the final signatures; root tsconfig reference;
    ESLint layering `pack -> rig`; gates green with no behaviour change.
  - _Requirements: 1.1, 2.5_

- [x] 1. Pack core and readLook (packages/pack, packages/rig)
  - `writePack`, `readPack`, `loadPack`, `decodePackImages`, `packFileName`, `packReadme` exactly
    as design "Container" and "API"; `readLook` moved to `@sr/rig` and re-exported from
    `apps/web/src/creator/library/libraryStore.ts` (callers unchanged).
  - Tests: as design "Testing" (pack, rig).
  - _Requirements: 1.1-1.3, 2.1-2.5_

- [x] 2. Creator export and import (apps/web/src/creator)
  - `library/packing.ts`, `library/ExportSheet.tsx`, Library card Export, Library header Import and
    drop, `ChannelActions` "Export pack", as design "Creator".
  - Tests: as design "Testing" (web).
  - _Requirements: 3.1-3.4, 4.1-4.4_

- [x] 3. Cast packs and docs (scripts, docs)
  - `scripts/build-packs.mjs` and its test, root `dev`/`build` wiring, `.gitignore`, as design
    "Cast packs"; `docs/pack-format.md` (format reference for third parties, with a 15-line
    `loadPack` + `createRenderer` example); README "Avatar packs" section; `docs/provenance.md`
    note that Malakor is never packed.
  - _Requirements: 1.4, 5.1-5.3_
