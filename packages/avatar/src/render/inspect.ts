// What the player learns from a rig's images once (face-control, WP-A): each socketed eye's socket
// half extents (the iris travel, render/socket.ts) and the jaw and eye layers whose expression
// patches are all one image (dead draws, dropped before the pose). Read through the same asset
// lookup as the renderers (render/assets.ts), with an offscreen surface (canvas2d/recolour.ts).
//
// Decisions the brief leaves open:
// - Sockets: a socket mask missing from the assets is loaded through `loadAsset` (once) and
//   measured the frame after it arrives; until then its eye's iris rests (pose.ts).
// - Dead patches: a jaw or eye layer with two or more expression patches is dead when every patch
//   names the same file, or (for patches already in the assets, so nothing is fetched for the
//   check) every patch decodes to the same pixels (equal size and an equal FNV-1a digest of the
//   RGBA) - the decoded twin of "the same bytes". Checked once per rig.
// - Without a surface (no canvas, as under node), nothing is measured: irises rest and no patch is
//   dropped by pixels (by name it still is).
import type { Layer, Rig, SocketBox } from "@sr/rig";
import { defaultSurface, type SurfaceFactory } from "../canvas2d/recolour.js";
import { createAssetCache, type AssetCache, type AssetImage, type AssetLoader } from "./assets.js";
import { alphaOf, socketBoxOf } from "./socket.js";
import type { RigAssets } from "./types.js";

export interface RigInspector {
  /** Per socketed eye layer, its socket's half extents (those measured so far). */
  sockets(rig: Rig): ReadonlyMap<string, SocketBox>;
  /** Names of the jaw and eye layers whose patches are all one image. */
  deadLayers(rig: Rig): ReadonlySet<string>;
  dispose(): void;
}

function sizeOf(image: AssetImage): [number, number] {
  const natural = "naturalWidth" in image && image.naturalWidth > 0 ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height];
  return [Math.max(1, Math.round(natural[0] ?? 1)), Math.max(1, Math.round(natural[1] ?? 1))];
}

/** Straight RGBA of an image at its own size, or undefined without a surface. */
function rgbaOf(factory: SurfaceFactory, image: AssetImage): { w: number; h: number; data: Uint8ClampedArray } | undefined {
  const [w, h] = sizeOf(image);
  const surface = factory(w, h);
  if (surface === null) return undefined;
  try {
    surface.ctx.clearRect(0, 0, w, h);
    surface.ctx.drawImage(image, 0, 0, w, h);
    return { w, h, data: surface.ctx.getImageData(0, 0, w, h).data };
  } catch {
    return undefined;
  }
}

/** FNV-1a 32-bit over the size and the RGBA bytes. */
export function pixelDigest(w: number, h: number, data: ArrayLike<number>): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${w}x${h}:${hash.toString(16)}`;
}

const DEAD_KINDS = new Set<Layer["kind"]>(["jaw", "eye"]);

/** The patch files of a jaw or eye layer with two or more patches; undefined otherwise. */
function patchFiles(layer: Layer): string[] | undefined {
  if (!DEAD_KINDS.has(layer.kind)) return undefined;
  const files = Object.values(layer.variants ?? {}).map((patch) => patch.file);
  return files.length >= 2 ? files : undefined;
}

export function createRigInspector(assets: RigAssets, loadAsset: AssetLoader | undefined, factory: SurfaceFactory = defaultSurface): RigInspector {
  const cache: AssetCache = createAssetCache(assets, loadAsset);
  const boxes = new Map<string, SocketBox | null>();
  let socketsOf: { rig: Rig; map: Map<string, SocketBox>; pending: number } | undefined;
  let deadOf: { rig: Rig; dead: ReadonlySet<string> } | undefined;
  const digest = (file: string): string | undefined => {
    const image = Object.hasOwn(assets, file) ? assets[file] : undefined;
    const read = image === undefined ? undefined : rgbaOf(factory, image);
    return read === undefined ? undefined : pixelDigest(read.w, read.h, read.data);
  };
  return {
    sockets(rig) {
      if (socketsOf?.rig === rig && socketsOf.pending === 0) return socketsOf.map;
      const map = socketsOf?.rig === rig ? socketsOf.map : new Map<string, SocketBox>();
      let pending = 0;
      for (const layer of rig.layers) {
        if (layer.kind !== "eye" || layer.socket === undefined || map.has(layer.name)) continue;
        let box = boxes.get(layer.socket);
        if (box === undefined) {
          const image = cache.get(layer.socket);
          const read = image === undefined ? undefined : rgbaOf(factory, image);
          if (image !== undefined) boxes.set(layer.socket, (read === undefined ? undefined : socketBoxOf(alphaOf(read.w, read.h, read.data), layer.bbox[2], layer.bbox[3])) ?? null);
          box = boxes.get(layer.socket);
        }
        if (box === undefined) pending += 1;
        else if (box !== null) map.set(layer.name, box);
      }
      socketsOf = { rig, map, pending };
      return map;
    },
    deadLayers(rig) {
      if (deadOf?.rig === rig) return deadOf.dead;
      const dead = new Set<string>();
      for (const layer of rig.layers) {
        const files = patchFiles(layer);
        if (files === undefined) continue;
        if (new Set(files).size === 1) {
          dead.add(layer.name);
          continue;
        }
        if (!files.every((file) => Object.hasOwn(assets, file))) continue;
        const first = digest(files[0] ?? "");
        if (first !== undefined && files.slice(1).every((file) => digest(file) === first)) dead.add(layer.name);
      }
      deadOf = { rig, dead };
      return dead;
    },
    dispose() {
      cache.dispose();
      boxes.clear();
      socketsOf = undefined;
      deadOf = undefined;
    },
  };
}

/** `rig` without the expression patches of `dead` layers (the same rig when there are none). */
export function withoutDeadPatches(rig: Rig, dead: ReadonlySet<string>): Rig {
  if (dead.size === 0) return rig;
  return {
    ...rig,
    layers: rig.layers.map((layer) => {
      if (!dead.has(layer.name) || layer.variants === undefined) return layer;
      const rest = { ...layer };
      delete rest.variants;
      return rest;
    }),
  };
}
