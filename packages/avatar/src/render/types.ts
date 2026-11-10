// Renderer contract shared by the WebGL2 renderer and its canvas2D fallback (design.md "Contracts").
import type { Drive, LayerPose, Look, MorphPlan, Rig } from "@sr/rig";
import type { MouthPose } from "../mouth/state.js";

/** Layer images keyed by `Layer.file`. ImageBitmaps should be created with `premultiplyAlpha: "premultiply"`. */
export type RigAssets = Record<string, ImageBitmap | HTMLImageElement>;

export interface RendererInfo {
  mode: "webgl2" | "2d";
  /** Draw calls issued by the last `draw`. */
  drawCalls: number;
  /** Layer textures uploaded since creation (the 2D renderer uploads none). */
  textureUploads: number;
}

/**
 * Optional per-frame timing for `draw`, on the driver's clock. Only the glow pulse reads it; without
 * it (or with `reducedMotion`) the glow holds steady (req 5.3).
 */
export interface FrameClock {
  /** Seconds, the driver's `t`. */
  t: number;
  reducedMotion: boolean;
  /**
   * Eyes-only dim, 0..1 (absent = 0, none): every layer but an emissive eye falls toward
   * `DIM_FLOOR` of its light (`dimGain`), in both renderers. The caller eases it (`easeDim`).
   */
  dim?: number;
  /**
   * The drawn mouth this frame (absent = none: a rig without `mouth`, or neutral rest). Both
   * renderers draw it on the rig's `mouth`, in the head's frame, over the head and the jaw.
   */
  mouth?: MouthPose;
  /**
   * The emotion crossfade in progress (face-control): the drive's `mood`, so the look's light
   * (eyeGain, brow shift) fades with the pose. Absent = settled.
   */
  mood?: Drive["mood"];
  /**
   * The head's turn this frame (perfection-pass V2): yaw and pitch as shares of rig-core's
   * YAW_LIMIT_DEG and PITCH_LIMIT_DEG, -1..1, as the pose turned it (gesture and mood included).
   * Absent or zero = facing front: the WebGL renderer bends and relights nothing (gl/turn.ts).
   * The canvas2D fallback ignores it and keeps the rigid pan.
   */
  turn?: { yaw: number; pitch: number };
  /**
   * The morph keys this frame (companion-lanes, a rig with `morph`, player/morph.ts): absent when no
   * key is active and nothing sways, so the morph layer draws exactly as any layer.
   */
  morph?: MorphFrame;
}

/** One frame of a morph rig's keys: the plan (@sr/rig `morphPlan`, reused) and the sway lag. */
export interface MorphFrame {
  plan: MorphPlan;
  /** The sway lag L, -1..1 per axis (x right, y down; 0, 0 = still): a pixel of sway weight s moves by s x amp x L. */
  sway: { x: number; y: number };
}

export interface Renderer {
  setRig(rig: Rig, assets: RigAssets): void;
  setLook(look: Look): void;
  draw(poses: LayerPose[], look: Look, clock?: FrameClock): void;
  /** CSS size and device pixel ratio; the drawing buffer becomes `round(size * dpr)`. */
  resize(width: number, height: number, dpr: number): void;
  info(): RendererInfo;
  dispose(): void;
}

/**
 * The canvas surface the renderers need. An `HTMLCanvasElement` satisfies it; tests pass stubs.
 */
export interface CanvasHost {
  width: number;
  height: number;
  getContext(contextId: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
  getContext(contextId: "2d", options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
  addEventListener(type: "webglcontextlost" | "webglcontextrestored", listener: (event: Event) => void): void;
  removeEventListener(type: "webglcontextlost" | "webglcontextrestored", listener: (event: Event) => void): void;
}
