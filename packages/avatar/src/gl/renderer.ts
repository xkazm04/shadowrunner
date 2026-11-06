// createRenderer (avatar-renderer task 3.5 and 4, req 1, 2, 7.1, 7.2): the WebGL2 renderer, and
// the facade that falls back to canvas2D when WebGL2 is missing, throws, fails to initialise, or
// loses its context (for the rest of the session).
//
// Decisions the spec leaves open:
// - A canvas that once gave a WebGL2 context never gives a "2d" one, so after a loss (or a failed
//   GL initialisation) the 2D renderer draws on a fresh canvas. By default that is a new <canvas>
//   that takes the old one's place in the DOM (class and inline style copied); callers that own
//   the DOM differently pass `replaceCanvas`. The React wrapper keeps its canvas inside a <div> it
//   owns, so the swap never fights React.
// - `setLook` only recomputes uniforms (and the per-layer recolours, render/recolour.ts); `draw`
//   calls it when handed a different look object.
// - Region maps and face patches are looked up in the assets like layer images; files missing
//   there are asked of `loadAsset` when first needed (render/assets.ts).
// - The drawn mouth (FrameClock.mouth) is one more quad after the later of the head and the jaw,
//   lit like the head (its gain and dim), never emissive (gl/mouth.ts).
// - The art mouth (spark art-mouth, a rig whose mouthMode is "warp"): no extra quad; the head and
//   the jaw are drawn through the warp (gl/warp.ts) for this frame's mouth pose and jaw gap. A frame
//   whose field moves nothing (neutral rest) draws exactly as before.
// - The look's light follows the frame clock's `mood` (face-control): while an emotion crossfades,
//   the frame's light is `lookLight` for that mix; settled, the light `setLook` computed.
import { defaultLook, type Layer, type LayerPose, type Look, type Rig } from "@sr/rig";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { createAssetCache, type AssetLoader } from "../render/assets.js";
import type { MouthSurfaceFactory } from "../mouth/colours.js";
import { createMouthArt } from "../mouth/draw.js";
import { dimGain, fitView, lookLight, type LookLight } from "../render/frame.js";
import { rigRecolours, type LayerRecolour } from "../render/recolour.js";
import type { CanvasHost, FrameClock, Renderer, RendererInfo, RigAssets } from "../render/types.js";
import { createGlContext, watchContextLoss } from "./context.js";
import { beginScene, createGlowTargets, deleteGlowTargets, glowGain, runGlow, type GlowTargets } from "./glow.js";
import { deleteLayers, drawLayers, gainOf, uploadLayers, type LayerTexture } from "./layers.js";
import { createGlMouth } from "./mouth.js";
import { createPrograms, deletePrograms } from "./programs.js";
import { planWarp } from "./warp.js";
import { createTextureStore, type TextureStore } from "./textures.js";

export interface CreateRendererOptions {
  /** A fresh canvas for the 2D fallback once this one holds a WebGL2 context; null draws nothing. */
  replaceCanvas?: (lost: CanvasHost) => CanvasHost | null;
  /** Loads a rig file missing from the assets (a region map, a face patch) on first need. */
  loadAsset?: AssetLoader;
}

/** The WebGL2 renderer on an existing context. Throws if its programs or targets cannot be built. */
export function createGlRenderer(gl: WebGL2RenderingContext, canvas: CanvasHost, rig: Rig, assets: RigAssets, loadAsset?: AssetLoader, mouthSurface?: MouthSurfaceFactory): Renderer {
  const programs = createPrograms(gl);
  const mouthArt = createMouthArt(mouthSurface);
  const mouthGl = createGlMouth(gl, programs, mouthSurface);
  let layers = new Map<string, Layer>();
  let currentAssets = assets;
  let textures = new Map<string, LayerTexture>();
  let store: TextureStore | undefined;
  let recolours: Map<string, LayerRecolour> = new Map();
  let storeUploads = 0;
  let targets: GlowTargets = createGlowTargets(gl, canvas.width, canvas.height);
  let currentRig = rig;
  let settled: LookLight = lookLight(rig, defaultLook(rig));
  let lastLook: Look | undefined;
  let uploads = 0;
  let drawCalls = 0;
  let disposed = false;

  const setRig = (next: Rig, nextAssets: RigAssets): void => {
    deleteLayers(gl, textures);
    storeUploads += store?.uploads() ?? 0;
    store?.dispose();
    store = createTextureStore(gl, createAssetCache(nextAssets, loadAsset));
    textures = uploadLayers(gl, next, nextAssets, store);
    uploads += textures.size;
    currentRig = next;
    currentAssets = nextAssets;
    layers = new Map(next.layers.map((layer) => [layer.name, layer]));
    const look = lastLook ?? defaultLook(next);
    settled = lookLight(next, look);
    recolours = rigRecolours(next, look);
  };
  const setLook = (look: Look): void => {
    lastLook = look;
    settled = lookLight(currentRig, look);
    recolours = rigRecolours(currentRig, look);
  };
  setRig(rig, assets);

  return {
    setRig,
    setLook,
    draw(poses: LayerPose[], look: Look, clock?: FrameClock): void {
      drawCalls = 0;
      if (disposed || gl.isContextLost()) return;
      if (look !== lastLook) setLook(look);
      const view = fitView(currentRig, targets.scene.width, targets.scene.height);
      const light = clock?.mood === undefined ? settled : lookLight(currentRig, look, clock.mood);
      beginScene(gl, targets);
      const mouthPose = clock?.mouth;
      const mouth = mouthPose === undefined ? undefined : mouthArt.place(currentRig, layers, poses, view, light.browY);
      const colours = mouth === undefined ? undefined : mouthArt.colours(currentRig, currentAssets, look);
      const after =
        mouth === undefined || colours === undefined || mouthPose === undefined
          ? undefined
          : {
              index: mouth.host.index,
              draw: (): number => {
                const { layer, pose } = mouth.frame;
                const gain = gainOf(layer, pose, light, recolours.get(layer.name));
                const dimmed = dimGain(layer, clock?.dim);
                return mouthGl.draw(mouthArt, mouth.anchor, mouthPose, colours, [gain[0] * dimmed, gain[1] * dimmed, gain[2] * dimmed]);
              },
            };
      const warp = mouth === undefined && currentRig.mouth !== undefined ? planWarp(currentRig, layers, poses, view, light.browY, mouthPose, () => mouthArt.colours(currentRig, currentAssets, look)?.lip) : undefined;
      if (store !== undefined) drawCalls += drawLayers(gl, programs, textures, poses, view, { light, recolours, store, ...(clock?.dim === undefined ? {} : { dim: clock.dim }) }, after, warp);
      drawCalls += runGlow(gl, programs, targets, light.glow, glowGain(clock));
    },
    resize(width: number, height: number, dpr: number): void {
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (disposed || (w === targets.scene.width && h === targets.scene.height && canvas.width === w && canvas.height === h)) return;
      canvas.width = w;
      canvas.height = h;
      deleteGlowTargets(gl, targets);
      targets = createGlowTargets(gl, w, h);
    },
    info(): RendererInfo {
      return { mode: "webgl2", drawCalls, textureUploads: uploads + storeUploads + (store?.uploads() ?? 0) + mouthGl.uploads() };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      deleteLayers(gl, textures);
      store?.dispose();
      mouthGl.dispose();
      deleteGlowTargets(gl, targets);
      deletePrograms(gl, programs);
    },
  };
}

/** Default `replaceCanvas`: a new <canvas> in the lost one's place, or null outside a DOM. */
export function replaceInDom(lost: CanvasHost): CanvasHost | null {
  if (typeof HTMLCanvasElement === "undefined" || !(lost instanceof HTMLCanvasElement)) return null;
  const fresh = lost.ownerDocument.createElement("canvas");
  fresh.className = lost.className;
  fresh.style.cssText = lost.style.cssText;
  fresh.width = lost.width;
  fresh.height = lost.height;
  lost.replaceWith(fresh);
  return fresh;
}

/** A 2D renderer for `canvas`, or for its replacement when it cannot give a 2D context. */
function fallback(canvas: CanvasHost, rig: Rig, assets: RigAssets, options: CreateRendererOptions, glUsed: boolean): Renderer {
  const own = glUsed ? null : canvas.getContext("2d");
  const extra = options.loadAsset === undefined ? {} : { loadAsset: options.loadAsset };
  if (own !== null) return createCanvas2dRenderer(canvas, own, rig, assets, extra);
  const fresh = (options.replaceCanvas ?? replaceInDom)(canvas) ?? canvas;
  const ctx = fresh === canvas ? null : fresh.getContext("2d");
  return createCanvas2dRenderer(fresh, ctx, rig, assets, extra);
}

/**
 * The avatar renderer for `canvas` (req 1, 2): WebGL2 when available, else canvas2D. On
 * `webglcontextlost` it swaps to canvas2D for the session and reports `mode: "2d"`.
 */
export function createRenderer(canvas: CanvasHost, rig: Rig, assets: RigAssets, options: CreateRendererOptions = {}): Renderer {
  const gl = createGlContext(canvas);
  let impl: Renderer;
  let stopWatching = (): void => undefined;
  if (gl === null) {
    impl = fallback(canvas, rig, assets, options, false);
  } else {
    try {
      impl = createGlRenderer(gl, canvas, rig, assets, options.loadAsset);
    } catch {
      impl = fallback(canvas, rig, assets, options, true);
    }
  }

  let state = { rig, assets, look: undefined as Look | undefined, size: undefined as [number, number, number] | undefined };
  if (impl.info().mode === "webgl2") {
    stopWatching = watchContextLoss(canvas, () => {
      const lost = impl;
      impl = fallback(canvas, state.rig, state.assets, options, true);
      lost.dispose();
      if (state.look !== undefined) impl.setLook(state.look);
      const [w, h, dpr] = state.size ?? [canvas.width, canvas.height, 1];
      impl.resize(w, h, dpr);
    });
  }

  return {
    setRig(next: Rig, nextAssets: RigAssets): void {
      state = { ...state, rig: next, assets: nextAssets };
      impl.setRig(next, nextAssets);
    },
    setLook(look: Look): void {
      state = { ...state, look };
      impl.setLook(look);
    },
    draw(poses: LayerPose[], look: Look, clock?: FrameClock): void {
      if (look !== state.look) state = { ...state, look };
      impl.draw(poses, look, clock);
    },
    resize(width: number, height: number, dpr: number): void {
      state = { ...state, size: [width, height, dpr] };
      impl.resize(width, height, dpr);
    },
    info: () => impl.info(),
    dispose(): void {
      stopWatching();
      impl.dispose();
    },
  };
}
