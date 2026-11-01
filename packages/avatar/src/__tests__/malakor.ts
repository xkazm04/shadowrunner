// Malakor's committed rig as a test fixture: imported through rig-core's legacy importer, with
// stand-in images of each layer's bbox size (no image decoding under node).
import { importLegacyLayers, type Rig } from "@sr/rig";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import type { RigAssets } from "../render/types.js";

export function malakorRig(): Rig {
  const result = importLegacyLayers(layersJson, specJson);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value.rig;
}

/** One stand-in ImageBitmap per layer file, sized like the layer's bbox. */
export function fakeAssets(rig: Rig): RigAssets {
  const assets: RigAssets = {};
  for (const layer of rig.layers) assets[layer.file] = { width: layer.bbox[2], height: layer.bbox[3], close: () => undefined };
  return assets;
}
