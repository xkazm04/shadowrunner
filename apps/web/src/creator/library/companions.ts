// Companions in the creator (companion-lanes requirement 6.3): the packs in /packs/index.json that are
// not in the Halloween cast (Iris, Bun) are offered in the Library strip as one-press tiles, so a
// companion opens in the creator without a file picker. They never join the cast (requirement 5.3):
// the cast stays what the gallery lists; a companion is only an index entry whose id the cast lacks.
//
// Decisions the spec leaves open:
// - Nothing is offered until the cast has loaded: an unread cast would make every pack look like a
//   companion.
// - The pack is read exactly as Import pack reads a file (readPack via loadPack, recordOfPack), so a
//   companion kept this way equals one imported from its .srpack.
import { loadPack } from "@sr/pack";
import type { CharacterRecord } from "./libraryStore";
import { importError, recordOfPack } from "./packing";

export const PACK_INDEX = "/packs/index.json";

export interface CompanionEntry {
  /** The rig id (= the library record it becomes). */
  id: string;
  name: string;
  /** The pack file under /packs/. */
  file: string;
}

const isEntry = (v: unknown): v is CompanionEntry => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.name === "string" && typeof e.file === "string" && /^[a-z0-9-]+\.srpack$/.test(e.file);
};

/** The index entries whose id is not a cast member's, in index order; `[]` on any failure. */
export async function loadCompanions(castIds: ReadonlySet<string>, get: typeof fetch = (input, init) => globalThis.fetch(input, init)): Promise<CompanionEntry[]> {
  try {
    const response = await get(PACK_INDEX);
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return [];
    return body.filter(isEntry).flatMap((e) => (castIds.has(e.id) ? [] : [{ id: e.id, name: e.name, file: e.file }]));
  } catch {
    return [];
  }
}

/** The library record of a companion's pack (a copy id when its id is taken); throws a sentence when the pack does not read. */
export async function companionRecord(entry: CompanionEntry, takenIds: ReadonlySet<string>, get?: typeof fetch): Promise<CharacterRecord> {
  const result = await loadPack(`/packs/${entry.file}`, get === undefined ? undefined : { fetch: get });
  if (!result.ok) throw new Error(importError(result.error));
  return recordOfPack(result.pack, takenIds);
}
