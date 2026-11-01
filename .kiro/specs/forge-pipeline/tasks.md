# Implementation plan: forge-pipeline

- [x] 0. Wire contract stub (director, build-order step 3; may run before the spike because it is types only)
  - `packages/forge/src/wire.ts` exactly per design.md "Contracts (wire names)": `ForgeRequest`, `ForgeStatus`, `JobView`, `ForgeErrorCode`, types only. Export it as the `@sr/forge/wire` subpath in `packages/forge/package.json`; a type-level test that the creator-side import compiles.
  - _Requirements: 7.1_

- [x] 1. Spike (run first; gates the rest)
  - [x] 1.1 `scripts/forge-spike.mjs`: generate 3 portraits from 3 different prompts with `portraitPrompt`, request parts with `PARTS_PROMPT`, save JSON + overlays under `var/forge-spike/`. Reads `GEMINI_API_KEY` from env; refuses to run without it; not referenced by any test.
  - [x] 1.2 Write `docs/decisions/0003-forge-spike.md`: per portrait timings, part count, whether a rig assembled and validated (after tasks 3-6 exist, re-run and update), overlay paths, and the decision (polygons vs pose-template fallback).
  - _Requirements: 1.1, 1.2, 1.3_

- Director rulings on the spike findings (docs/decisions/0003, 2026-11-01), binding for tasks 2-4:
  1. Gemini returns JPEG: `png.ts` becomes `image.ts` with `decodeImage` (PNG via `upng-js`, JPEG via the pure-JS `jpeg-js`), sniffed by magic bytes; layers are still encoded as PNG.
  2. Background is near-black, not #050505: `lumaKey` takes `lo` measured per portrait from its four 40 px corner patches (max corner luma + 4, at least 10), not a constant.
  3. `rasterizeMask` uses the non-zero winding rule (Gemini polygons can self-cross); property with a self-crossing polygon.
  4. Hoods: when the `head` polygon lies mostly (>60% of its area) inside `hat`, subtract the head, eyes and jaw polygons from the hat mask before cutting; golden test from the spike's Announcer parts.

- [x] 2. Types, prompts and part parsing
  - [x] 2.1 `types.ts`, `prompts.ts` (exact strings from design.md), `image.ts` (ruling 1).
  - [x] 2.2 `parts.ts`: `parseParts`, `PART_KIND`, `toCanvas`; fixture `test/fixtures/m8-parts.json` from the 2026-10-31 probe; property: malformed inputs rejected.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - Director rulings from the task 2 review (2026-11-01): (a) `m8-parts.json` is recorded, not traced: add a `--parts-only <image>` mode to `scripts/forge-spike.mjs` and run it once on `assets/characters/malakor/rig/portrait.png` (owner key, one Gemini Flash call); the fixture is the recorded response, provenance in `docs/decisions/0003-forge-spike.md`. (b) `parseParts` stays strict on shape but is lenient on count: a repeated part name keeps the first and adds a warning, more than 10 parts keeps the first 10 with a warning; return `{ parts, warnings }`.

- [x] 3. Masks and cutting
  - [x] 3.1 `mask.ts`: `rasterizeMask`, `lumaKey`; properties: core inside polygon, feather bound, key monotonic.
  - [x] 3.2 `cut.ts`: `cutLayer`, `cutAll` in the design order with core subtraction; property: cores disjoint.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 4. Fill fallback and palette
  - From the task 3 review: (a) a real-image test - decode the committed `assets/characters/malakor/rig/portrait.png`, run `cornerKeyLo` and `cutAll` with `test/fixtures/m8-parts.json`, assert every part yields a non-empty layer and the crown keeps its dark facets (opaque pixel count above a floor); (b) seams - adjacent layers (head/torso, jaw/head) must composite back to the plate without a dark line: property that re-compositing all layers over the plate changes no pixel's luma by more than 8 along shared edges; fix by feathering outward into the layer behind if it fails.
  - `fill.ts` `blurExtend` (iterative masked blur outward from the hole edge); `palette.ts` `samplePalette`; tests on synthetic images.
  - _Requirements: 5.3, 6.3_

- [x] 5. Assemble
  - Director rulings from the task 4 review (2026-11-01): (a) open jaw must not show a hole: when `cutAll` gets `plate`, the plate-sourced layers (head, torso) are NOT reduced by the cores of parts the fill removed (jaw, eyes, monocle, accessory); test that the head layer is opaque under the jaw polygon on the m8 fixture. (b) `samplePalette` never falls back to a fixed colour: when no eye pixels qualify, derive from the head region's dominant saturated hue, and return a `palette_fallback` warning that `assembleRig` surfaces. (c) add a seam property for a plain hat on a head (hat above, head polygon not inside it).
  - `assemble.ts`: anchors, depth defaults, follows, background layer, `fictional: true`; property: output always passes `validateRig`; golden: Malakor portrait + m8 parts -> valid rig.
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 6. Server: Gemini client, quota, job store
  - [x] 6.1 `api/_lib/gemini.ts` (injectable fetch, timeouts, model ids from env), `errors.ts`.
  - [x] 6.2 `api/_lib/quota.ts` + `costs.ts` (shared with voice-and-air) with memory and KV backends; tests for per-IP and global USD caps.
  - [x] 6.3 `api/_lib/jobstore.ts`: `MemoryJobStore`, `RedisBlobJobStore` (Upstash KV + Vercel Blob), selection by plane/env; `api/cron/forge-gc.ts`.
  - _Requirements: 7.2, 7.3, 7.6_

- [x] 7. Forge endpoints and steps
  - From the task 5 review: take the fill list for `fillPrompt` and the `blurExtend` hole from `FILL_PARTS` (one owner); map `assembleRig`'s `RangeError` on a plate/portrait size mismatch to `upstream` (never a raw error to the client); when the spike is re-run for 1.2, inspect each composite for a box edge around the jaw on the plate-sourced head and record it in 0003.
  - Malformed parts JSON (seen live 2026-11-01: Gemini added a stray `]`): `packages/forge/src/validate.ts` `parsePartsJson(text)` is the only `JSON.parse` of the reply; when it fails, the parts step re-asks the model once (counts against quota), then fails the job with `upstream`. No text repair in production. Test with the recorded raw reply.
  - [x] 7.1 `api/forge/index.ts` (validation, likeness/content check for images, quota, portrait step) and `api/forge/[jobId].ts` (advance one step via `forge-steps.ts`: parts -> fill (edit, fallback on failure/30 s) -> cut -> assemble).
  - [x] 7.2 Tests with a fake Gemini client: happy path reaches `done` with a valid rig; `refused_likeness`; `quota` before any call; upstream garbage -> `upstream`; no secret or raw upstream text in responses.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.1, 5.2, 7.1, 7.4, 7.6_

- [x] 8. Replay plane
  - Record 4 pre-forged jobs into `assets/replay/forge/<slug>/` (from the spike outputs, marked `fictional: true`, provenance in `docs/provenance.md`); replay `POST` picks by prompt hash, `GET` steps statuses with 1.5-3 s latency; test that replay makes zero fetches.
  - _Requirements: 7.5_

- [x] 9. Rig quality and static replay (director rulings from the 1.2 composites, 2026-11-01)
  - Plate composition: the plate equals the original portrait everywhere except inside the `FILL_PARTS` regions dilated by 12 px, where the fill-edit pixels (or `blurExtend`) are blended in with a 6 px feather. This removes fill drift by construction (the Announcer must keep his void face). Property: outside the dilated regions the plate equals the portrait exactly.
  - The `background` layer is that full plate (not a flat ground colour), so no region the parts do not cover can ever render black. Golden on m8: the composite at rest equals the portrait within luma 8 everywhere.
  - Jaw: dilate the jaw's lifted region so its edge lands on painted interior; feather the jaw layer's top edge 3 px. Golden: an open jaw (0.06 * height) shows no near-black pixels outside the mouth interior that the plate painted.
  - Static replay: replay jobs reference layer PNGs and portraits by static URL (`/replay/forge/<slug>/...`) instead of data URLs; `vercel-output.mjs` copies `assets/replay/**` to static `/replay/**` (the deploy lane adds the copy; this task changes `forge-replay.ts` and the job files). Replay `done` responses stay under 100 KB.
  - Rebuild every replay job offline with the new pipeline (no paid call) from the recorded portraits, parts and fill edits of the 1.2 run (`var/forge-spike*`), plus Malakor. Then forge the two presets not yet generated, Sister Vesper and the Moth Widow (`assets/characters/presets/PROMPTS.md`), in ONE paid run (2 portraits, 2 parts, 2 fills), and add them as replay jobs. Inspect every composite by eye; record provenance.
  - Tick 7.1 once 2.1 and 2.4 as amended hold.
  - _Requirements: 2.1, 2.4, 5.1, 6.1, 7.5_

- [ ] 10. No ghost edges on head turn (director ruling from the task 9 build, 2026-11-01)
  - Adopt the builder's counter-proposal: inside the opaque cores of every moving layer (head, crown, hair, hat, accessory, eyes, monocle, jaw), eroded by 2 px, the `background` layer is painted with `blurExtend` from the surrounding ground instead of the portrait, so the rest view is unchanged (luma within 2.5 of the portrait, as now) and a turned head (yaw 10 degrees, about 12 px of travel) reveals ground, not a second copy of the head or crown.
  - Golden: render each replay job at rest and at the gaze "chat" yaw through `poseLayers`; at the yaw pose no pixel within 16 px outside the head/crown silhouette may match the moved layer's edge (measure a doubled-edge score and assert it is below a threshold proven against the task 9 output). Rebuild all 6 replay jobs offline (no paid call) and refresh the before/after grid.
  - _Requirements: 6.1_
