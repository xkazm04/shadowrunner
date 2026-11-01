# Implementation plan: forge-pipeline

- [ ] 0. Wire contract stub (director, build-order step 3; may run before the spike because it is types only)
  - `packages/forge/src/wire.ts` exactly per design.md "Contracts (wire names)": `ForgeRequest`, `ForgeStatus`, `JobView`, `ForgeErrorCode`, types only. Export it as the `@sr/forge/wire` subpath in `packages/forge/package.json`; a type-level test that the creator-side import compiles.
  - _Requirements: 5.1_

- [ ] 1. Spike (run first; gates the rest)
  - [ ] 1.1 `scripts/forge-spike.mjs`: generate 3 portraits from 3 different prompts with `portraitPrompt`, request parts with `PARTS_PROMPT`, save JSON + overlays under `var/forge-spike/`. Reads `GEMINI_API_KEY` from env; refuses to run without it; not referenced by any test.
  - [ ] 1.2 Write `docs/decisions/0003-forge-spike.md`: per portrait timings, part count, whether a rig assembled and validated (after tasks 3-6 exist, re-run and update), overlay paths, and the decision (polygons vs pose-template fallback).
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Types, prompts and part parsing
  - [ ] 2.1 `types.ts`, `prompts.ts` (exact strings from design.md), `png.ts` with `upng-js`.
  - [ ] 2.2 `parts.ts`: `parseParts`, `PART_KIND`, `toCanvas`; fixture `test/fixtures/m8-parts.json` from the 2026-10-31 probe; property: malformed inputs rejected.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Masks and cutting
  - [ ] 3.1 `mask.ts`: `rasterizeMask`, `lumaKey`; properties: core inside polygon, feather bound, key monotonic.
  - [ ] 3.2 `cut.ts`: `cutLayer`, `cutAll` in the design order with core subtraction; property: cores disjoint.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 4. Fill fallback and palette
  - `fill.ts` `blurExtend` (iterative masked blur outward from the hole edge); `palette.ts` `samplePalette`; tests on synthetic images.
  - _Requirements: 5.3, 6.3_

- [ ] 5. Assemble
  - `assemble.ts`: anchors, depth defaults, follows, background layer, `fictional: true`; property: output always passes `validateRig`; golden: Malakor portrait + m8 parts -> valid rig.
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 6. Server: Gemini client, quota, job store
  - [ ] 6.1 `api/_lib/gemini.ts` (injectable fetch, timeouts, model ids from env), `errors.ts`.
  - [ ] 6.2 `api/_lib/quota.ts` + `costs.ts` (shared with voice-and-air) with memory and KV backends; tests for per-IP and global USD caps.
  - [ ] 6.3 `api/_lib/jobstore.ts`: `MemoryJobStore`, `RedisBlobJobStore` (Upstash KV + Vercel Blob), selection by plane/env; `api/cron/forge-gc.ts`.
  - _Requirements: 7.2, 7.3, 7.6_

- [ ] 7. Forge endpoints and steps
  - [ ] 7.1 `api/forge/index.ts` (validation, likeness/content check for images, quota, portrait step) and `api/forge/[jobId].ts` (advance one step via `forge-steps.ts`: parts -> fill (edit, fallback on failure/30 s) -> cut -> assemble).
  - [ ] 7.2 Tests with a fake Gemini client: happy path reaches `done` with a valid rig; `refused_likeness`; `quota` before any call; upstream garbage -> `upstream`; no secret or raw upstream text in responses.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.1, 5.2, 7.1, 7.4, 7.6_

- [ ] 8. Replay plane
  - Record 4 pre-forged jobs into `assets/replay/forge/<slug>/` (from the spike outputs, marked `fictional: true`, provenance in `docs/provenance.md`); replay `POST` picks by prompt hash, `GET` steps statuses with 1.5-3 s latency; test that replay makes zero fetches.
  - _Requirements: 7.5_
