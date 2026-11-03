// Who is on air (character-control requirement 6, design "On air"): "Put on air" in the Forge and
// at the end of the rite records the character's library id under `sr.onAir`; the stage, CH 2's
// projection and CH 4's live tube load that record from the library with its saved look. With no
// id, an id the library no longer holds or cannot read, or images that will not decode, the answer
// is undefined and each page shows Malakor with his default look, as on a first visit.
import type { RigAssets } from "@sr/avatar";
import { useEffect, useState } from "react";
import { rigAssetsOf } from "../creator/library/assets";
import { openLibrary, type CharacterRecord, type LibraryStore } from "../creator/library/libraryStore";
import type { OnAirCharacter } from "../landing/cast";

export const ON_AIR_KEY = "sr.onAir";

/** Records `id` as the character on air. A per-viewer setting: a storage that refuses is ignored. */
export function writeOnAir(id: string): void {
  try {
    window.localStorage.setItem(ON_AIR_KEY, id);
  } catch {
    // Without storage the stage keeps Malakor.
  }
}

/** The recorded on-air id, if any. */
export function readOnAirId(): string | undefined {
  try {
    const id = window.localStorage.getItem(ON_AIR_KEY)?.trim();
    return id === undefined || id === "" ? undefined : id;
  } catch {
    return undefined;
  }
}

export interface OnAirOptions {
  open?: () => Promise<LibraryStore>;
  decode?: (record: CharacterRecord) => Promise<RigAssets>;
}

/** The on-air character from the library with its saved look, or undefined (Malakor stands in). */
export async function loadOnAir({ open = () => openLibrary(), decode = (r) => rigAssetsOf(r.rig, r.assets) }: OnAirOptions = {}): Promise<OnAirCharacter | undefined> {
  const id = readOnAirId();
  if (id === undefined) return undefined;
  try {
    const entry = await (await open()).get(id);
    if (entry?.kind !== "ok") return undefined;
    const { record } = entry;
    return { name: record.rig.name, rig: record.rig, look: record.look, assets: await decode(record) };
  } catch {
    return undefined;
  }
}

/** Where the on-air lookup stands: still looking, nobody (Malakor), or the character. */
export type OnAirState = "looking" | "none" | OnAirCharacter;

/** `loadOnAir` once per mount; "none" straight away when no id is recorded. */
export function useOnAir(options?: OnAirOptions): OnAirState {
  const [state, setState] = useState<OnAirState>(() => (readOnAirId() === undefined ? "none" : "looking"));
  useEffect(() => {
    if (readOnAirId() === undefined) return undefined;
    let live = true;
    void loadOnAir(options).then((c) => live && setState(c ?? "none"));
    return () => {
      live = false;
    };
    // Looked up once per mount: `options` is read at mount only.
  }, []);
  return state;
}
