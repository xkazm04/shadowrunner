// Canvas2D fallback (avatar-renderer req 2.2): the same `Renderer` interface; draws the same
// `LayerPose[]` (position, scale, rotation, opacity) through the shared frame math, and skips the
// rim light and the glow pass. The old eye multiply is a light term too and is skipped with them;
// the brow offset is geometry and is kept, so both renderers place every layer identically.
// Pose `tint` (a layer pulse, cast-forge req 1, and the glare/flare gains) is drawn as a
// `brightness()` filter, the same per-channel multiply the GL base pass applies; where the
// browser has no canvas filter it is a no-op. `Layer.emissive: false` (cast-forge task 12
// follow-up) reaches this renderer through that tint: `poseLayers` gives such a layer no gesture
// light gain.
// Character-control: the recolour (eye, glow and mouth lights, regions) is drawn here as in GL,
// through an offscreen copy per layer (canvas2d/recolour.ts); a recoloured eye's eyeGain joins its
// tint in the filter. Face patches follow design "Faces" as in GL. A look equal to the rig draws
// every layer's own image, exactly as before.
// The drawn mouth (FrameClock.mouth, a rig with `mouth`) is painted straight onto the context right
// after the later of the head and the jaw, in the head's frame, with the head's tint (mouth/draw.ts).
// Face-control: an eye's closed-lid art is drawn over it at `LayerPose.closed`; an iris whose eye has
// a socket is drawn clipped by the socket masks (canvas2d/iris.ts); the look's light follows the
// frame clock's `mood` as in GL.
import type { Layer, LayerPose, Look, Rig } from "@sr/rig";
import { createMouthArt } from "../mouth/draw.js";
import type { MouthSurfaceFactory } from "../mouth/colours.js";
import { createAssetCache, type AssetCache, type AssetImage, type AssetLoader } from "../render/assets.js";
import { dimGain, fitView, layerAffine, lookLight, type LookLight } from "../render/frame.js";
import { mapRect, needsMap, rigRecolours, type LayerRecolour } from "../render/recolour.js";
import type { CanvasHost, FrameClock, Renderer, RendererInfo, RigAssets } from "../render/types.js";
import { createIrisClipper } from "./iris.js";
import { createRecolourCache, type SurfaceFactory } from "./recolour.js";

interface Entry {
  layer: Layer;
  image: AssetImage;
}

export interface Canvas2dOptions {
  /** Loads a rig file missing from the assets (a region map, a face patch) on first need. */
  loadAsset?: AssetLoader;
  /** Offscreen surfaces for the recolour (tests pass pixel stubs). */
  surface?: SurfaceFactory;
  /** 2D surfaces for the drawn mouth (its colour sample and skin cover; tests pass stubs). */
  mouthSurface?: MouthSurfaceFactory;
}

/** The canvas filter for a pose tint: "none" at 1 (or a non-finite tint), else `brightness(tint)`. */
export function tintFilter(tint: number): string {
  if (!Number.isFinite(tint) || tint === 1) return "none";
  return `brightness(${Math.max(0, tint).toFixed(4)})`;
}

interface Draw {
  image: CanvasImageSource;
  rect: readonly number[];
  alpha: number;
}

/** A 2D renderer on `ctx` (whose canvas is `canvas`); `ctx` null draws nothing (no surface at all). */
export function createCanvas2dRenderer(canvas: CanvasHost, ctx: CanvasRenderingContext2D | null, rig: Rig, assets: RigAssets, options: Canvas2dOptions = {}): Renderer {
  let entries = new Map<string, Entry>();
  let layers = new Map<string, Layer>();
  let currentRig = rig;
  let currentAssets = assets;
  const mouthArt = createMouthArt(options.mouthSurface);
  let light: LookLight | undefined;
  let recolours = new Map<string, LayerRecolour>();
  let images: AssetCache = createAssetCache(assets, options.loadAsset);
  const cache = createRecolourCache(options.surface);
  const irises = createIrisClipper(options.surface);
  let lastLook: Look | undefined;
  let drawCalls = 0;
  let disposed = false;

  const setRig = (next: Rig, nextAssets: RigAssets): void => {
    currentRig = next;
    currentAssets = nextAssets;
    layers = new Map(next.layers.map((layer) => [layer.name, layer]));
    lastLook = undefined;
    entries = new Map();
    images.dispose();
    images = createAssetCache(nextAssets, options.loadAsset);
    cache.clear();
    irises.clear();
    for (const layer of next.layers) {
      const image = nextAssets[layer.file];
      if (layer.visible !== false && image !== undefined && !entries.has(layer.name)) entries.set(layer.name, { layer, image });
    }
  };

  const setLook = (look: Look): void => {
    lastLook = look;
    light = lookLight(currentRig, look);
    recolours = rigRecolours(currentRig, look);
  };

  /** `image` (at `file`, covering `rect` of its layer) as the look recolours it. */
  const paint = (layer: Layer, file: string, image: AssetImage, rect: readonly number[]): CanvasImageSource => {
    const plan = recolours.get(layer.name);
    if (plan === undefined) return image;
    const mapFile = layer.regions?.map;
    const mapImage = mapFile !== undefined && needsMap(plan) ? images.get(mapFile) : undefined;
    const map = mapFile === undefined || mapImage === undefined ? undefined : { file: mapFile, image: mapImage, rect: mapRect(layer.bbox, rect) };
    return cache.get(file, image, plan, map);
  };

  /** The base and the ready face patches of one pose (design "Faces"). */
  const drawsOf = (entry: Entry, pose: LayerPose): Draw[] => {
    const { layer, image } = entry;
    const opacity = Math.min(1, Math.max(0, pose.opacity));
    const faces: Draw[] = [];
    let replaced = 0;
    for (const face of pose.faces ?? []) {
      const patch = layer.variants?.[face.family];
      const patchImage = patch === undefined || !(face.weight > 0) ? undefined : images.get(patch.file);
      if (patch === undefined || patchImage === undefined) continue;
      if (patch.mode === "replace") replaced += face.weight;
      faces.push({ image: paint(layer, patch.file, patchImage, patch.bbox), rect: patch.bbox, alpha: opacity * Math.min(1, face.weight) });
    }
    const base = opacity * Math.max(0, 1 - replaced);
    const open = faces.length > 0 && base <= 0 ? faces : [{ image: paint(layer, layer.file, image, layer.bbox), rect: layer.bbox, alpha: base }, ...faces];
    // face-control: the closed lids over the eye at the blink's closure.
    const shut = layer.closed === undefined || !(pose.closed !== undefined && pose.closed > 0) ? undefined : images.get(layer.closed);
    if (layer.closed === undefined || shut === undefined) return open;
    return [...open, { image: paint(layer, layer.closed, shut, layer.bbox), rect: layer.bbox, alpha: opacity * Math.min(1, pose.closed ?? 0) }];
  };

  /** An iris's draws: clipped by its eye's socket, plain without one, none while its mask loads. */
  const irisDraws = (entry: Entry, pose: LayerPose, poses: LayerPose[]): Draw[] => {
    const { layer, image } = entry;
    const source = { key: `${layer.file}|${recolours.get(layer.name)?.key ?? "-"}`, image: paint(layer, layer.file, image, layer.bbox), size: image };
    const clipped = irises.clip(layer, pose, source, layers, poses, (file) => images.get(file));
    if (clipped === "plain") return drawsOf(entry, pose);
    return clipped === undefined ? [] : [{ image: clipped, rect: layer.bbox, alpha: Math.min(1, Math.max(0, pose.opacity)) }];
  };

  setRig(rig, assets);

  return {
    setRig,
    setLook,
    draw(poses: LayerPose[], look: Look, clock?: FrameClock): void {
      drawCalls = 0;
      if (disposed || ctx === null) return;
      if (look !== lastLook || light === undefined) setLook(look);
      const frameLight = clock?.mood === undefined ? light : lookLight(currentRig, look, clock.mood);
      const browY = frameLight?.browY ?? 0;
      const view = fitView(currentRig, canvas.width, canvas.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const mouth = clock?.mouth === undefined ? undefined : mouthArt.place(currentRig, layers, poses, view, browY);
      const mouthColours = mouth === undefined ? undefined : mouthArt.colours(currentRig, currentAssets, look);
      for (let i = 0; i < poses.length; i += 1) {
        const pose = poses[i];
        const entry = pose === undefined ? undefined : entries.get(pose.name);
        if (pose === undefined || entry === undefined) continue;
        const { layer } = entry;
        const m = layerAffine(layer, pose, view, browY);
        const eyeGain = recolours.get(layer.name)?.light?.name === "eye" ? (frameLight?.eyeGain ?? 1) : 1;
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.filter = tintFilter(pose.tint * eyeGain * dimGain(layer, clock?.dim));
        for (const draw of layer.kind === "iris" ? irisDraws(entry, pose, poses) : drawsOf(entry, pose)) {
          ctx.globalAlpha = draw.alpha;
          ctx.drawImage(draw.image, draw.rect[0] ?? 0, draw.rect[1] ?? 0, draw.rect[2] ?? 0, draw.rect[3] ?? 0);
          drawCalls += 1;
        }
        if (mouth !== undefined && mouthColours !== undefined && clock?.mouth !== undefined && i === mouth.host.index) {
          ctx.filter = tintFilter(mouth.frame.pose.tint * dimGain(mouth.frame.layer, clock.dim));
          mouthArt.paint(ctx, mouth.anchor, clock.mouth, mouthColours);
          drawCalls += 1;
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.filter = "none";
    },
    resize(width: number, height: number, dpr: number): void {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    },
    info(): RendererInfo {
      return { mode: "2d", drawCalls, textureUploads: 0 };
    },
    dispose(): void {
      disposed = true;
      entries = new Map();
      images.dispose();
      cache.clear();
      irises.clear();
    },
  };
}
