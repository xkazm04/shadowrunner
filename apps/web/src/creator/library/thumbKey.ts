// The library strip's stored still (perfection-pass task 9, requirement 9.1): what a record keeps
// (`CharacterRecord.thumb`) and the key that says which record and look it shows. Pure, no DOM, so
// the store reads it; the still itself is drawn by thumbnail.ts.
// - key = a hash of the record id, createdAt and the look. The look is written as canonical JSON
//   (object keys sorted, undefined left out), so a look read back from IndexedDB (readLook) keys
//   the same as the reducer's object it was saved from. The name is not in it: a rename keeps it.
// - The hash is two 32-bit FNV-1a passes: a cache key, not a secret.
import type { Look } from "@sr/rig";

export interface Thumb {
  blob: Blob;
  key: string;
}

/** JSON with every object's keys sorted. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const fields = Object.keys(value)
      .sort()
      .flatMap((k) => {
        const v: unknown = Reflect.get(value, k);
        return v === undefined ? [] : [`${JSON.stringify(k)}:${canonicalJson(v)}`];
      });
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Two 32-bit FNV-1a hashes (different offset bases) of `text`'s UTF-16 code units, base 36. */
export function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

/** The key of the still a record should show. */
export function thumbKey(record: { id: string; createdAt: string; look: Look }): string {
  return hash64(`${record.id}\n${record.createdAt}\n${canonicalJson(record.look)}`);
}

/** A stored thumb, or undefined when it is off-contract (the strip then makes one again). */
export function readThumb(value: unknown): Thumb | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const blob: unknown = Reflect.get(value, "blob");
  const key: unknown = Reflect.get(value, "key");
  return blob instanceof Blob && typeof key === "string" && key !== "" ? { blob, key } : undefined;
}

/** Whether the record's stored still shows it as it is now. */
export const thumbIsCurrent = (record: { id: string; createdAt: string; look: Look; thumb?: Thumb }): boolean => record.thumb?.key === thumbKey(record);
