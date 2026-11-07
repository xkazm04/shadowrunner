// A finished forge into the library (creator requirement 3.3): the validated rig plus every layer
// image fetched from its URL (data: on replay and dev, https Blob URLs on live) into a Blob.
// A job drawn from an approved brief is kept under the brief's name with its character sheet
// (C4: archetype, persona hook, example lines), so it goes on air as itself.
import type { CharacterBrief } from "@sr/forge/wire";
import { readSheet, type CharacterSheet } from "@sr/pack";
import { defaultLook, type Rig } from "@sr/rig";
import { extraFiles, urlsToBlobs, type BlobFetcher } from "../library/assets";
import { DEFAULT_VOICE, type CharacterRecord } from "../library/libraryStore";

/**
 * Only the files the rig uses, so a stray extra URL is never fetched: every layer image (required)
 * and the region maps and expression patches the job sent (character-control; optional).
 */
export function layerUrls(rig: Rig, assets: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of rig.layers) {
    const url = assets[layer.file];
    if (url === undefined) throw new Error(`no image for layer ${layer.name}`);
    out[layer.file] = url;
  }
  for (const file of extraFiles(rig)) {
    const url = assets[file];
    if (url !== undefined) out[file] = url;
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

/** The character sheet of an approved brief, or undefined when its fields break the sheet's limits. */
export function sheetOf(brief: CharacterBrief): CharacterSheet | undefined {
  return readSheet({ archetype: brief.archetype, hook: brief.persona_hook, lines: brief.example_lines ?? [] });
}

/** A kept record named as its brief, carrying the brief's character sheet. */
export function withBrief(record: CharacterRecord, brief: CharacterBrief): CharacterRecord {
  const sheet = sheetOf(brief);
  return { ...record, rig: { ...record.rig, name: brief.name }, ...(sheet === undefined ? {} : { sheet }) };
}
