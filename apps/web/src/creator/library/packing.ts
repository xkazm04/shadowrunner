// Library records to and from avatar packs (spec .kiro/specs/avatar-pack, design "Creator"):
// which records may leave, what a pack carries, how an imported pack joins the library without
// replacing anything, and the sentence a failed import shows.
import type { AvatarPack, PackError, PackErrorCode, PackInput, PackLicence } from "@sr/pack";
import { DEFAULT_VOICE, isVoiceId, type CharacterRecord } from "./libraryStore";

/** Every character but the seeded house character (Malakor, pre-existing art) may leave. */
export function canExport(record: CharacterRecord): boolean {
  return record.seeded !== true;
}

/** The pack input for a record: its rig, images, look and voice as saved now. */
export function packInputOf(record: CharacterRecord, { licence, author }: { licence: PackLicence; author?: string }): PackInput {
  const name = author?.trim() ?? "";
  return {
    rig: record.rig,
    look: record.look,
    voice: record.voice,
    files: record.assets,
    licence,
    ...(name === "" ? {} : { author: name }),
    createdAt: record.createdAt,
  };
}

/** The first free id: `id`, else `id-2`, `id-3`, ... */
function freeId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n += 1) if (!taken.has(`${id}-${n}`)) return `${id}-${n}`;
}

/** A new library record for a pack: a copy (`<id>-2`, name + " (copy)") when its id is taken; never seeded. */
export function recordOfPack(pack: AvatarPack, takenIds: ReadonlySet<string>, now: Date = new Date()): CharacterRecord {
  const id = freeId(pack.rig.id, takenIds);
  const rig = id === pack.rig.id ? pack.rig : { ...pack.rig, id, name: `${pack.rig.name} (copy)` };
  return {
    id,
    rig,
    assets: { ...pack.files },
    look: pack.look,
    voice: isVoiceId(pack.voice) ? pack.voice : DEFAULT_VOICE,
    createdAt: now.toISOString(),
  };
}

const SENTENCES: Readonly<Record<PackErrorCode, (detail: string) => string>> = {
  not_a_pack: () => "That file is not a Shadowrunner pack.",
  newer_version: () => "That pack was made by a newer Shadowrunner.",
  bad_manifest: () => "That pack's details are damaged.",
  bad_rig: () => "That pack's character is damaged.",
  bad_look: () => "That pack's saved look is damaged.",
  missing_file: (detail) => `That pack is missing ${detail === "" ? "an image" : detail}.`,
  too_large: () => "That pack is over 50 MB.",
  fetch_failed: () => "That pack could not be fetched.",
};

/** The user-facing sentence for a failed import. */
export function importError(error: PackError): string {
  return SENTENCES[error.code](error.detail);
}
