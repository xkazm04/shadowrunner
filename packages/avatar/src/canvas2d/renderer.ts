// Canvas2D fallback (avatar-renderer req 2.2): the same `Renderer` interface; draws the same
// `LayerPose[]` (position, scale, rotation, opacity) through the shared frame math, and skips the
// rim light and the glow. The eye colour and eyeGain are light terms too and are skipped with
// them; the brow offset is geometry and is kept, so both renderers place every layer identically.
// Pose `tint` (a layer pulse, cast-forge req 1, and the glare/flare gains) is drawn as a
// `brightness()` filter, the same per-channel multiply the GL base pass applies; where the
// browser has no canvas filter it is a no-op.
import type { Layer, LayerPose, Look, Rig } from "@sr/rig";
import { fitView, layerAffine, lookLight } from "../render/frame.js";
import type { CanvasHost, Renderer, RendererInfo, RigAssets } from "../render/types.js";

interface Entry {
  layer: Layer;
  image: ImageBitmap | HTMLImageElement;
}

/** The canvas filter for a pose tint: "none" at 1 (or a non-finite tint), else `brightness(tint)`. */
export function tintFilter(tint: number): string {
  if (!Number.isFinite(tint) || tint === 1) return "none";
  return `brightness(${Math.max(0, tint).toFixed(4)})`;
}

/** A 2D renderer on `ctx` (whose canvas is `canvas`); `ctx` null draws nothing (no surface at all). */
export function createCanvas2dRenderer(canvas: CanvasHost, ctx: CanvasRenderingContext2D | null, rig: Rig, assets: RigAssets): Renderer {
  let entries = new Map<string, Entry>();
  let currentRig = rig;
  let browY = 0;
  let lastLook: Look | undefined;
  let drawCalls = 0;
  let disposed = false;

  const setRig = (next: Rig, nextAssets: RigAssets): void => {
    currentRig = next;
    lastLook = undefined;
    entries = new Map();
    for (const layer of next.layers) {
      const image = nextAssets[layer.file];
      if (layer.visible !== false && image !== undefined && !entries.has(layer.name)) entries.set(layer.name, { layer, image });
    }
  };

  const setLook = (look: Look): void => {
    lastLook = look;
    browY = lookLight(currentRig, look).browY;
  };

  setRig(rig, assets);

  return {
    setRig,
    setLook,
    draw(poses: LayerPose[], look: Look): void {
      drawCalls = 0;
      if (disposed || ctx === null) return;
      if (look !== lastLook) setLook(look);
      const view = fitView(currentRig, canvas.width, canvas.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (const pose of poses) {
        const entry = entries.get(pose.name);
        if (entry === undefined) continue;
        const { layer, image } = entry;
        const m = layerAffine(layer, pose, view, browY);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.globalAlpha = Math.min(1, Math.max(0, pose.opacity));
        ctx.filter = tintFilter(pose.tint);
        ctx.drawImage(image, layer.bbox[0], layer.bbox[1], layer.bbox[2], layer.bbox[3]);
        drawCalls += 1;
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
    },
  };
}
