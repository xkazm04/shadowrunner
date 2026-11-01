// The character on air: Arch-Lich Malakor, the flagship (product.md). His rig comes from
// assets/characters/malakor/rig/ the way the avatar bench loads it (legacy layers.json + spec,
// PNG URLs emitted by Vite), his persona from his bible, and the replay audience from the
// recorded show, validated once by parseShow.
import type { RigAssets } from "@sr/avatar";
import { parseShow, type Persona, type ShowScript } from "@sr/engine";
import { importLegacyLayers, type Rig } from "@sr/rig";
import bible from "../../../../assets/characters/malakor/bible.md?raw";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import showJson from "../../../../assets/replay/shows/malakor-night.json";

const PNG_URLS = import.meta.glob<string>("../../../../assets/characters/malakor/rig/*.png", {
  query: "?url",
  import: "default",
  eager: true,
});

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
  return result.value.rig;
}

/** Loads and decodes every layer image of `rig`. */
export async function loadRigAssets(rig: Rig): Promise<RigAssets> {
  const byName = new Map(Object.entries(PNG_URLS).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]));
  const assets: RigAssets = {};
  await Promise.all(
    rig.layers.map(async (layer) => {
      const url = byName.get(layer.file);
      if (url === undefined) throw new Error(`missing ${layer.file}`);
      const image = new Image();
      image.src = url;
      await image.decode();
      assets[layer.file] = image;
    }),
  );
  return assets;
}
