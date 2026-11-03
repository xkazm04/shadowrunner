// The character on air: Arch-Lich Malakor, the flagship (product.md). His rig comes from
// assets/characters/malakor/rig/ the way the avatar bench loads it (legacy layers.json + spec,
// PNG URLs emitted by Vite), his persona from his bible, and the replay audience from the
// recorded show, validated once by parseShow.
import type { RigAssets } from "@sr/avatar";
import { parseShow, type Persona, type ShowScript } from "@sr/engine";
import { importLegacyLayers, type Rig } from "@sr/rig";
import { rigFiles } from "../creator/library/assets";
import { malakorFiles, withSidecars } from "../creator/library/seed";
import bible from "../../../../assets/characters/malakor/bible.md?raw";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import showJson from "../../../../assets/replay/shows/malakor-night.json";

/** The name his replies are posted under in chat (the picker's `ctx.self`). */
export const MALAKOR_NAME = "Malakor";

export const MALAKOR_PERSONA: Persona = { characterId: "malakor", name: MALAKOR_NAME, bible, voice: "clerk" };

let show: ShowScript | undefined;

/** The recorded Malakor night: the replay audience. Throws if the committed file is invalid. */
export function malakorShow(): ShowScript {
  if (show !== undefined) return show;
  const parsed = parseShow(showJson);
  if (parsed === undefined) throw new Error("assets/replay/shows/malakor-night.json does not validate");
  show = parsed;
  return parsed;
}

export function malakorRig(): Rig {
  const result = importLegacyLayers(layersJson, specJson);
  if (!result.ok) throw new Error(`Malakor did not import: ${result.errors.map((e) => e.message).join("; ")}`);
  // The retrofit's region and face sidecars, when committed (character-control; seed.ts).
  return withSidecars(result.value.rig);
}

/** Loads and decodes every image of `rig` (`rigFiles`): layer images required, maps and faces when committed. */
export async function loadRigAssets(rig: Rig): Promise<RigAssets> {
  const byName = new Map(Object.entries(malakorFiles()));
  const layerFiles = new Set(rig.layers.map((l) => l.file));
  const assets: RigAssets = {};
  await Promise.all(
    rigFiles(rig).map(async (file) => {
      const url = byName.get(file);
      if (url === undefined) {
        if (layerFiles.has(file)) throw new Error(`missing ${file}`);
        return;
      }
      const image = new Image();
      image.src = url;
      await image.decode();
      assets[file] = image;
    }),
  );
  return assets;
}
