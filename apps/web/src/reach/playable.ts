// A character ready for the player (spec avatar-reach, design "Playable"): from a cast pack, a pack
// URL, an uploaded .srpack or a library record.
//
// Decisions the spec leaves open:
// - A pack's `id` and `name` are its rig's (= the manifest's); a library record's are the record's
//   id and its rig's name. Licence and author come only from a pack.
// - Every failure is a sentence (never a throw): pack errors reuse the creator's import sentences,
//   images that will not decode and library misses have their own.
// - An aborted load resolves to an error like any other; callers that aborted ignore it.
import type { RigAssets } from "@sr/avatar/core";
import type { VoiceId } from "@sr/engine";
import { decodePackImages, loadPack, type PackLicence } from "@sr/pack";
import type { Look, Rig } from "@sr/rig";
import { rigAssetsOf } from "../creator/library/assets";
import { DEFAULT_VOICE, isVoiceId, openLibrary } from "../creator/library/libraryStore";
import { importError } from "../creator/library/packing";

export interface Playable {
  id: string;
  name: string;
  rig: Rig;
  look: Look;
  voice: VoiceId;
  assets: RigAssets;
  licence?: PackLicence;
  author?: string;
}

export type PlayableSource = { pack: string } | { character: string } | { file: Blob };

/** `error` is a sentence for the user. */
export type PlayableResult = { ok: true; playable: Playable } | { ok: false; error: string };

export interface CastEntry {
  id: string;
  name: string;
  file: string;
  bytes: number;
}

const CAST_SLUG = /^[a-z0-9-]+$/;
const CAST_INDEX = "/packs/index.json";

export const UNDECODABLE = "That pack's images could not be read.";
export const NOT_IN_LIBRARY = "That character is not in this browser's library.";
export const DAMAGED_RECORD = "That character is damaged in this browser's library.";

/** A cast slug (`[a-z0-9-]+`) -> `/packs/<slug>.srpack`; anything else is taken as a URL. */
export function packUrlOf(pack: string): string {
  return CAST_SLUG.test(pack) ? `/packs/${pack}.srpack` : pack;
}

/** The pack slug of an index entry: its `file` without the extension (ids may differ, e.g. `replay-the-tallyman`). */
export function castSlugOf(entry: CastEntry): string {
  return entry.file.replace(/.srpack$/, "");
}

const fail = (error: string): PlayableResult => ({ ok: false, error });

async function fromPack(source: string | Blob, signal: AbortSignal | undefined): Promise<PlayableResult> {
  const result = await loadPack(typeof source === "string" ? packUrlOf(source) : source, signal === undefined ? undefined : { signal });
  if (!result.ok) return fail(importError(result.error));
  const { pack } = result;
  let assets: RigAssets;
  try {
    assets = await decodePackImages(pack.files);
  } catch {
    return fail(UNDECODABLE);
  }
  const { licence, author } = pack.manifest;
  return {
    ok: true,
    playable: {
      id: pack.rig.id,
      name: pack.manifest.name,
      rig: pack.rig,
      look: pack.look,
      voice: isVoiceId(pack.voice) ? pack.voice : DEFAULT_VOICE,
      assets,
      licence,
      ...(author === undefined ? {} : { author }),
    },
  };
}

async function fromLibrary(id: string): Promise<PlayableResult> {
  let entry;
  try {
    entry = await (await openLibrary()).get(id);
  } catch {
    return fail(NOT_IN_LIBRARY);
  }
  if (entry === undefined) return fail(NOT_IN_LIBRARY);
  if (entry.kind !== "ok") return fail(DAMAGED_RECORD);
  const { record } = entry;
  try {
    const assets = await rigAssetsOf(record.rig, record.assets);
    return { ok: true, playable: { id: record.id, name: record.rig.name, rig: record.rig, look: record.look, voice: record.voice, assets } };
  } catch {
    return fail(DAMAGED_RECORD);
  }
}

export function loadPlayable(source: PlayableSource, init?: { signal?: AbortSignal }): Promise<PlayableResult> {
  if ("character" in source) return fromLibrary(source.character);
  return fromPack("pack" in source ? source.pack : source.file, init?.signal);
}

const isCastEntry = (v: unknown): v is CastEntry => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.name === "string" && typeof e.file === "string" && typeof e.bytes === "number";
};

/** `/packs/index.json`; `[]` on any failure. Malformed entries are dropped. */
export async function loadCastIndex(init?: { signal?: AbortSignal }): Promise<CastEntry[]> {
  try {
    const response = await fetch(CAST_INDEX, init?.signal === undefined ? undefined : { signal: init.signal });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    return Array.isArray(body) ? body.filter(isCastEntry) : [];
  } catch {
    return [];
  }
}
