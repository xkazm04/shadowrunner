// The images a rig draws beyond its layers (character-control): region index maps and face
// patches, found through the same lookup as the layer images (`RigAssets`, keyed by file name as
// the rig writes it: `Layer.file`, `LayerRegions.map`, `LayerPatch.file`).
//
// Decisions the spec leaves open:
// - A file already in `RigAssets` is used as is (a map with its layer's own, at `setRig`). One that
//   is not is asked of the renderer's optional `loadAsset` once, the first time a frame needs it
//   (patches: when their family is on), and drawn from the first frame after it resolves; until
//   then the layer draws its base (and its lights, without regions). A failed load is not retried
//   for the life of the rig. Without `loadAsset`, a missing file simply never draws.
import type { Rig } from "@sr/rig";
import type { RigAssets } from "./types.js";

export type AssetImage = ImageBitmap | HTMLImageElement;

/** Fetches and decodes one rig file (as `RigAssets` would hold it) on demand. */
export type AssetLoader = (file: string) => Promise<AssetImage>;

/** Every file `rig` may draw: layer images, then region maps, then face patches; each once. */
export function rigAssetFiles(rig: Pick<Rig, "layers">): { layers: string[]; maps: string[]; patches: string[] } {
  const seen = new Set<string>();
  const once = (file: string | undefined, into: string[]): void => {
    if (file === undefined || seen.has(file)) return;
    seen.add(file);
    into.push(file);
  };
  const layers: string[] = [];
  const maps: string[] = [];
  const patches: string[] = [];
  for (const layer of rig.layers) once(layer.file, layers);
  for (const layer of rig.layers) once(layer.regions?.map, maps);
  for (const layer of rig.layers) for (const patch of Object.values(layer.variants ?? {})) once(patch.file, patches);
  return { layers, maps, patches };
}

export interface AssetCache {
  /** The image for `file` when it is ready; starts a lazy load the first time it is not. */
  get(file: string): AssetImage | undefined;
  /** Drops late loads (a new rig or a disposed renderer). */
  dispose(): void;
}

export function createAssetCache(assets: RigAssets, load: AssetLoader | undefined): AssetCache {
  const loaded = new Map<string, AssetImage | "loading" | "failed">();
  let alive = true;
  return {
    get(file: string): AssetImage | undefined {
      const own = Object.hasOwn(assets, file) ? assets[file] : undefined;
      if (own !== undefined) return own;
      const state = loaded.get(file);
      if (state !== undefined) return typeof state === "string" ? undefined : state;
      if (load === undefined) return undefined;
      loaded.set(file, "loading");
      let pending: Promise<AssetImage>;
      try {
        pending = load(file);
      } catch {
        loaded.set(file, "failed");
        return undefined;
      }
      pending.then(
        (image) => {
          if (alive) loaded.set(file, image);
        },
        () => {
          if (alive) loaded.set(file, "failed");
        },
      );
      return undefined;
    },
    dispose(): void {
      alive = false;
      loaded.clear();
    },
  };
}
