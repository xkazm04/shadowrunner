// createRenderer (avatar-renderer task 3.5, req 1, 7.1, 7.2): the WebGL2 renderer.
//
// Decisions the spec leaves open:
// - `setLook` only recomputes uniforms; `draw` calls it when handed a different look object.
import { defaultLook, type LayerPose, type Look, type Rig } from "@sr/rig";
import { fitView, lookLight, type LookLight } from "../render/frame.js";
import type { CanvasHost, FrameClock, Renderer, RendererInfo, RigAssets } from "../render/types.js";
import { createGlContext } from "./context.js";
import { beginScene, createGlowTargets, deleteGlowTargets, glowGain, runGlow, type GlowTargets } from "./glow.js";
import { deleteLayers, drawLayers, uploadLayers, type LayerTexture } from "./layers.js";
import { createPrograms, deletePrograms } from "./programs.js";

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

/** The avatar renderer for `canvas` (req 1). Throws when WebGL2 is unavailable (the canvas2D fallback is task 4). */
export function createRenderer(canvas: CanvasHost, rig: Rig, assets: RigAssets): Renderer {
  const gl = createGlContext(canvas);
  if (gl === null) throw new Error("avatar: WebGL2 is unavailable");
  return createGlRenderer(gl, canvas, rig, assets);
}
