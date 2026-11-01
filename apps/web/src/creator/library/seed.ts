// Malakor, the seeded character (creator requirement 2.2, task 3.3): when the library is empty the
// creator adds him from `assets/characters/malakor/` with his default look.
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
