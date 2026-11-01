// A finished forge into the library (creator requirement 3.3): the validated rig plus every layer
// image fetched from its URL (data: on replay and dev, https Blob URLs on live) into a Blob.
import { defaultLook, type Rig } from "@sr/rig";
import { urlsToBlobs, type BlobFetcher } from "../library/assets";
import { DEFAULT_VOICE, type CharacterRecord } from "../library/libraryStore";

/** Only the files the rig's layers use, so a stray extra URL is never fetched. */
export function layerUrls(rig: Rig, assets: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of rig.layers) {
    const url = assets[layer.file];
    if (url === undefined) throw new Error(`no image for layer ${layer.name}`);
    out[layer.file] = url;
  }
  return out;
}

/** A new library record for a forged (or adopted) rig: default look, default voice. */
export async function recordOf(
  rig: Rig,
  assets: Readonly<Record<string, string>>,
  options: { fetcher?: BlobFetcher; now?: () => Date } = {},
): Promise<CharacterRecord> {
  return {
    id: rig.id,
    rig,
    assets: await urlsToBlobs(layerUrls(rig, assets), options.fetcher),
    look: defaultLook(rig),
    voice: DEFAULT_VOICE,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}
