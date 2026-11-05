// Avatar Lab wire contract (spark llm-avatar-lab). Director-owned: builders implement against it
// and propose changes instead of editing it. Every arm on every axis compiles into this Timeline,
// which is what makes arms swappable one factor at a time.
//
// Clock: `t` is milliseconds from run start. Once an utterance's audio is scheduled, the audio is
// the clock - viseme spans are relative to that utterance's audio start.
// Absent values: an optional key is OMITTED, never 0 or null, when an arm cannot produce it.
import type { Emotion, Gesture } from "@sr/rig";

export type { Emotion, Gesture };

/** Oculus 15 viseme set. */
export const VISEMES = [
  "sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou",
] as const;
export type Viseme = (typeof VISEMES)[number];

export const SCENE_OPS = ["light", "candles", "card", "caption", "poll"] as const;
export type SceneOp = (typeof SCENE_OPS)[number];

export type SceneArgs =
  | { op: "light"; cue: "dim" | "warm" | "cold" | "flicker" | "blackout" }
  | { op: "candles"; action: "burst" | "dim" | "steady" }
  | { op: "card"; action: "show" | "hide"; id: string; title?: string; body?: string }
  | { op: "caption"; style: "plain" | "whisper" | "shout" }
  | { op: "poll"; action: "open" | "close"; question?: string; options?: string[] };

export type TimelineEvent =
  | { t: number; kind: "turn"; turn: number; chat: ChatMessage }
  | { t: number; kind: "say"; id: string; text: string }
  | { t: number; kind: "audio"; id: string; sampleRate: number; pcmRef: string; durationMs: number }
  | { t: number; kind: "viseme"; id: string; v: Viseme; startMs: number; endMs: number }
  | { t: number; kind: "emotion"; value: Emotion }
  | { t: number; kind: "gesture"; value: Gesture }
  | ({ t: number; kind: "scene" } & SceneArgs)
  | { t: number; kind: "mark"; name: string };

export type TimelineKind = TimelineEvent["kind"];

export interface ChatMessage {
  id: string;
  user: string;
  text: string;
  /** Offset into the scenario at which the message "arrives". */
  atMs: number;
}

export interface Scenario {
  id: string;
  title: string;
  /** Character pack id under apps/web/public/packs/. */
  character: string;
  persona: string;
  seed: number;
  chat: ChatMessage[];
}

export type ControlArmId = "C0" | "C1" | "C2";
export type LipArmId = "L0" | "L1" | "L2";
export type SceneArmId = "S0" | "S1";
export type OutputArmId = "O0" | "O1";
export type ExternalArmId = "overlord";

export interface RunConfig {
  control: ControlArmId;
  lip: LipArmId;
  scene: SceneArmId;
  output: OutputArmId;
  scenario: string;
  /** Overrides scenario.character. */
  character?: string;
  seed: number;
  /** Re-render this run's recorded timeline with zero LLM and zero TTS calls. */
  replayOf?: string;
  /** Set instead of the arms for an external pipeline run. */
  external?: ExternalArmId;
}

export const BASELINE: Omit<RunConfig, "scenario" | "seed"> = {
  control: "C0",
  lip: "L0",
  scene: "S0",
  output: "O0",
};

export interface Metrics {
  runId: string;
  config: RunConfig;
  durationS: number;
  /** Chat arrival to first audible sample, first turn. */
  ttfaMs?: number;
  /** Chat arrival to first audible sample, every turn. */
  turnLatencyMs?: number[];
  fpsP50?: number;
  fpsP5?: number;
  droppedFrames?: number;
  cpuPct?: number;
  gpuPct?: number;
  /** Measured from the recorded file (WP4): + means mouth lags audio. */
  avOffsetMs?: number;
  /** Model outputs that failed to parse/validate and fell back to C0 behaviour. */
  controlErrors?: number;
  sceneOps?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  /** Which WebGL backend rendered ("gpu" | "swiftshader" | "canvas2d"). */
  renderBackend?: string;
}

/** Director -> page messages over the lab WebSocket. */
export type DirectorMessage =
  | { type: "load"; runId: string; character: string; config: RunConfig }
  | { type: "event"; event: TimelineEvent }
  | { type: "pcm"; id: string; sampleRate: number; pcmBase64: string }
  | { type: "end" };

/** Page -> director messages. */
export type PageMessage =
  | { type: "ready"; renderBackend: string }
  | { type: "frameStats"; fps: number[]; dropped: number }
  | { type: "audioStarted"; id: string; atMs: number }
  | { type: "error"; message: string };

/** Director-side control arm: turns one chat message into text + direction events (no audio). */
export interface ControlArm {
  id: ControlArmId;
  turn(input: { scenario: Scenario; chat: ChatMessage; history: string[] }): AsyncIterable<
    Extract<TimelineEvent, { kind: "say" | "emotion" | "gesture" | "scene" }>
  >;
  /** Accumulated usage for metrics. */
  usage(): { tokensIn: number; tokensOut: number; costUsd: number; controlErrors: number };
}

/** Page-side lip driver: given audio + visemes, decides jaw level / mouth shape each frame. */
export interface LipDriver {
  id: LipArmId;
  onAudio(event: Extract<TimelineEvent, { kind: "audio" }>, audioStartMs: number): void;
  onViseme(event: Extract<TimelineEvent, { kind: "viseme" }>): void;
  /** Called every frame with the audio clock (ms since run start). */
  frame(nowMs: number): void;
  dispose(): void;
}

/** Page-side scene driver. S0 ignores scene events; S1 applies them. */
export interface SceneDriver {
  id: SceneArmId;
  apply(event: Extract<TimelineEvent, { kind: "scene" }>): void;
  dispose(): void;
}

/** Director-side output: how pixels + audio leave the page and land in the run directory. */
export interface OutputArm {
  id: OutputArmId;
  start(input: { pageUrl: string; runDir: string }): Promise<void>;
  /** Resolves once run.webm (O0) or run.flv/run.mp4 (O1) is closed on disk. */
  stop(): Promise<{ file: string }>;
}
