// A character ready for the player (spec avatar-reach, design "Playable"): from a cast pack, a pack
// URL, an uploaded .srpack or a library record. Task 0 stub: final signatures; bodies in task 1.
import type { RigAssets } from "@sr/avatar/core";
import type { VoiceId } from "@sr/engine";
import type { PackLicence } from "@sr/pack";
import type { Look, Rig } from "@sr/rig";

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

const todo = (name: string): Error => new Error(`reach: ${name} is not implemented yet (avatar-reach task 1)`);

/** A cast slug (`[a-z0-9-]+`) -> `/packs/<slug>.srpack`; anything else is taken as a URL. */
export function packUrlOf(pack: string): string {
  void pack;
  throw todo("packUrlOf");
}

export function loadPlayable(source: PlayableSource, init?: { signal?: AbortSignal }): Promise<PlayableResult> {
  void source;
  void init;
  return Promise.reject(todo("loadPlayable"));
}

/** `/packs/index.json`; `[]` on any failure. */
export function loadCastIndex(init?: { signal?: AbortSignal }): Promise<CastEntry[]> {
  void init;
  return Promise.reject(todo("loadCastIndex"));
}
