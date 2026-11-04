# Design: avatar-pack

## Overview
New package `packages/pack` (`@sr/pack`): React-free, depends on `@sr/rig` and `fflate` only.
It writes and reads `.srpack` files. The creator (apps/web) maps library records to and from packs
and adds the Export sheet and Import action. A Node script builds the cast packs with the same
writer. Owner decisions (2026-11-04): zip via fflate; export + import + `loadPack` + manifest with
licence; id clash -> copy; every character but Malakor exportable; export on Library card and in
the channel actions; export sheet with author and licence; cast packs generated at build.

## Container
A zip with **stored** (level 0) entries - the images are already compressed. Entries, in order:

| path | content |
|---|---|
| `pack.json` | `PackManifest`, JSON, 2-space indent, trailing newline |
| `rig.json` | `serializeRig(rig)` |
| `README.txt` | plain text: name, what a .srpack is, licence, author, fictional note, link to the format doc |
| `files/<name>` | one entry per image, `<name>` = the rig's file key (`Layer.file`, region map, patch file), sorted |

Entry modification times are fixed (`2026-01-01T00:00:00Z`) so a pack's bytes depend only on its
inputs. Only file keys returned by `rigFiles(rig)` (the order the renderer loads) are written;
images given that the rig does not reference are dropped. A file key is a relative POSIX path
(the rig validator already refuses others); a rig whose layer `file` is a `data:` URL is written
with that image moved to `files/<layer name>.<png|webp>` (extension from the data URL's MIME; the
rig accepts PNG and WebP since b7ed791) and the rig's `file` rewritten to that name.

## Wire types (`packages/pack/src/types.ts`)
```ts
export const PACK_FORMAT = "srpack";
export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 50 * 1024 * 1024;
export const PACK_EXTENSION = ".srpack";
export const PACK_LICENCES = ["all-rights-reserved", "CC-BY-4.0", "CC-BY-NC-4.0", "CC0-1.0"] as const;
export type PackLicence = (typeof PACK_LICENCES)[number];

export interface PackManifest {
  format: "srpack";
  version: 1;
  app: "shadowrunner";
  exportedAt: string;          // ISO 8601
  id: string;                  // === rig.id
  name: string;                // === rig.name
  look: Look;
  voice: string;               // a VoiceId when written by Shadowrunner; readers must tolerate others
  licence: PackLicence;
  author?: string;             // omitted when empty after trim
  source: Rig["source"];
  fictional?: true;            // present iff rig.fictional
  createdAt?: string;          // the library record's createdAt when known
  files: string[];             // every image under files/, sorted
}

export interface AvatarPack {
  manifest: PackManifest;
  rig: Rig;
  look: Look;
  voice: string;
  files: Record<string, Blob>;  // keyed by file name, MIME from extension (png/webp/jpg)
}

export interface PackInput {
  rig: Rig;
  look: Look;
  voice: string;
  files: Record<string, Blob | Uint8Array>;
  licence: PackLicence;
  author?: string;
  createdAt?: string;
  exportedAt?: string;          // default: now
}

export type PackErrorCode =
  | "not_a_pack" | "newer_version" | "bad_manifest" | "bad_rig" | "bad_look"
  | "missing_file" | "too_large" | "fetch_failed";
export interface PackError { code: PackErrorCode; detail: string }
export type PackResult = { ok: true; pack: AvatarPack } | { ok: false; error: PackError };
```

## API (`packages/pack/src/index.ts`)
- `writePack(input: PackInput): Promise<Uint8Array>` - throws `Error` when a layer image is
  missing from `input.files` (a caller bug, not a user error).
- `readPack(source: Uint8Array | ArrayBuffer | Blob): Promise<PackResult>` - order of checks:
  size > `PACK_MAX_BYTES` -> `too_large`; unzip fails or no `pack.json` or `format !== "srpack"`
  -> `not_a_pack`; `version > 1` -> `newer_version`; manifest shape (strings non-empty, licence in
  `PACK_LICENCES`, `files` string array) -> `bad_manifest`; `rig.json` via `parseRigJson` ->
  `bad_rig` (detail = first error path + message); `manifest.id !== rig.id` -> `bad_manifest`;
  look via `readLook(manifest.look, rig)` undefined -> `bad_look`; any layer `file` absent from
  the zip -> `missing_file` (detail = the name). Region maps and patches absent: kept absent.
  Entries not referenced by the rig are ignored.
- `loadPack(source: string | URL | Blob, init?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<PackResult>`
  - a Blob goes to `readPack`; a URL is fetched (non-2xx or network error -> `fetch_failed`).
- `decodePackImages(files: Record<string, Blob>): Promise<Record<string, ImageBitmap>>` -
  `createImageBitmap(blob, { premultiplyAlpha: "premultiply" })` per file, in parallel.
- `packFileName(name: string): string` - lower-case, non-alphanumerics to `-`, trimmed, max 60,
  `"character"` when empty, plus `.srpack`.
- `packReadme(manifest: PackManifest): string`.

## `readLook` moves to `@sr/rig`
`readLook(value, rig?)` (today `apps/web/src/creator/library/libraryStore.ts:100`) moves verbatim
to `packages/rig/src/readLook.ts` and is exported from `@sr/rig` with its helpers; libraryStore
imports and re-exports it so every current caller is unchanged. Rig cannot import `@sr/engine`
(layering), so the moved code replaces engine's `isEmotion` / `isGesture` with rig-owned checks:
`isLookEmotion(v)` = a string key of `EMOTION_TABLE` (`Object.hasOwn`), and `isLookGesture(v)` over
a new `GESTURE_NAMES = ["nod","tilt","lean_in","recoil","glare","flare"] as const satisfies readonly Gesture[]`
in `packages/rig/src/readLook.ts`. A test in `packages/engine` pins engine's `EMOTIONS` / `GESTURES`
equal (as sets) to rig's `EMOTION_TABLE` keys / `GESTURE_NAMES`.

## Creator
- `apps/web/src/creator/library/packing.ts`:
  `canExport(record: CharacterRecord): boolean` (`record.seeded !== true`);
  `packInputOf(record, { licence, author }): PackInput`;
  `recordOfPack(pack: AvatarPack, takenIds: ReadonlySet<string>, now?: Date): CharacterRecord` -
  id `pack.rig.id`, or `<id>-2`, `-3`, ... when taken, rig id and name rewritten (name + " (copy)")
  on a clash; voice kept when `isVoiceId`, else `DEFAULT_VOICE`; `createdAt` now; never `seeded`;
  `importError(error: PackError): string` - the user-facing sentence per code.
- `ExportSheet.tsx` (+ `.module.css`): a dialog with Author (text, max 60, remembered under
  localStorage key `sr-pack-author`, every access in try/catch), Licence (select over
  `PACK_LICENCES`, labels "All rights reserved", "CC BY 4.0", "CC BY-NC 4.0", "CC0"), Download and
  Cancel. Download: `writePack` -> Blob (`application/zip`) -> object URL -> `<a download>` ->
  revoke. States: idle, writing (button reads "Packing..."), error (sentence + retry).
- Library card: an Export icon button beside the delete control, absent for non-exportable
  records; opens the sheet for that record.
- Channel actions (`glass/SignalCards.tsx` `ChannelActions`): "Export pack", absent when the
  record is not exportable.
- Import: an "Import pack" button in the Library header beside "Replay gallery" opens a hidden
  `<input type="file" accept=".srpack,.zip">`; dropping a file anywhere on the Library section does
  the same (a visible drop highlight while dragging). Success: the record is added and a notice
  says "Imported <name>". Failure: a notice with `importError`. One file at a time.
- Strings inline (one locale); tokens only; the drop highlight and sheet have reduced-motion twins.

## Cast packs (build)
`scripts/build-packs.mjs` loads `@sr/pack`, `@sr/rig` and `@sr/engine` through Vite's
`runnerImport` (as `scripts/cast/regions.mjs`). For each `assets/replay/forge/<slug>/job.json`
except `malakor`: validate the rig (must be fictional), read every `rigFiles(rig)` file present in
the folder, and write `apps/web/public/packs/<slug>.srpack` with look `defaultLook(rig)`, voice
`castVoice(rig.id) ?? "crypt"`, licence `"all-rights-reserved"`, author `"Shadowrunner cast"`,
`exportedAt` and `createdAt` `"2026-11-04T00:00:00.000Z"`. Then `apps/web/public/packs/index.json`:
`[{ "id", "name", "file": "<slug>.srpack", "bytes" }]` sorted by id. `apps/web/public/packs/` is
git-ignored. Root `dev` and `build` scripts run it first. Vite serves `public/` in dev and copies it
to `dist/`, so `scripts/vercel-output.mjs` publishes `/packs/**` unchanged.

## Testing
- pack: round trip (write -> read equals input rig, look, voice, image bytes); determinism (same
  input, same bytes); each error code from a crafted zip; `data:` layer moved to `files/`; images
  not in the rig dropped; `loadPack` with a stub fetch (2xx, 404, throw).
- rig: `readLook` tests move with it.
- web: `recordOfPack` clash ids and voice fallback; `canExport`; DOM: card Export absent for
  Malakor, sheet remembers author, import of a valid pack adds a record, a junk file shows the
  not-a-pack sentence.
- build-packs: run on two cast folders into a temp dir twice, identical bytes, malakor skipped,
  every pack passes `readPack`.
