// Engine wire contract (voice-and-air design.md, "Contracts"), field for field. Emotion and
// Gesture are owned by @sr/rig (requirement 1.1).
import type { Emotion, Gesture } from "@sr/rig";
import type { VoiceId } from "./voices.js";

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
