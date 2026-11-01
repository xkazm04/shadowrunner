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
// - `setLook` only recomputes uniforms; `draw` calls it when handed a different look object.
import { defaultLook, type LayerPose, type Look, type Rig } from "@sr/rig";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { fitView, lookLight, type LookLight } from "../render/frame.js";
import type { CanvasHost, FrameClock, Renderer, RendererInfo, RigAssets } from "../render/types.js";
import { createGlContext, watchContextLoss } from "./context.js";
import { beginScene, createGlowTargets, deleteGlowTargets, glowGain, runGlow, type GlowTargets } from "./glow.js";
import { deleteLayers, drawLayers, uploadLayers, type LayerTexture } from "./layers.js";
import { createPrograms, deletePrograms } from "./programs.js";

export interface CreateRendererOptions {
  /** A fresh canvas for the 2D fallback once this one holds a WebGL2 context; null draws nothing. */
  replaceCanvas?: (lost: CanvasHost) => CanvasHost | null;
}

/** The WebGL2 renderer on an existing context. Throws if its programs or targets cannot be built. */
export function createGlRenderer(gl: WebGL2RenderingContext, canvas: CanvasHost, rig: Rig, assets: RigAssets): Renderer {
  const programs = createPrograms(gl);
  let textures = new Map<string, LayerTexture>();
  let targets: GlowTargets = createGlowTargets(gl, canvas.width, canvas.height);
  let currentRig = rig;
  let light: LookLight = lookLight(rig, defaultLook(rig));
  let lastLook: Look | undefined;
  let uploads = 0;
  let drawCalls = 0;
  let disposed = false;

  const setRig = (next: Rig, nextAssets: RigAssets): void => {
    deleteLayers(gl, textures);
    textures = uploadLayers(gl, next, nextAssets);
    uploads += textures.size;
    currentRig = next;
    light = lookLight(next, lastLook ?? defaultLook(next));
  };
  const setLook = (look: Look): void => {
    lastLook = look;
    light = lookLight(currentRig, look);
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
      beginScene(gl, targets);
      drawCalls += drawLayers(gl, programs, textures, poses, view, light);
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
      return { mode: "webgl2", drawCalls, textureUploads: uploads };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      deleteLayers(gl, textures);
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
  if (own !== null) return createCanvas2dRenderer(canvas, own, rig, assets);
  const fresh = (options.replaceCanvas ?? replaceInDom)(canvas) ?? canvas;
  const ctx = fresh === canvas ? null : fresh.getContext("2d");
  return createCanvas2dRenderer(fresh, ctx, rig, assets);
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
      impl = createGlRenderer(gl, canvas, rig, assets);
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
