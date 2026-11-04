// @sr/engine: Engine interface, ScriptedEngine, AnthropicEngine (spec voice-and-air), and the
// health and plane wire contract shared by api/ and apps/web.
export const PACKAGE = "@sr/engine";

export { ENGINE_STATES, PLANE_HEADER, PLANES, type EngineState, type Health, type Plane } from "./health.js";
export { parseHealth } from "./validate.js";
export type { ChatMsg, Engine, EngineReply, EngineRequest, Persona } from "./types.js";
export {
  CAST_VOICES,
  castBible,
  castSlug,
  castVoice,
  findRecording,
  showOf,
  showRecording,
  type Recording,
  type ShowBank,
} from "./cast.js";
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
export {
  decodeJson,
  MAX_VOICE_CHARS,
  parseEngineRequest,
  parseMessagesResponse,
  parseVoiceRequest,
  type MessagesResponse,
  type VoiceRequest,
} from "./validate.js";
export { EngineError, MAX_LINE_CHARS, parseReply, REPLY_SCHEMA, trimLine, type EngineErrorCode } from "./schema.js";
export {
  limitChat,
  limitRequest,
  MAX_BIBLE_CHARS,
  MAX_CHAT_CHARS,
  MAX_CHAT_MESSAGES,
  MAX_NAME_CHARS,
  MAX_USER_CHARS,
  personaPrompt,
  quoteChat,
  turnPrompt,
} from "./persona.js";
export {
  ANTHROPIC_VERSION,
  AnthropicEngine,
  buildMessagesBody,
  DEFAULT_ENGINE_MODEL,
  ENGINE_MAX_TOKENS,
  engineModel,
  MESSAGES_URL,
  postMessages,
  type AnthropicEngineOptions,
  type MessagesCaller,
  type EngineEnv,
  type FetchInit,
  type FetchLike,
  type FetchResponse,
} from "./anthropic.js";
