// The recorded cast's signature acts (tiger L1). The 14 recorded jobs must stay byte-identical, so
// their rigs carry no `Layer.act`; the acts come from a derived source instead: each cast
// character's committed brief (`assets/characters/cast/<slug>/brief.json`), compiled at load time by
// the same pure compiler a live forge uses (`actsFromRecordedParts`, @sr/forge/acts). Only the
// briefs' `parts` are imported (Vite's JSON named export), a few hundred bytes each. An act whose
// part the recorded rig does not have by that name (Sir Vacant's `inner_light` and `vow_tags`) is
// simply not fired: `withActs` sets acts only on layers that exist.
import { actsFromRecordedParts } from "@sr/forge/acts";
import type { LayerAct } from "@sr/rig";

const PARTS = import.meta.glob<unknown>("../../../../assets/characters/cast/*/brief.json", { eager: true, import: "parts" });

const slugOf = (path: string): string => path.split("/").at(-2) ?? "";

let acts: ReadonlyMap<string, ReadonlyMap<string, LayerAct>> | undefined;

/** Per layer name, the acts of the cast character `slug`; empty for anyone else. */
export function castActs(slug: string): ReadonlyMap<string, LayerAct> {
  acts ??= new Map(Object.entries(PARTS).map(([path, parts]) => [slugOf(path), actsFromRecordedParts(parts)]));
  return acts.get(slug) ?? new Map();
}
