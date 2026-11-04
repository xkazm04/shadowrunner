// React-free avatar player (spec avatar-reach, design "Player core"): the AvatarCanvas frame loop
// for pages and elements that are not React (the <sr-avatar> element, the overlay, the studio).
// The body is player/run.ts (its renderer factory is a test seam); the frame body, shared with
// AvatarCanvas, is player/frame.ts.
import type { Emotion, Gesture, Look, Rig } from "@sr/rig";
import type { AttachAudioOptions } from "../audio/level.js";
import { createRenderer } from "../gl/renderer.js";
import type { AssetLoader } from "../render/assets.js";
import type { RigAssets } from "../render/types.js";
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
}

export type PlayerAudio = AudioNode | HTMLMediaElement | MediaStream;

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
  resize(width: number, height: number, dpr: number): void;
  /** requestAnimationFrame loop on the browser clock. */
  start(): void;
  stop(): void;
  /** One step of `dt` seconds plus a draw, outside the loop (video, tests). */
  renderFrame(dt: number): void;
  /** Stop, detach, dispose the renderer. */
  dispose(): void;
}

/** A React-free player on `canvas`: AvatarCanvas's renderer and frame body, driven from outside React. */
export function createAvatarPlayer(canvas: HTMLCanvasElement, options: AvatarPlayerOptions): AvatarPlayer {
  return runPlayer(canvas, options, createRenderer);
}
