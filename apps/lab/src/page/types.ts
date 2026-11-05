// Page-side seams the arm registries hand to lip drivers and scene drivers. A new arm is one file
// exporting a factory of one of these shapes, registered in lip/index.ts or scene/index.ts.
import type { AvatarPlayer } from "@sr/avatar/core";
import type { LipDriver, SceneDriver } from "../contract.js";

export interface StageAudio {
  readonly context: AudioContext;
  /** Every utterance plays through this node (to the speakers and the recording). */
  readonly output: GainNode;
  /** The audio clock: ms since the stage's audio started (AudioContext time). */
  nowMs(): number;
  /** Speech level 0..1 of the output (the avatar package's RMS tap). */
  level(): number;
}

export interface LipContext {
  player: AvatarPlayer;
  audio: StageAudio;
  reducedMotion: boolean;
}

export type LipDriverFactory = (ctx: LipContext) => LipDriver;

/** Draws into the recorded composite (1920x1080): `back` under the avatar, `front` over it. */
export type ScenePainter = (g: CanvasRenderingContext2D, nowMs: number) => void;

export interface SceneContext {
  /** The stage element (1920x1080); scene DOM goes inside it. */
  stage: HTMLElement;
  audio: StageAudio;
  /** True when the viewer prefers reduced motion and the run does not force motion on. */
  reducedMotion: boolean;
  /** Runs every frame before drawing, on the audio clock. */
  onFrame(hook: (nowMs: number) => void): void;
  /**
   * The recording captures a canvas, not the DOM: whatever a scene shows must also be painted
   * here to reach run.webm (O0). DOM-only scene elements are visible live but not recorded.
   */
  addPainter(layer: "back" | "front", painter: ScenePainter): void;
}

export type SceneDriverFactory = (ctx: SceneContext) => SceneDriver;
