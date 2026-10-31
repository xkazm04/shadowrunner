# Requirements: creator

## Introduction
The creator (`apps/web/src/creator`, route `/creator`) is Shadowrunner's core surface: where a
streamer forges an AI co-host from a typed description or an uploaded image, dresses it, sets its
mood, hears it speak, and keeps it in a local library. It renders through `<AvatarCanvas>`
(avatar-renderer), edits a `Look` over a `Rig` (rig-core), and talks to the forge server only
through the typed client for `POST /api/forge` / `GET /api/forge/:jobId` (server side: spec
`forge-pipeline`). It works on first visit with no keys: Malakor is seeded and the replay plane
serves a gallery of pre-forged fictional characters. Final visuals come from the landing contest
winner (spec `landing`); this spec fixes states, layout regions and role tokens.

## Requirement 1: Customize a rig live
**User story:** As a streamer, I want to change my character's colours, parts and mood and see it instantly, so that it becomes mine.

#### Acceptance criteria
1. The customize panel SHALL edit `look.palette` (`glow`, `eye`, `rim`, `mouth`) with colour pickers styled only by role tokens; the face SHALL update within one frame of a change.
2. The panel SHALL list one toggle per layer of kind `accessory`, `crown` or `eye`, writing `look.hidden`; WHEN a toggle changes THEN the layer SHALL appear or disappear without re-forging.
3. The panel SHALL offer all 10 `Emotion` values and 6 `Gesture` buttons; choosing one SHALL update `look.emotion` or trigger the gesture on the avatar.
4. "Speak a line" SHALL play a replay audio line for the active character and drive the mouth from it via `<AvatarCanvas audio>`.
5. "Reset look" SHALL restore `defaultLook(rig)`.
6. Every control SHALL be keyboard-operable with a visible focus ring and an accessible name.

## Requirement 2: Character library
**User story:** As a streamer, I want my characters kept between visits, so that I don't have to forge again.

#### Acceptance criteria
1. The library SHALL persist in IndexedDB database `sr-library`, object store `characters`, records `{ id, rig, assets, look, voice, createdAt }` where `assets` maps `Layer.file` to a `Blob`.
2. WHEN the store is empty THEN the creator SHALL seed Malakor from `assets/characters/malakor/` with `defaultLook`.
3. Saving a look SHALL update only `look` of that record; deleting SHALL require a confirm step and SHALL be refused for the seeded Malakor.
4. IF IndexedDB is unavailable (private mode) THEN the creator SHALL work in memory and show a one-line notice that nothing will be kept.
5. Every record read from IndexedDB SHALL pass `validateRig` before use; an invalid record SHALL be listed as damaged, never rendered.

## Requirement 3: Forge from a prompt or an image
**User story:** As a streamer without art skills, I want to describe or upload a character and get a living face, so that I can create a co-host in minutes.

#### Acceptance criteria
1. The forge form SHALL accept either a prompt (10–500 characters) or one image (PNG/JPEG/WebP, ≤ 5 MB, downscaled client-side to ≤ 1024 px) and SHALL call `POST /api/forge` with `{ mode: "prompt", prompt }` or `{ mode: "image", imageBase64 }`.
2. WHILE a job runs the creator SHALL poll `GET /api/forge/:jobId` and show one staged progress step per status `queued`, `portrait`, `segmenting`, `cutting`, `done`, with the current step legible and the elapsed time shown.
3. WHEN status is `done` THEN the creator SHALL validate `rig`, store the character with `assets` converted from data URLs to Blobs, and play the reveal moment (face appears, blinks, speaks one line) with a reduced-motion twin.
4. WHEN status is `failed` THEN the creator SHALL show a state per `error.code`: `quota` (offer the replay gallery), `refused_likeness` (explain no real people), `refused_content`, `upstream` (retry), `bad_input` (point at the field); every state SHALL keep the user's input for retry.
5. The forge form SHALL be disabled with an explanation while a job for this tab is running; leaving the page SHALL not cancel the job, and returning SHALL resume polling by `jobId`.
6. WHEN the plane is `replay` THEN forging SHALL use the replay client, which walks the same statuses with recorded timings and returns a gallery character labelled RECORDED.

## Requirement 4: Replay gallery
**User story:** As a judge with no keys, I want ready-made characters to try, so that I can evaluate the creator at once.

#### Acceptance criteria
1. The gallery SHALL list every rig in `assets/replay/characters/*/rig.json`, each `fictional: true` and `source: "replay"`.
2. Adopting a gallery character SHALL copy it into the library as a new record that the user can customize.
3. The gallery SHALL be reachable from the forge's `quota` state and from the empty library.

## Requirement 5: Layout, states and tokens
**User story:** As a visitor, I want the face to dominate and every control to be one action away, so that the creator is clear in the dark.

#### Acceptance criteria
1. The creator SHALL have three regions: **stage** (the avatar, the largest region), **controls** (customize or forge, switchable), and **library** (characters); at 390 px width they SHALL stack stage-first.
2. The face SHALL be the brightest element: surrounding surfaces use `--sr-surface-*`, the avatar backdrop uses `--sr-face-glow`.
3. The creator SHALL use role tokens only; stylelint SHALL pass on every creator CSS module.
4. Each async state (loading library, forging, failed, empty) SHALL have a designed state, never a blank region.
5. Working text SHALL be ≥ 14 px equivalent with AA contrast in both themes.

## Requirement 6: Art direction
**User story:** As the owner, I want the creator to wear the contest winner's look, so that the app and landing are one world.

#### Acceptance criteria
1. WHEN the `landing` spec records a verdict THEN the creator's regions SHALL be restyled to the winning direction using only role tokens added by that spec, without changing behaviour or tests.
2. The verdict is The Harvest Floor. The creator is channel 3, "The Forge · behind the back panel" (reference: `assets/_incoming/landing-winner/screenshots/ch-forge-1600x900.png`):
   - `ChannelFrame` header ("Back to the set · Esc" and the breadcrumb);
   - the stage on the left on near-black, with the caption "<name> · live rig, N layers" and the current motion state;
   - on the right, a bakelite-framed panel with parchment tabs `LOOKS | FACE | VOICE | FORGE NEW` (Customize = LOOKS and FACE);
   - two actions under the panel: "Put on air · CH 2" (signal) and "Characters · CH 4".
