// Rename and duplicate (perfection-pass task 7, requirement 7.3), as pure rules over records.
// - A name is trimmed, inner whitespace collapsed, at most NAME_MAX characters; an empty one is
//   refused. It is the rig's name (what the strip, the stage and a pack call the character).
// - The seeded house character (Malakor) keeps his name: renaming him is refused, like deleting.
// - A duplicate is a variant: a new id (`<id>-2`, `-3`, ... the first free one, as an imported
//   pack's copy), the name "<name> (variant)", the same images, look, voice, sheet and face notes,
//   created now, never seeded. Its repaint source is kept, so a variant may take its own repaint.
// - A variant of the house character, or of one of his variants, is marked `house`: it is built on
//   pre-existing art (docs/provenance.md), so it is never exported or published as a pack, though,
//   unlike him, it may be renamed and deleted.
import type { Rig } from "@sr/rig";
import type { CharacterRecord } from "./libraryStore";

export const NAME_MAX = 60;

/** The name as kept, or undefined when it is empty. */
export function cleanName(name: string): string | undefined {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return clean === "" ? undefined : clean;
}

/** The first free id: `id`, else `id-2`, `id-3`, ... */
export function freeId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n += 1) if (!taken.has(`${id}-${n}`)) return `${id}-${n}`;
}

/** Built on the house character's art: never leaves as a pack. */
export const isHouseArt = (record: Pick<CharacterRecord, "seeded" | "house">): boolean => record.seeded === true || record.house === true;

/** The record renamed, or undefined when the name is empty or the record is the house character. */
export function renamed(record: CharacterRecord, name: string): CharacterRecord | undefined {
  const clean = cleanName(name);
  if (clean === undefined || record.seeded === true) return undefined;
  return clean === record.rig.name ? record : { ...record, rig: { ...record.rig, name: clean } };
}

/** A variant of `record` under a free id (see the header). */
export function variantOf(record: CharacterRecord, taken: ReadonlySet<string>, now: Date = new Date()): CharacterRecord {
  const id = freeId(record.id, taken);
  const suffix = " (variant)";
  const name = `${record.rig.name.slice(0, NAME_MAX - suffix.length).trim()}${suffix}`;
  const next: CharacterRecord = { ...record, id, rig: { ...record.rig, id, name }, assets: { ...record.assets }, look: structuredClone(record.look), createdAt: now.toISOString() };
  delete next.seeded;
  delete next.house;
  if (isHouseArt(record)) next.house = true;
  return next;
}

/** The same art: every field of the rig but its name is the same value (by identity). */
export function sameArt(a: Rig, b: Rig): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("name");
  return [...keys].every((k) => Reflect.get(a, k) === Reflect.get(b, k));
}
