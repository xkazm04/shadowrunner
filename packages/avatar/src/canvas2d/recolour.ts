// canvas2d recolour (character-control design.md "Recolour", req 1.4): each recoloured layer (and
// face patch) is drawn once into an offscreen canvas, its pixels recoloured by render/recolour.ts,
// and the canvas drawn in its place. Cached by `file + '|' + the recolour key` (one entry per file,
// so dragging a colour picker never grows the cache). Region maps are read from the map image's R
// channel, once per map file.
import type { AssetImage } from "../render/assets.js";
import { needsMap, recolourPixels, type IndexMap, type LayerRecolour } from "../render/recolour.js";

/** The subset of a 2D context an offscreen surface needs. */
export type SurfaceContext = Pick<CanvasRenderingContext2D, "drawImage" | "getImageData" | "putImageData" | "clearRect">;

export interface Surface {
  /** Drawable into the main context. */
  canvas: CanvasImageSource;
  ctx: SurfaceContext;
}

/** Makes a `w` x `h` offscreen surface, or null when the platform has none. */
export type SurfaceFactory = (w: number, h: number) => Surface | null;

/** OffscreenCanvas where it exists, else a detached <canvas>, else null (no recolour, as painted). */
export const defaultSurface: SurfaceFactory = (w, h) => {
  try {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      return ctx === null ? null : { canvas, ctx };
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      return ctx === null ? null : { canvas, ctx };
    }
  } catch {
    return null;
  }
  return null;
};

function sizeOf(image: AssetImage): [number, number] {
  const natural = "naturalWidth" in image && image.naturalWidth > 0 ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height];
  return [Math.max(1, Math.round(natural[0] ?? 1)), Math.max(1, Math.round(natural[1] ?? 1))];
}

/** The straight RGBA of `image` at its own size, or undefined without a surface. */
function pixelsOf(factory: SurfaceFactory, image: AssetImage): { surface: Surface; data: ImageData; w: number; h: number } | undefined {
  const [w, h] = sizeOf(image);
  const surface = factory(w, h);
  if (surface === null) return undefined;
  try {
    surface.ctx.clearRect(0, 0, w, h);
    surface.ctx.drawImage(image, 0, 0, w, h);
    return { surface, data: surface.ctx.getImageData(0, 0, w, h), w, h };
  } catch {
    return undefined; // a tainted or unreadable image draws as painted
  }
}

export interface RecolourCache {
  /**
   * The recoloured image of `file` (a layer image or a patch) for `plan`, or `image` itself when it
   * cannot be recoloured here. `map` is the layer's index map image (when ready) and where this
   * image sits in it (`mapRect`).
   */
  get(file: string, image: AssetImage, plan: LayerRecolour, map?: { file: string; image: AssetImage; rect: IndexMap["rect"] }): CanvasImageSource;
  clear(): void;
}

export function createRecolourCache(factory: SurfaceFactory = defaultSurface): RecolourCache {
  const recoloured = new Map<string, { key: string; canvas: CanvasImageSource }>();
  const maps = new Map<string, { data: Uint8ClampedArray; width: number; height: number } | null>();
  const mapOf = (file: string, image: AssetImage): { data: Uint8ClampedArray; width: number; height: number } | null => {
    const known = maps.get(file);
    if (known !== undefined) return known;
    const read = pixelsOf(factory, image);
    const value = read === undefined ? null : { data: read.data.data, width: read.w, height: read.h };
    maps.set(file, value);
    return value;
  };
  return {
    get(file, image, plan, map) {
      const index = map !== undefined && needsMap(plan) ? mapOf(map.file, map.image) : null;
      const key = `${plan.key}|${index === null ? "-" : "m"}`;
      const known = recoloured.get(file);
      if (known !== undefined && known.key === key) return known.canvas;
      const read = pixelsOf(factory, image);
      if (read === undefined) return image;
      const indexMap = index === null || map === undefined ? undefined : { ...index, rect: map.rect };
      recolourPixels(read.data.data, read.w, read.h, plan, indexMap);
      read.surface.ctx.putImageData(read.data, 0, 0);
      recoloured.set(file, { key, canvas: read.surface.canvas });
      return read.surface.canvas;
    },
    clear() {
      recoloured.clear();
      maps.clear();
    },
  };
}
