// @sr/engine: Engine interface, ScriptedEngine, AnthropicEngine (spec voice-and-air), and the
// health and plane wire contract shared by api/ and apps/web.
export const PACKAGE = "@sr/engine";

export { ENGINE_STATES, PLANE_HEADER, PLANES, type EngineState, type Health, type Plane } from "./health.js";
export { parseHealth } from "./validate.js";
export type { ChatMsg, Engine, EngineReply, EngineRequest, Persona } from "./types.js";
export { VOICE_IDS, VOICES, type Voice, type VoiceId } from "./voices.js";
export {
  initialPickState,
  NEW_USER_BONUS,
  pickMessage,
  QUESTION_BONUS,
  RECENCY_TAU_MS,
  VISITOR_BONUS,
  type PickContext,
  type PickResult,
  type PickState,
} from "./picker.js";
export type { ShowBeat, ShowScript } from "./types.js";
export { EMOTIONS, GESTURES } from "./types.js";
export { isEmotion, isGesture, parseShow, parseShowJson } from "./validate.js";
export { beatIndex, scriptedReply, ScriptedEngine } from "./scripted.js";
