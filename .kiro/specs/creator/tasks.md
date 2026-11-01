# Implementation plan: creator

- [x] 1. Forge client contract and replay client
  - [x] 1.1 `forgeClient.ts`: types exactly per design.md and the HTTP `ForgeClient` (`POST /api/forge`, `GET /api/forge/:jobId`, `{ error: { code, message } }` parsing).
  - [x] 1.2 `forgeClient.replay.ts` with recorded timings from `assets/replay/forge-timings.json` and `?forge=fail:<code>`; unit tests with fake timers.
  - _Requirements: 3.1, 3.2, 3.6_

- [x] 2. Pure reducers
  - [x] 2.1 `lookReducer.ts` + fast-check properties (non-mutation, palette format, toggle involution, reset = defaultLook).
  - [x] 2.2 `forgeReducer.ts` + fast-check properties (forward-only status order, terminal states, failed keeps request).
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 3.2, 3.4_

- [ ] 3. Library store
  - [ ] 3.1 `library/assets.ts` (dataUrl ↔ Blob, Blob → ImageBitmap).
  - [ ] 3.2 `library/libraryStore.ts` on IndexedDB `sr-library`/`characters` with in-memory fallback; every read through `validateRig`.
  - [ ] 3.3 `library/seed.ts` seeding Malakor from `assets/characters/malakor/`; tests with `fake-indexeddb` (seed, damaged record, delete refused for seeded, fallback notice).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 4. Customize panel and stage
  - [ ] 4.1 `Stage.tsx` with `<AvatarCanvas>` and "speak a line" replay audio.
  - [ ] 4.2 `PaletteField`, `PartToggles` (layers of kind accessory/crown/eye), `EmotionPicker` (10), `GestureBar` (6), reset; keyboard operable with accessible names.
  - [ ] 4.3 Component tests: palette change re-renders the stage look, toggles write `hidden`, gesture prop fires once per press.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 5. Forge panel
  - [ ] 5.1 `forge/image.ts` validation and downscale with tests.
  - [ ] 5.2 `ForgePanel.tsx` + `useForgeJob.ts`: form, staged progress with elapsed time, poll/backoff/timeout, resume by jobId from sessionStorage, disabled-while-running.
  - [ ] 5.3 Failure states per code (quota → gallery, refused_likeness, refused_content, upstream retry, bad_input field focus), input kept for retry; reveal moment with reduced-motion twin; store result in the library.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 6. Replay gallery
  - `Gallery.tsx` listing `assets/replay/characters/*/rig.json` (all `fictional: true`, `source: "replay"`), adopt-into-library, reachable from quota state and empty library.
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 7. Page layout and states
  - `CreatorPage.tsx` regions (stage ≥ 60% desktop; stage-first stack at 390 px), designed loading/empty/failed states, role tokens only, stylelint and AA contrast checks green in both themes; mark the `creator` page `live` in the manifest.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 8. Apply the contest winner's art direction (The Harvest Floor; after `landing` tasks 1, 2 and 9)
  - Restyle the regions to `ch-forge-1600x900.png` using only role tokens the `landing` spec adds: `ChannelFrame`, the stage on the left, the parchment tab panel (LOOKS | FACE | VOICE | FORGE NEW) and the two channel actions. No behaviour or test changes.
  - _Requirements: 6.1, 6.2_
