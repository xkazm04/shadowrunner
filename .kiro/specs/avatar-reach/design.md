# Design: avatar-reach

## Overview
```
@sr/pack  loadPack -> decodePackImages        (spec avatar-pack)
apps/web/src/reach/playable.ts   loadPlayable(source) -> Playable | PackError   (pack/library -> renderer input)
@sr/avatar player/player.ts      createAvatarPlayer(canvas, { rig, look, assets }) -> AvatarPlayer
   |-- reach/embed/   <sr-avatar> custom element + EmbedPage (/embed) + vite.embed.config.ts
   |-- reach/overlay/ OverlayPage (/overlay)
   `-- reach/studio/  StudioPage (/studio)
```
Layering is unchanged: `@sr/avatar` imports only `@sr/rig`; the app glues pack to player.

## Player core (`packages/avatar/src/player/player.ts`, exported from `@sr/avatar`)
```ts
export interface AvatarPlayerOptions {
  rig: Rig;
  look: Look;
  assets: RigAssets;
  seed?: number;                       // default 1
  loadAsset?: AssetLoader;
  /** "auto" (default): prefers-reduced-motion. */
  reducedMotion?: boolean | "auto";
  /** Size the canvas to its parent with a ResizeObserver (default true). */
  autoSize?: boolean;
}
export type PlayerAudio = AudioNode | HTMLMediaElement | MediaStream;
export interface AvatarPlayer {
  setLook(look: Look): void;                 // emotion change crossfades (MOOD_FADE_S, as AvatarCanvas)
  setEmotion(emotion: Emotion): void;        // setLook({ ...look, emotion })
  gesture(gesture: Gesture): void;           // starts on the next frame
  attachAudio(source: PlayerAudio | undefined, options?: AttachAudioOptions): void;  // undefined detaches
  /** A level 0..1 that wins over the audio tap while set; undefined returns to the tap (or 0). */
  setLevel(level: number | undefined): void;
  resize(width: number, height: number, dpr: number): void;
  start(): void;                             // requestAnimationFrame loop, browser clock
  stop(): void;
  /** One step of `dt` seconds plus a draw, outside the loop (video, tests). */
  renderFrame(dt: number): void;
  dispose(): void;                           // stop, detach, dispose renderer
}
export function createAvatarPlayer(canvas: HTMLCanvasElement, options: AvatarPlayerOptions): AvatarPlayer;
```
The frame body is the one in `AvatarCanvas` (advanceFrame -> moodFader -> poseLayers(applyLook) ->
renderer.draw); the builder extracts the shared parts rather than copying them, without changing
`AvatarCanvas` behaviour. `attachAudio` in `audio/level.ts` gains `MediaStream` support
(`context.createMediaStreamSource`), with `AttachAudioOptions.context` honoured.

## Playable (`apps/web/src/reach/playable.ts`)
```ts
export interface Playable { id: string; name: string; rig: Rig; look: Look; voice: VoiceId; assets: RigAssets; licence?: PackLicence; author?: string }
export type PlayableSource = { pack: string } | { character: string } | { file: Blob };
export type PlayableResult = { ok: true; playable: Playable } | { ok: false; error: string };   // error = user sentence
export function packUrlOf(pack: string): string;      // slug ([a-z0-9-]+) -> "/packs/<slug>.srpack", else the value as a URL
export function loadPlayable(source: PlayableSource, init?: { signal?: AbortSignal }): Promise<PlayableResult>;
export interface CastEntry { id: string; name: string; file: string; bytes: number }
export function loadCastIndex(init?: { signal?: AbortSignal }): Promise<CastEntry[]>;   // /packs/index.json, [] on failure
```
- `pack`/`file` -> `loadPack` -> `decodePackImages` -> voice via `isVoiceId` else `DEFAULT_VOICE`.
- `character` -> `openLibrary().get(id)` -> `rigAssetsOf(rig, assets)`; missing -> error sentence.
- Errors reuse `importError` (`creator/library/packing.ts`) for pack errors.

## Pages and shell (director, task 0)
`PageId` gains `"embed" | "overlay" | "studio"`; `PageDef` gains `offStrip?: true` (filtered by
`stripPages`). Pages: `embed` "/embed" hotkey "E" "Embed", `overlay` "/overlay" hotkey "B"
"Overlay", `studio` "/studio" hotkey "V" "Studio", all `status: "live"`, `offStrip: true`. Shell:
`embed` and `studio` render framed through `ChannelBody` as lazy chunks
(`reach/embed/EmbedPage`, `reach/studio/StudioPage`, default exports taking `{ plane }`);
`overlay` renders `reach/overlay/OverlayPage` (default export `{ plane }`) as the only child of the
shell's root, with no header, frame, badge or strip (`data-shell` kept for the motion attribute).
The overlay carries no RECORDED badge: it plays only the user's own microphone, nothing recorded
(a badge would be captured onto the stream).

## Embed
- `apps/web/src/reach/embed/srAvatar.ts`: `defineSrAvatar(registry = customElements)` registers
  `sr-avatar` (idempotent). Shadow DOM: a canvas + a status line. Observed attributes `src`, `mood`,
  `mic`, `background`. Loads with `loadPack(src)` + `decodePackImages` (NOT library or app modules:
  the bundle must stay small and app-free - imports only `@sr/pack`, `@sr/avatar` core (no React),
  `@sr/rig`). `mic`: a "Click to listen" button in the shadow root starts `getUserMedia({audio:true})`.
  Events: `sr-ready`, `sr-error` (detail: sentence).
- `apps/web/src/reach/embed/entry.ts`: `defineSrAvatar()` - the library entry.
- `apps/web/vite.embed.config.ts`: Vite library mode, entry `src/reach/embed/entry.ts`, format `es`,
  `outDir: dist/embed`, `emptyOutDir: false`, file `sr-avatar.js`, React not bundled (not imported).
  `apps/web/package.json` `build` becomes `vite build && vite build -c vite.embed.config.ts`.
- `EmbedPage.tsx`: cast picker (`loadCastIndex`), live `<sr-avatar>` (the same element, defined in
  the app), mood buttons, a copy button for the snippet
  `<script type="module" src="<origin>/embed/sr-avatar.js"></script><sr-avatar src="<origin>/packs/<slug>.srpack" mood="..."></sr-avatar>`.
  Cross-origin note: packs are fetched by the embedding page; the doc says hosts must serve them
  with CORS or host their own copy.

## Overlay
- `OverlayPage.tsx`: parses `location.search` (`parseOverlayParams`, pure, tested). With a source:
  sets `html`/`body` background to the `bg` value for its lifetime (restores on unmount), a
  full-viewport canvas with `createAvatarPlayer`, `mic=1` -> `getUserMedia` on load, falling back to
  a click-to-start line on `NotAllowedError`/suspended AudioContext; hotkeys `1`-`6` = the six
  families' emotions, `0` neutral, `G` gesture `"nod"`; capture-phase listener so shell hotkeys do
  not fire. Without a source: `OverlaySetup` card (cast picker, library picker, bg, mic) building
  the URL with a copy button and the OBS note ("OBS Browser Source cannot ask for the microphone:
  start OBS with `--enable-media-stream`, or use Window Capture on this page in a browser").
- Mood keys map: the builder reads `EMOTION_FAMILY` (`packages/rig/src/control.ts`) and picks one
  emotion per `ExpressionFamily` (the first in table order), exported as `MOOD_KEYS`.

## Studio
- `StudioPage.tsx`: source picker (cast, library, upload), live player preview, background colour
  (tokens' swatches + a colour input), the line input, Preview, Record, download link.
- Voice: live plane -> `POST /api/voice { text, voice }` (WAV Blob); replay plane -> the character's
  recorded show lines (read `apps/web/src/air/show.ts` / `api/_lib/show.ts` / `assets/replay/shows/`
  for how recorded lines per character are found and played; reuse, do not duplicate the list).
- Lip-sync and recording: decode the WAV (`AudioContext.decodeAudioData`), play it through an
  `AudioBufferSourceNode` into both the player (`attachAudio(node)`) and a
  `MediaStreamAudioDestinationNode`; the canvas draws the background colour under the character
  (the player's canvas is transparent: draw into a second 2D canvas each frame, or set the canvas
  CSS background is NOT captured - so composite) and `canvas.captureStream(30)`; `MediaRecorder`
  (`video/webm;codecs=vp9,opus`, else `vp8,opus`, else `video/webm`) records video + audio tracks;
  stop at the buffer's end + 0.5 s; Blob -> object URL -> download `<name>-<n>.webm`.
- `canRecord()` pure check (MediaRecorder + captureStream + isTypeSupported).

## Testing
- player: frame stepping via `renderFrame` with a fake renderer (inject through an internal
  option or test seam), mood crossfade starts, gesture fires once, `setLevel` overrides the tap,
  dispose stops the loop; `attachAudio(MediaStream)` uses `createMediaStreamSource` (fake context).
- playable: slug vs URL, pack/library/file paths, errors as sentences (stub fetch + memory library).
- embed: element defines once, attributes reach the player (stubbed), `sr-error` on a 404.
- overlay: `parseOverlayParams` table test; hotkey map covers 1-6 and 0; setup builds the URL.
- studio: `canRecord` branches; replay line list for a cast character; the record pipeline with
  fake MediaRecorder (start/stop/dataavailable -> Blob).
- shell: the three pages route, are lazy, are off the strip; `/overlay` has no header.
