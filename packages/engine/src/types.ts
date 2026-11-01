// Engine wire contract (voice-and-air design.md, "Contracts"), field for field. Emotion and
// Gesture are owned by @sr/rig (requirement 1.1).
import type { Emotion, Gesture } from "@sr/rig";
import type { VoiceId } from "./voices.js";

/** Every `Emotion` of @sr/rig, as a runtime list (types.test.ts pins it to the union). */
export const EMOTIONS = [
  "neutral",
  "amused",
  "smug",
  "irritated",
  "furious",
  "delighted",
  "bored",
  "suspicious",
  "grim",
  "theatrical",
] as const satisfies readonly Emotion[];

/** Every `Gesture` of @sr/rig, as a runtime list (types.test.ts pins it to the union). */
export const GESTURES = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"] as const satisfies readonly Gesture[];

/** One chat message. `fictional` marks the simulated audience; `fromVisitor` the visitor's own. */
export interface ChatMsg {
  id: string;
  user: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
  fictional?: true;
  fromVisitor?: true;
}

export interface Persona {
  characterId: string;
  name: string;
  bible: string;
  voice: VoiceId;
}

export interface EngineRequest {
  characterId: string;
  persona: Persona;
  chat: ChatMsg[];
  pickedId?: string;
  beat: number;
  seed?: number;
}

/** One line from the character. `answeredId` is the `ChatMsg.id` it answers, if any. */
export interface EngineReply {
  line: string;
  emotion: Emotion;
  gesture?: Gesture;
  answeredId?: string;
}

/** The seam the stage talks to: ScriptedEngine on replay, AnthropicEngine on live. */
export interface Engine {
  readonly kind: "scripted" | "anthropic";
  reply(req: EngineRequest): Promise<EngineReply>;
}

/**
 * One scripted beat. `at` is milliseconds from show start (the same offset clock as the audience's
 * `ts`; the stage rebases both onto its show clock). A beat without `replyTo` is generic: a segment
 * line that also serves as an answer to a visitor. `wav` is relative to `assets/replay/shows/`.
 */
export interface ShowBeat {
  at: number;
  replyTo?: string;
  reply: EngineReply;
  wav: string;
}

/** A recorded show (`assets/replay/shows/<id>.json`, design.md "ShowScript"). */
export interface ShowScript {
  id: string;
  characterId: string;
  fictional: true;
  audience: ChatMsg[];
  beats: ShowBeat[];
}
