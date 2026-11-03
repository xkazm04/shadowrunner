# Design: creator

## Overview
A page in the shell's manifest (`creator`, `/creator`) built from small components over three
pure reducers (look edits, forge job, library list) plus two I/O adapters (IndexedDB library,
forge client). Behaviour lives in the reducers and adapters so it is testable without a browser
GPU; components only render state and dispatch.

```
apps/web/src/creator/CreatorPage.tsx        regions: stage | controls | library
apps/web/src/creator/Stage.tsx              <AvatarCanvas> + speak-a-line audio
apps/web/src/creator/customize/Customize.tsx
apps/web/src/creator/customize/PaletteField.tsx
apps/web/src/creator/customize/PartToggles.tsx
apps/web/src/creator/customize/EmotionPicker.tsx
apps/web/src/creator/customize/GestureBar.tsx
apps/web/src/creator/customize/lookReducer.ts      pure: LookAction -> Look
apps/web/src/creator/forge/ForgePanel.tsx          form + progress + failure states
apps/web/src/creator/forge/forgeReducer.ts         pure: job state machine
apps/web/src/creator/forge/useForgeJob.ts          polling hook (resumes by jobId from sessionStorage)
apps/web/src/creator/forge/image.ts                client-side downscale/validate
apps/web/src/creator/forgeClient.ts                ForgeClient interface + HTTP implementation
apps/web/src/creator/forgeClient.replay.ts         replay implementation (tests + replay plane)
apps/web/src/creator/library/libraryStore.ts       IndexedDB adapter + in-memory fallback
apps/web/src/creator/library/seed.ts               Malakor seed via importLegacyLayers or committed rig
apps/web/src/creator/library/assets.ts             dataUrl <-> Blob, Blob -> ImageBitmap
apps/web/src/creator/library/Library.tsx
apps/web/src/creator/gallery/Gallery.tsx           replay gallery
apps/web/src/creator/*.module.css                  role tokens only
```

## Contracts
```ts
import type { Rig, Look, Emotion, Gesture, Palette } from "@sr/rig";

// Forge wire contract: OWNED by forge-pipeline in `@sr/forge/wire` (packages/forge/src/wire.ts,
// types only, safe to import in the browser). Never redeclare these here.
import type { ForgeRequest, ForgeStatus, ForgeErrorCode, JobView } from "@sr/forge/wire";
// Every ForgeStatus gets a staged-progress label, including "filling".
// JobView.assets values are URLs (https Blob URLs on live, data: URLs on replay); the library
// fetches each into a Blob before saving. JobView.portraitUrl is shown as soon as it exists.
export interface ForgeClient {
  start(req: ForgeRequest): Promise<{ jobId: string }>;   // POST /api/forge
  poll(jobId: string): Promise<JobView>;                  // GET /api/forge/:jobId
}

// Library record (IndexedDB "sr-library" / store "characters", keyPath "id")
export interface CharacterRecord {
  id: string;                     // = rig.id
  rig: Rig;
  assets: Record<string, Blob>;   // keyed by Layer.file
  look: Look;
  voice: VoiceId;                 // import type { VoiceId } from "@sr/engine" (owned by voice-and-air)
  createdAt: string;              // ISO 8601
  seeded?: true;                  // Malakor; cannot be deleted
}

export type LookAction =
  | { type: "palette"; key: keyof Palette; value: string }
  | { type: "toggle"; layer: string }
  | { type: "emotion"; emotion: Emotion }
  | { type: "reset"; rig: Rig };

export type ForgeState =
  | { phase: "idle" }
  | { phase: "running"; jobId: string; status: Exclude<ForgeStatus, "done" | "failed">; startedAt: number }
  | { phase: "done"; rig: Rig }
  | { phase: "failed"; code: ForgeErrorCode; message: string; retry: ForgeRequest };
```
Gestures are events, not state: `GestureBar` passes the last-pressed `Gesture` to `<AvatarCanvas gesture>`.
Absent optional fields are omitted, never `null`. Poll interval 1.5 s, backoff to 5 s after 60 s;
a 5-minute client timeout becomes `failed/upstream`.

## Plane and client selection
`usePlane()` (m0-spine) picks `forgeClient.replay.ts` on `replay`, the HTTP client on `live`.
The replay client walks `queued → portrait → segmenting → cutting → done` with recorded
timings from `assets/replay/forge-timings.json` and returns a gallery rig; with `?forge=fail:<code>`
it returns that failure, so every error state is reachable in replay and in tests.

## Layout and tokens
Desktop: stage occupies ≥ 60% width on the left; controls (tabs: Customize | Forge) top-right;
library strip bottom-right. 390 px: stage, then controls, then library. New role tokens this spec
may need are requested from `packages/theme` (`--sr-face-glow`, `--sr-surface-*`,
`--sr-signal-*`), never hard-coded; the `landing` spec rebinds them to the contest winner.

## Testing strategy
- fast-check: `lookReducer` never mutates input (deep-freeze), palette values stay `#rrggbb`,
  `toggle` twice is identity, `reset` equals `defaultLook(rig)`.
- fast-check: `forgeReducer` over arbitrary status sequences only moves forward through the
  status order, ends in `done` or `failed`, and `failed` always keeps the original request.
- Library adapter tested with `fake-indexeddb`: seed on empty, damaged record listed not
  rendered, Malakor delete refused, in-memory fallback when `indexedDB` is undefined.
- Component tests (Testing Library) with the replay client: each failure code renders its
  state; quota offers the gallery; resume-by-jobId after remount.
- `image.ts`: rejects > 5 MB and non-image types; downscales to ≤ 1024 px.

## Amendment: character-control (2026-11-03)
The right column gains a Mood / Look switch. Look holds the Palette card (lights and colour regions,
also picked by clicking the glass) and the Shape card (the selected part's size, stretch, offset and
tilt). "Put on air" records the active character (`sr.onAir`) so CH 2 and the stage show it with its
look. Details: `.kiro/specs/character-control/design.md` "Creator UI" and "On air".
