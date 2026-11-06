// The iris draw on canvas2D (face-control, WP-A): an offscreen composite of the iris and its eye's
// socket masks. The iris's pixels (as the look recolours them) are read once per source; each frame
// every pixel's alpha is multiplied by the blended mask (render/socket.ts `maskAt`) at its point
// mapped into the eye's posed frame, and the result is drawn in the iris's place. The same rules as
// GL (gl/iris.ts): an iris whose eye's mask is not ready is not drawn; one with no socket is plain.
//
// Decisions the brief leaves open:
// - The composite runs on the CPU (getImageData / putImageData) instead of a destination-in draw,
//   so a crossfade of up to three masks is exact and the clip is the same math the tests check.
//   Its cost is one pass over the iris image's pixels per iris per frame, on the fallback only.
import type { Layer, LayerPose } from "@sr/rig";
import type { AssetImage } from "../render/assets.js";
import { alphaOf, irisMaskMap, maskAt, socketWeights, type MaskAlpha } from "../render/socket.js";
import { defaultSurface, type Surface, type SurfaceFactory } from "./recolour.js";

/** Size of an asset image, at least 1 x 1. */
function sizeOf(image: AssetImage): [number, number] {
  const natural = "naturalWidth" in image && image.naturalWidth > 0 ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height];
  return [Math.max(1, Math.round(natural[0] ?? 1)), Math.max(1, Math.round(natural[1] ?? 1))];
}

/** Straight RGBA of `source` drawn at `w` x `h`, or undefined without a surface (or when unreadable). */
function read(factory: SurfaceFactory, source: CanvasImageSource, w: number, h: number): Uint8ClampedArray | undefined {
  const surface = factory(w, h);
  if (surface === null) return undefined;
  try {
    surface.ctx.clearRect(0, 0, w, h);
    surface.ctx.drawImage(source, 0, 0, w, h);
    return surface.ctx.getImageData(0, 0, w, h).data;
  } catch {
    return undefined;
  }
}

export interface IrisSource {
  /** Cache key of the pixels (file and recolour). */
  key: string;
  /** The iris as drawn (the asset or its recolour), and its asset's size. */
  image: CanvasImageSource;
  size: AssetImage;
}

export interface IrisClipper {
  /**
   * The clipped iris to draw in the iris's bbox, "plain" when there is no socket to clip by, or
   * undefined when it must not be drawn this frame.
   */
  clip(layer: Layer, pose: LayerPose, source: IrisSource, layers: ReadonlyMap<string, Layer>, poses: readonly LayerPose[], images: (file: string) => AssetImage | undefined): CanvasImageSource | "plain" | undefined;
  clear(): void;
}

export function createIrisClipper(factory: SurfaceFactory = defaultSurface): IrisClipper {
  const sources = new Map<string, { key: string; w: number; h: number; rgba: Uint8ClampedArray } | null>();
  const masks = new Map<string, MaskAlpha | null>();
  const outs = new Map<string, Surface>();
  const maskOf = (file: string, image: AssetImage | undefined): MaskAlpha | undefined => {
    const known = masks.get(file);
    if (known !== undefined) return known ?? undefined;
    if (image === undefined) return undefined;
    const [w, h] = sizeOf(image);
    const rgba = read(factory, image, w, h);
    const value = rgba === undefined ? null : alphaOf(w, h, rgba);
    masks.set(file, value);
    return value ?? undefined;
  };
  return {
    clip(layer, pose, source, layers, poses, images) {
      const eye = layer.follow === undefined ? undefined : layers.get(layer.follow);
      if (layer.kind !== "iris" || eye?.kind !== "eye" || eye.socket === undefined) return "plain";
      const eyePose = poses.find((p) => p.name === eye.name);
      const base = maskOf(eye.socket, images(eye.socket));
      const map = eyePose === undefined ? undefined : irisMaskMap(layer, pose, eye, eyePose);
      if (eyePose === undefined || base === undefined || map === undefined) return undefined;
      const blend = socketWeights(eye, eyePose).map(({ file, weight }) => ({ mask: maskOf(file, images(file)) ?? base, weight }));
      const known = sources.get(layer.name);
      let src = known === undefined || known === null || known.key !== source.key ? undefined : known;
      if (src === undefined) {
        const [w, h] = sizeOf(source.size);
        const rgba = read(factory, source.image, w, h);
        if (rgba === undefined) return undefined;
        src = { key: source.key, w, h, rgba };
        sources.set(layer.name, src);
      }
      let out = outs.get(layer.name);
      if (out === undefined) {
        const made = factory(src.w, src.h);
        if (made === null) return undefined;
        out = made;
        outs.set(layer.name, out);
      }
      const data = out.ctx.getImageData(0, 0, src.w, src.h);
      const [bx, by, bw, bh] = layer.bbox;
      for (let j = 0; j < src.h; j += 1) {
        const ry = by + ((j + 0.5) * bh) / src.h;
        for (let i = 0; i < src.w; i += 1) {
          const rx = bx + ((i + 0.5) * bw) / src.w;
          const u = map[0] * rx + map[2] * ry + map[4];
          const v = map[1] * rx + map[3] * ry + map[5];
          let m = 0;
          for (const { mask, weight } of blend) m += weight * maskAt(mask, u, v);
          const k = (j * src.w + i) * 4;
          data.data[k] = src.rgba[k] ?? 0;
          data.data[k + 1] = src.rgba[k + 1] ?? 0;
          data.data[k + 2] = src.rgba[k + 2] ?? 0;
          data.data[k + 3] = Math.round((src.rgba[k + 3] ?? 0) * Math.min(1, Math.max(0, m)));
        }
      }
      out.ctx.putImageData(data, 0, 0);
      return out.canvas;
    },
    clear() {
      sources.clear();
      masks.clear();
      outs.clear();
    },
  };
}
