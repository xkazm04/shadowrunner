# Design: perfection-pass

## Lanes and file ownership
Eleven tasks in four lanes. Lanes build in parallel, each in its own git worktree and branch;
tasks inside a lane run in order. A task edits only its own scope. A needed change outside it is
reported to the Director, not made.

| Lane | Tasks (in order) | Scope |
|---|---|---|
| A render | 1 P1, 2 V1, 3 V2 | `packages/avatar/src/{gl,canvas2d,driver,render,player/run.ts,player/frame.ts}`, `packages/avatar/src/react/AvatarCanvas.tsx` (loop/resize effect only), `packages/rig/src`, `apps/web/bench`, `docs/rig-format.md` |
| B voice | 4 F1, 5 V3, 6 F4 | `packages/avatar/src/{audio,mouth,speech*}`, `AvatarCanvas.tsx` (props + frame-body input only), `packages/avatar/src/player/player.ts`, `apps/lab/src/page/lip` (re-point imports), `apps/web/src/air`, `apps/web/src/creator/{speak.ts,useSpeaker.ts,glass/Glass.tsx}`, `apps/web/src/reach`, `packages/engine`, `api/engine`, `api/voice.ts` (live branch), `api/_lib/tts.ts`, `docs/pack-format.md` |
| C creator | 7 F2, 8 F3, 9 P3b | `apps/web/src/creator` except the three files lane B owns, `packages/forge/src/brief*`, `api/_lib/forge-brief.ts`, `api/forge` |
| D load | 10 P2, 11 P3a | `apps/web/vite*.config.ts`, `apps/web/index.html`, `apps/web/src/app/{main.tsx,Shell.tsx}`, `apps/web/src/channels`, `apps/web/src/creator/gallery/entries.ts` (chunk split only), `scripts/vercel-config.mjs`, `scripts/vercel-output.mjs`, `assets/`, `api/voice.ts` (replay redirect only), `api/_lib/forge-replay.ts`, `apps/web/src/landing`, `apps/web/src/air/{Catacomb.tsx,Catacomb.module.css,useStageLights.ts,candles.ts}` |

Known shared files and who owns which part:
- `AvatarCanvas.tsx`: task 1 owns the loop, resize and visibility; task 4 owns props and what is
  passed to the frame body. Keep hunks apart.
- `api/voice.ts`: task 10 owns the replay redirect; task 5 owns the live response.
- `apps/web/src/air`: lane B, except the four stage-light files (lane D). Task 5's grain is a new
  `Grain.tsx` + `Grain.module.css`, mounted from `AirPage.tsx`.
- `docs/kiro-log.md`, this spec's `tasks.md` checkboxes, `README.md`: Director only. Builders
  return doc text in their report.

## Contracts (wire-level names)

### Task 1
- `AvatarCanvasProps.pauseOffscreen?: boolean` and `AvatarPlayerOptions.pauseOffscreen?: boolean`,
  default `true`. Paused = no `step`, no `draw`; on resume the first `dt` is 0.
- `export const MAX_DPR = 2` in `packages/avatar/src/react/loop.ts`, used by AvatarCanvas and
  re-exported from `@sr/avatar/core` for players that call `resize(w, h, dpr)`.
- Renderer: `webglcontextrestored` rebuilds the GL renderer from the last `setRig` inputs.

### Task 2
- `Rig.motion?: { spring?: number }` and `Look.motion?: { spring?: number }`, 0..2, default 1
  (absent = 1); look wins over rig. Absent-value convention for this spec: omit the key.
- Spring state lives in the driver state (`driver/state.ts`), advanced in `step`; the pose gets
  per-layer offsets through `Drive.spring?: Readonly<Record<string, { dx: number; dy: number; rot: number }>>`
  keyed by layer name (rig canvas px, radians). `poseLayers` adds them after float/follow.
- Producer: `driver/step.ts`. First consumer: `rig/src/pose.ts`.

### Task 3
- `Rig.turn?: { warp?: number; light?: number }` and `Look.turn?: { warp?: number; light?: number }`,
  0..1, defaults `warp 0.5`, `light 0.5` (absent = default; 0 disables). Look wins.
- GL only. The pose carries yaw/pitch per layer already; the warp is a vertex-grid deformation in
  the layer program (and the same deformation applied to mouth-warp, iris and lid draws so they
  stay registered). The light replaces the 4 rim taps; cost per pixel must not rise (report taps).

### Task 4
- `@sr/avatar/core` exports:
  - `analyseSpeech(samples: Float32Array, sampleRate: number, options?: { text?: string }): MouthTrack`
  - `interface MouthTrack { readonly durationS: number; at(tS: number): ShapeWeights }`
  - `createVisemeTrack` and its types, moved from `apps/lab/src/page/lip/mouth/track.ts`.
- `AvatarCanvasProps.mouth?: { track: MouthTrack; clock: () => number } | undefined`: `clock`
  returns the clip's current time in seconds (e.g. `audio.currentTime`). While set and the rig's
  `mouthMode` is "drawn" or "warp", shapes drive the mouth; otherwise the level drive stays.
- Web helper `apps/web/src/air/mouthTrack.ts`: `trackForClip(blobOrUrl, text?): Promise<MouthTrack | undefined>`
  (decodeAudioData, cached by URL; `undefined` on failure). Consumers: `useShow.ts`/`AirPage.tsx`,
  `creator/useSpeaker.ts` + `Glass.tsx`, `reach/studio`.

### Task 5
- Show state gains `pending: "reply" | "voice" | undefined` and chat entries gain
  `queued?: true` (omitted when not queued).
- Prefetch: `show.ts` holds at most one `next: Promise<Beat>`; a visitor message cancels it
  (AbortController) before any quota-charging call resolves is not guaranteed, so the server
  charge rule is: a prefetched beat that is discarded is not retried, and the client never
  prefetches more than one beat. Replay/scripted shows do not prefetch.
- Engine: `cache_control: { type: "ephemeral" }` on the persona/bible system block.

### Task 6
- Studio line model: `{ text: string; emotion?: Emotion; gesture?: Gesture }[]`.
- `recorder.ts` gains `size: { width: number; height: number }` (presets 1080x1080, 1080x1920,
  1920x1080) and `background: string | "transparent"`; "transparent" exists in the UI only after
  the e2e pixel-alpha check passes.

### Task 7
- `lookHistory.ts` (pure): `createHistory<Look>(initial, { limit: 100 })` with
  `push`, `undo`, `redo`, `canUndo`, `canRedo`, `opened` (the Compare baseline); a drag coalesces
  until pointer-up / 500 ms idle.
- `useLibrary` gains `rename(id, name)` and `duplicate(id): Promise<string>` (new id);
  `libraryStore` gains the matching writes. Flush: `saveLook`/`saveVoice` pending timers run
  synchronously in the effect cleanup and on `pagehide`.

### Task 8
- `packages/forge/src/briefMatch.ts` (pure, no DOM, no fs):
  `matchCastBrief(request: string, cast: readonly CastBriefSummary[]): { slug: string; score: number; matched: string[] }`.
  Used by `apps/web/src/creator/briefClient.ts` and `api/_lib/forge-brief.ts`; the replay forge
  client takes the matched slug. Brief card string: "Recorded: {name}, chosen for {matched}".

### Task 9
- `LibraryRecord.thumb?: { blob: Blob; key: string }`, `key` = hash of record id, createdAt and
  the look JSON. Producer: `library/thumbnail.ts` on add and on look save (idle callback).
  Consumer: `library/Library.tsx`.

### Task 10
- Voices: `.m4a` (AAC, ffmpeg at `/c/ffmpeg/bin/ffmpeg`), unless the builder shows a better
  cross-browser choice with evidence. Sources stay in the repo only if a script reads them.
- Headers in `scripts/vercel-config.mjs`: `/assets/(.*)` -> `public, max-age=31536000, immutable`;
  `/packs/(.*)`, `/replay/(.*)`, `/embed/(.*)` -> `public, max-age=3600, stale-while-revalidate=86400`.

### Task 11
- `--back`, `--heat` and the candle variables are set on the elements that read them through
  refs; no new tokens.

## Testing
Each task adds unit/DOM tests beside the code (property tests with fast-check where a rule is
stated: spring stability, history undo/redo inverse, matcher determinism). Each builder proves
its key test red on a seeded fault. Visual work (tasks 2, 3, 5, 11) produces a before/after sheet
under `var/perfection/<task>/` (git-ignored) for the owner's board.

## Risks
- Tasks 2 and 3 change how every character moves; defaults are conservative and both have a
  per-rig/look off switch.
- Task 4's analyser has no phoneme alignment from TTS; shape accuracy is heuristic. The lab's
  scenario harness is the judge, and loudness stays the fallback.
- Live-plane paths (task 5 req 4) are untested against real providers.

## Amendments (Director, 2026-11-09, after the build)
- Task 2: `Drive.spring` is `SpringChannels` (`packages/rig/src/spring.ts`): the lag of one spring
  per head channel (`yaw, pitch, roll, scale, lift, actDx, actDy, actRot, actLayer?`), not a
  per-layer record. The rig turns the channels into per-layer offsets; nothing is allocated per layer.
- Task 3: the pose carries no per-layer yaw/pitch. The frame body sets `FrameClock.turn?: { yaw, pitch }`
  (-1..1); a caller that draws without it gets no turn. Default warp is lowered by rule: pixel art
  (`mouth.cell`) 0, a head with no measured `mouth` 0.3. The light changes nothing while the head
  faces front (requirement 3.1 read as covering the whole output).
- Task 4: `AvatarCanvasProps.level?: () => number` added so the stage analyses audio once.
- Task 5: the persona system prompt is an array with one cached text block. A reply joins the chat
  when its line starts, not when it arrives.
- Task 8: the matcher covers the eight recorded characters that have a recorded brief; the match id
  is the kebab-cased name and the forge still finds its job by `one_line_request`.
- Task 9: `LibraryRecord` is `CharacterRecord`; `saveThumb` writes only while the stored key matches.
- Task 10: requirement 10.2 (PNG served as WebP) is NOT met and stays open: the PNGs are read by
  the pack builder and bundled by creator globs. `b00.wav` stays as a test source.
- Task 11: `--heat` stays on the stage root; readers of `--back` are found by `[data-back]` under
  the root ref instead of new refs.
- A character duplicated from the house character (Malakor) carries `house: true` and is never
  exported or published as a pack.

## Follow-up tasks 12-15 (2026-11-10)
Built in parallel worktrees off `main`, one Opus builder each. Doc rows (kiro-log, provenance)
are returned in reports and written by the Director.

| Task | Scope |
|---|---|
| 12 WebP | a conversion script under `scripts/`, the derived `.webp` files under `assets/`, the creator's art loaders and globs, `api/_lib/forge-replay.ts`, landing/cast image references, `scripts/vercel-output.mjs` |
| 13 Briefs | `assets/characters/cast/<slug>/brief.json` for the five (new folders hold only the brief), `packages/forge/src/brief*`, the client/server brief lists |
| 14 Cleanup | `apps/web/src/air` stage-light files and the test that pins `--heat`, `scripts/lipfit/`, `apps/lab/src/page/lip`, the Playwright configs |
| 15 Announcer | read-only bisect; a fix only in the Announcer's rig/look data or, if general, `packages/rig/src` |

- Task 12 encoding: `-q 90` colour with lossless alpha (`-alpha_q 100 -exact` or the library
  equivalent). Both files are kept; nothing is renamed.
- Task 13 brief field: `"authored": "after-recording"` (omitted on the eight recorded briefs).
