// What a control arm factory receives. One file per arm (c0.ts, c1.ts, ...) exports a factory of
// this shape; index.ts maps arm ids to factories.
import type { VoiceId } from "@sr/engine";
import type { ControlArm, TimelineEvent } from "../../../contract.js";
import type { LlmTransport } from "../../llm/index.js";
import type { ControlFixture } from "./fixture.js";

export interface ControlContext {
  /** The transport chosen by --llm (api: SDK, cli: `claude -p`). New arms call `llm.complete()`. */
  llm: LlmTransport;
  /** ANTHROPIC_API_KEY, present only with --llm api. Director-side only. */
  apiKey?: string;
  /** --control-fixture: recorded replies instead of any model call. */
  fixture?: ControlFixture;
  /** --model; each arm has a default. */
  model?: string;
  /** The character's voice id (persona metadata for prompts). */
  voice: VoiceId;
  seed: number;
  /** Diagnostics to the director's console (never into the timeline). */
  log(line: string): void;
}

export type ControlArmFactory = (ctx: ControlContext) => ControlArm;

export type ControlEvent = Extract<TimelineEvent, { kind: "say" | "emotion" | "gesture" | "scene" }>;

export interface ControlUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  controlErrors: number;
}

export const emptyUsage = (): ControlUsage => ({ tokensIn: 0, tokensOut: 0, costUsd: 0, controlErrors: 0 });
