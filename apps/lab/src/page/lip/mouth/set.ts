// L2's mouth sets on the page: var/lab/mouths/<character>/ as the Node generator writes it
// (src/mouths): manifest.json + one PNG per shape, the crop square in rig px. Vite finds them with
// import.meta.glob (the stage serves the repo root, so var/ is reachable) at the moment the stage
// starts; a set generated later needs a new run. Pure parts (manifest check) are tested.
import { readManifest, type MouthSetManifest } from "./manifest.js";
import type { MouthShape } from "./shapes.js";

export { readManifest, type MouthSetManifest };

const MANIFESTS = import.meta.glob<unknown>("../../../../../../var/lab/mouths/*/manifest.json", { eager: true, import: "default" });
const IMAGES = import.meta.glob<string>("../../../../../../var/lab/mouths/*/*.png", { eager: true, query: "?url", import: "default" });

export interface FoundSet {
  manifest: MouthSetManifest;
  /** Shape -> URL the page can fetch. */
  urls: Partial<Record<MouthShape, string>>;
}

/** The set generated for `character`, or a sentence saying why there is none. */
export function findMouthSet(character: string): FoundSet | string {
  const key = Object.keys(MANIFESTS).find((path) => path.endsWith(`/mouths/${character}/manifest.json`));
  if (key === undefined) return `no mouth set for "${character}" under var/lab/mouths/ (generate one: node --import ./apps/lab/src/hooks.mjs apps/lab/src/mouths/main.ts ${character})`;
  const manifest = readManifest(MANIFESTS[key]);
  if (typeof manifest === "string") return `var/lab/mouths/${character}/manifest.json: ${manifest}`;
  const folder = key.slice(0, -"manifest.json".length);
  const urls: Partial<Record<MouthShape, string>> = {};
  for (const [shape, file] of Object.entries(manifest.shapes) as [MouthShape, string][]) {
    const url = IMAGES[`${folder}${file}`];
    if (url !== undefined) urls[shape] = url;
  }
  return { manifest, urls };
}
