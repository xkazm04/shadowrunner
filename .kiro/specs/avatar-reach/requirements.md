# Requirements: avatar-reach

## Introduction
Avatar packs (spec `avatar-pack`) let a character leave the library as a `.srpack`. This spec puts
a pack to work in three places outside the creator, each an MVP that works end to end on the replay
plane with the published cast packs (`/packs/<slug>.srpack`):

- **Embed** (`/embed` + `sr-avatar.js`): a `<sr-avatar>` web component any site can drop in.
- **Overlay** (`/overlay`): a chrome-less page for OBS: transparent background, microphone
  lip-sync, mood hotkeys, configured by URL.
- **Studio** (`/studio`): type a line, hear it in the character's voice (live TTS), record the
  talking character as a WebM video.

All three share one React-free player core in `@sr/avatar`. Owner decisions (2026-11-04): routes in
the web app; a web component for the embed; overlay = mic + hotkeys/URL + transparent or chroma
background (no chat); studio audio = script through live TTS. Director decision: on the replay
plane the studio offers that character's recorded show lines instead of free text.

## Requirement 1: Player core
1. `@sr/avatar` SHALL export `createAvatarPlayer(canvas, options)`, React-free, that renders a rig
   with its look and assets, runs its own frame loop or steps on demand, and takes its mouth level
   from an audio source (element, node or `MediaStream`) or from a number set by the caller.
2. It SHALL change mood (look emotion, crossfaded as on the stage) and fire gestures at runtime.
3. It SHALL honour reduced motion (media query, or an explicit option) like `AvatarCanvas`.
4. `AvatarCanvas` SHALL keep its behaviour (its tests stay green, unchanged).

## Requirement 2: Embed
1. A single ES module script `/embed/sr-avatar.js` SHALL define `<sr-avatar>` with attributes
   `src` (pack URL), `mood`, `mic` (boolean: lip-sync to the microphone after a click),
   `background` (CSS colour, default transparent) and a JS API `setMood()`, `gesture()`,
   `setLevel()`, `attachAudio()`.
2. The element SHALL size to its box, show a text state while loading and a sentence on failure,
   and dispose everything when removed.
3. `/embed` SHALL show a live example on a cast pack, a pack picker, and the copy-paste snippet.
4. The script SHALL be built by `pnpm build` (deployed at `/embed/sr-avatar.js`).

## Requirement 3: Overlay
1. `/overlay` SHALL render only the character: no shell, no header, transparent page background.
2. It SHALL be configured by URL: `pack` (cast slug or pack URL), `character` (a library id on this
   browser), `mood`, `bg` (`transparent` default, `green`, or a `#rrggbb`), `mic` (`1` = listen).
3. With `mic=1` it SHALL lip-sync to the microphone; when the browser needs a gesture or refuses
   permission, a small click-to-start / reason line shows (hidden once running).
4. Keys `1`-`6` SHALL switch mood (one per expression family), `0` neutral, `G` a gesture.
5. `/overlay` without parameters SHALL show a small setup card that builds the URL to paste into
   OBS (pack picker, background, mic) and says how to allow the mic in OBS.

## Requirement 4: Studio
1. `/studio` SHALL let the user pick a character (cast packs, the local library, or an uploaded
   `.srpack`), see it live, and pick a background colour.
2. Live plane: a text box (max 300 characters, the `/api/voice` limit) sends the line in the
   character's voice; replay plane: a list of that character's recorded lines instead.
3. Preview SHALL play the line with lip-sync; Record SHALL render the same into a WebM
   (canvas + audio) and offer it for download, showing progress and a sentence on failure.
4. A browser without `MediaRecorder` / `captureStream` SHALL say so instead of offering Record.

## Requirement 5: Shell
1. `/embed`, `/overlay`, `/studio` SHALL be pages in the manifest, off the channel strip, each a
   lazy chunk; `/overlay` renders outside the shell chrome.
