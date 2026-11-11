// React-free avatar player (spec avatar-reach, design "Player core"): the AvatarCanvas frame loop
// for pages and elements that are not React (the <sr-avatar> element, the overlay, the studio).
// The body is player/run.ts (its renderer factory is a test seam); the frame body, shared with
// AvatarCanvas, is player/frame.ts.
import type { Emotion, Gesture, Layer, Look, Rig } from "@sr/rig";
import type { AttachAudioOptions } from "../audio/level.js";
import { createRenderer } from "../gl/renderer.js";
import type { AssetLoader } from "../render/assets.js";
import type { Affine } from "../render/frame.js";
import type { RigAssets } from "../render/types.js";
import type { ShapeWeights } from "../mouth/shapes.js";
import type { MouthPose, MouthShapesInput } from "../mouth/state.js";
import type { MouthMode } from "../mouth/anchor.js";
import { runPlayer } from "./run.js";

export interface AvatarPlayerOptions {
  rig: Rig;
  look: Look;
  assets: RigAssets;
  /** Default 1. */
  seed?: number;
  loadAsset?: AssetLoader;
  /** "auto" (default): prefers-reduced-motion. */
  reducedMotion?: boolean | "auto";
  /** Size the canvas to its parent with a ResizeObserver (default true). */
  autoSize?: boolean;
  /**
   * Draw the rig's painted backdrop (the layer named `BACKDROP_LAYER`). Default false: the player
   * is a cutout on whatever the page, the stream or the video puts behind it, as the stage hides it.
   */
  backdrop?: boolean;
  /**
   * The `start` loop stops stepping and drawing while the page is hidden or the canvas is fully
   * outside the viewport, and resumes without a time jump (default true). `renderFrame` never pauses.
   */
  pauseOffscreen?: boolean;
}

export { BACKDROP_LAYER, cutoutLook } from "./cutout.js";

export type PlayerAudio = AudioNode | HTMLMediaElement | MediaStream;

/** Where one layer was drawn by the last frame (read-only; spark llm-avatar-lab, lip arms). */
export interface LayerFrame {
  /** The rig's layer as drawn (its rest `bbox` and `anchor` are rig canvas px). */
  layer: Layer;
  /** Rig canvas px -> the canvas's device px, exactly the renderer's `layerAffine` for this frame. */
  affine: Affine;
  opacity: number;
}

export interface AvatarPlayer {
  /** An emotion change crossfades (MOOD_FADE_S), as in AvatarCanvas. */
  setLook(look: Look): void;
  setEmotion(emotion: Emotion): void;
  /** Starts on the next frame. */
  gesture(gesture: Gesture): void;
  /** `undefined` detaches. */
  attachAudio(source: PlayerAudio | undefined, options?: AttachAudioOptions): void;
  /** A level 0..1 that wins over the audio tap while set; `undefined` returns to the tap (or 0). */
  setLevel(level: number | undefined): void;
  /**
   * The drawn mouth's shape mix (a caller with visemes, e.g. the lab's lip arms): while set, it
   * shapes the mouth and opens the jaw (with the emotion added) instead of the level. `undefined`
   * returns to the level drive. Only a rig with `mouth` draws a mouth; others ignore it. Optional
   * so hand-made players (test fakes) need not carry it.
   */
  setMouthShapes?(shapes: ShapeWeights | undefined, options?: Omit<MouthShapesInput, "shapes">): void;
  /** The mouth the last frame drew (read-only), undefined when none (no `rig.mouth`, neutral rest). */
  mouth?(): MouthPose | undefined;
  /** How this rig's mouth moves (`mouthMode(rig.mouth, rig.morph)`); shapes reach "drawn", "warp" and "morph" only. */
  mouthMode?(): MouthMode | undefined;
  resize(width: number, height: number, dpr: number): void;
  /** requestAnimationFrame loop on the browser clock. */
  start(): void;
  stop(): void;
  /** One step of `dt` seconds plus a draw, outside the loop (video, tests). */
  renderFrame(dt: number): void;
  /**
   * Where each posed layer was drawn by the last frame, back to front; empty before the first
   * frame and after `dispose`. Read-only: it changes nothing the player draws. Always present on
   * `createAvatarPlayer`'s player; optional so hand-made players (test fakes) need not carry it.
   */
  layerFrames?(): LayerFrame[];
  /** Stop, detach, dispose the renderer. */
  dispose(): void;
}

/** A React-free player on `canvas`: AvatarCanvas's renderer and frame body, driven from outside React. */
export function createAvatarPlayer(canvas: HTMLCanvasElement, options: AvatarPlayerOptions): AvatarPlayer {
  return runPlayer(canvas, options, createRenderer);
}
