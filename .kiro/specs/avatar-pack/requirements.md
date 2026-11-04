# Requirements: avatar-pack

## Introduction
A character made in Shadowrunner lives only in the browser's IndexedDB library. This spec lets it
leave: an **Avatar Pack** (`.srpack`) is one portable file - a zip holding the rig, every layer,
region map and expression face, the saved look, the voice and a manifest that says who made it and
how it may be used. The creator exports and imports packs; a React-free package `@sr/pack` reads
them anywhere (by URL or Blob), so later work (an embeddable player, a stream overlay, render to
video) can put a character on screen without the creator. The build publishes the recorded cast as
static packs so all of that works on the replay plane with no keys. Malakor (pre-existing art,
`docs/provenance.md`) is never exported.

Design decisions and rejected options: `.spark/Spark/ideas/avatar-pack.md` (local) and design.md.

## Requirement 1: The pack format
**User story:** As a developer, I want one documented file per character, so that I can load it in
my own app.
1. A pack SHALL be a zip (stored entries) holding `pack.json` (manifest), `rig.json` (the
   serialized rig), `README.txt` and every image the rig references under `files/<name>`.
2. The manifest SHALL carry format id, format version, app, export time, character id and name,
   look, voice, licence, optional author, rig source, `fictional` when the rig is fictional, the
   record's creation time when known, and the sorted list of image names.
3. Optional values SHALL be omitted, never `null` (as the rig format).
4. The format SHALL be documented in `docs/pack-format.md`.

## Requirement 2: Reading a pack
**User story:** As a developer, I want a pack checked before I render it, so that a bad file fails
with a reason instead of a broken face.
1. `readPack` SHALL return the rig, look, voice, image Blobs and manifest, or a typed error:
   not a pack, made by a newer version, bad manifest, bad rig, bad look, missing layer image, too
   large.
2. `loadPack` SHALL accept a URL or a Blob and add a fetch-failed error.
3. Every layer image SHALL be present; region maps and expression faces are kept when present.
4. `decodePackImages` SHALL turn the Blobs into premultiplied `ImageBitmap`s keyed by file name,
   ready for `@sr/avatar`'s renderer.
5. `@sr/pack` SHALL import only `@sr/rig` and `fflate`, never React or apps/.

## Requirement 3: Export from the creator
**User story:** As a streamer, I want to download my character, so that I can keep it or use it
elsewhere.
1. Each exportable Library card SHALL show an Export action; the character's channel actions panel
   SHALL show "Export pack".
2. Export SHALL open a sheet with an author name (remembered on this device) and a licence
   (All rights reserved, CC BY 4.0, CC BY-NC 4.0, CC0), then download `<name>.srpack`.
3. The pack SHALL carry the look and voice as saved at export time.
4. Malakor (the seeded record) SHALL NOT be exportable; every other character, forged or recorded
   cast, SHALL be.

## Requirement 4: Import into the creator
**User story:** As a streamer, I want to open a pack someone sent me, so that the character joins
my library.
1. The Library SHALL offer "Import pack" (file picker, `.srpack` / `.zip`) and accept a pack
   dropped on it.
2. A valid pack SHALL be added as a new character; when its id is taken it SHALL be added as a copy
   (`<id>-2`, `-3`, ...; name + " (copy)"), never replacing anything.
3. An unknown voice SHALL fall back to the default voice; the imported character is never seeded.
4. A failed import SHALL say why, in words, and change nothing.

## Requirement 5: Published cast packs
**User story:** As a judge, I want sample packs at real URLs, so that pack consumers work on a
first visit with no keys.
1. The build SHALL write one pack per recorded cast character (all of
   `assets/replay/forge/*` except `malakor`) to `/packs/<slug>.srpack`, plus `/packs/index.json`.
2. The packs SHALL be generated, not committed, and byte-identical between two runs.
3. `pnpm dev` and `pnpm build` SHALL both produce them.
