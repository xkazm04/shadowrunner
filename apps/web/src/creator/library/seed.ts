// Malakor, the seeded character (creator requirement 2.2, task 3.3): when the library is empty the
// creator adds him from `assets/characters/malakor/` with his default look. Since creator task 9
// the whole cast is seeded (`seedCast`): Malakor and every recorded preset.
//
// Decisions the spec leaves open:
// - The committed rig is his Overlord-era `layers.json` + `m8.spec.json`, so the seed goes through
//   `importLegacyLayers` (as the avatar bench does) and is renamed: id `malakor`, name
//   "Arch-Lich Malakor", `fictional: true` (original fiction, bible.md). His voice is `clerk`
//   (voices.ts: "Malakor uses `clerk`").
// - "Empty" means no stored value at all: a library holding only damaged records is not reseeded
//   over, so nothing the user had is silently replaced.
import { defaultLook, importLegacyLayers, type Rig } from "@sr/rig";
import layersJson from "../../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../../assets/characters/malakor/rig/m8.spec.json";
import { urlsToBlobs, type BlobFetcher } from "./assets";
import type { CharacterRecord, LibraryStore } from "./libraryStore";

export const MALAKOR_ID = "malakor";
export const MALAKOR_NAME = "Arch-Lich Malakor";

const PNG_URLS = import.meta.glob<string>(["../../../../../assets/characters/malakor/rig/*.png", "!**/depth.png"], {
  eager: true,
  query: "?url",
  import: "default",
});

/** Layer file name -> bundled URL. */
export function malakorFiles(): Record<string, string> {
  return Object.fromEntries(Object.entries(PNG_URLS).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]));
}

/** His rig, imported from the committed legacy files and renamed. Throws if the art stops importing. */
export function malakorRig(): Rig {
  const result = importLegacyLayers(layersJson, specJson);
  if (!result.ok) throw new Error(`Malakor did not import: ${result.errors.map((e) => e.message).join("; ")}`);
  return { ...result.value.rig, id: MALAKOR_ID, name: MALAKOR_NAME, fictional: true };
}

/** The layer file -> URL map for `rig` (only the files its layers use). */
export function malakorAssetUrls(rig: Rig): Record<string, string> {
  const files = malakorFiles();
  const out: Record<string, string> = {};
  for (const layer of rig.layers) {
    const url = files[layer.file];
    if (url === undefined) throw new Error(`Malakor is missing ${layer.file}`);
    out[layer.file] = url;
  }
  return out;
}

/** The seeded record: his rig, every layer image as a Blob, default look, `clerk`. */
export async function loadMalakor(fetcher?: BlobFetcher, now: () => Date = () => new Date()): Promise<CharacterRecord> {
  const rig = malakorRig();
  return {
    id: rig.id,
    rig,
    assets: await urlsToBlobs(malakorAssetUrls(rig), fetcher),
    look: defaultLook(rig),
    voice: "clerk",
    createdAt: now().toISOString(),
    seeded: true,
  };
}

/** Seeds Malakor when the store holds nothing. True when it seeded. */
export async function seedIfEmpty(store: LibraryStore, load: () => Promise<CharacterRecord> = () => loadMalakor()): Promise<boolean> {
  if ((await store.list()).length > 0) return false;
  await store.put(await load());
  return true;
}

/** One character the cast seed may place: its rig id and how to build its record. */
export interface CastSeed {
  id: string;
  load(): Promise<CharacterRecord>;
}

export interface SeedCastOptions {
  /** Called after each record is stored, so the strip can fill as they arrive. */
  onAdded?: (id: string) => void;
  /**
   * The seed's clock. A member's record is created at `now() + its index in the cast` ms, so the
   * strip lists the cast in order however many passes it takes (pass the same clock to each).
   */
  now?: () => Date;
  /** Seeds only these ids in this pass (the stage's first character); the rest wait for the next. */
  only?: ReadonlySet<string>;
}

/**
 * Seeds the cast (creator task 9): every member the ledger has never placed and the store does not
 * hold (ok or damaged) is added once with its default look, in order, and then entered in the
 * ledger. A member already in the store (adopted earlier, maybe with an edited look) is entered
 * without being touched, so nothing is duplicated or overwritten, and a member the user later
 * deleted is not put back. One that fails to load is skipped and tried again on the next visit.
 * Returns the ids it added.
 */
export async function seedCast(store: LibraryStore, cast: readonly CastSeed[], options: SeedCastOptions = {}): Promise<string[]> {
  const ledger = new Set((await store.seededIds()) ?? []);
  const present = new Set((await store.list()).map((e) => (e.kind === "ok" ? e.record.id : e.id)));
  const added: string[] = [];
  const base = (options.now ?? (() => new Date()))().getTime();
  for (const [i, member] of cast.entries()) {
    if (ledger.has(member.id) || (options.only !== undefined && !options.only.has(member.id))) continue;
    if (!present.has(member.id)) {
      let record: CharacterRecord;
      try {
        record = await member.load();
      } catch {
        continue;
      }
      // The id is the record key: a member whose record says otherwise is not the member.
      if (record.id !== member.id) continue;
      await store.put({ ...record, createdAt: new Date(base + i).toISOString() });
      present.add(member.id);
      added.push(member.id);
    }
    ledger.add(member.id);
    await store.writeSeededIds([...ledger]);
    if (added.at(-1) === member.id) options.onAdded?.(member.id);
  }
  return added;
}
