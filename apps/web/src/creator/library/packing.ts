// Library records to and from avatar packs (spec .kiro/specs/avatar-pack, design "Creator"):
// which records may leave, what a pack carries, how an imported pack joins the library without
// replacing anything, and the sentence a failed import shows.
import { packErrorSentence, type AvatarPack, type PackError, type PackInput, type PackLicence } from "@sr/pack";
import { DEFAULT_VOICE, isVoiceId, type CharacterRecord } from "./libraryStore";

/** Every character but the seeded house character (Malakor, pre-existing art) may leave. */
export function canExport(record: CharacterRecord): boolean {
  return record.seeded !== true;
}

/** The pack input for a record: its rig, images, look, voice and character sheet as saved now. */
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
    ...(record.sheet === undefined ? {} : { sheet: record.sheet }),
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
    ...(pack.sheet === undefined ? {} : { sheet: pack.sheet }),
  };
}

/** The user-facing sentence for a failed import (one map for every pack consumer, in @sr/pack). */
export const importError: (error: PackError) => string = packErrorSentence;
