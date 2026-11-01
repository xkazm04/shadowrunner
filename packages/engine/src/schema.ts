// The live engine's output contract (voice-and-air design.md, "Structured output"): the JSON
// schema sent to the Messages API and `parseReply`, the validator of what comes back. The schema
// carries no min/max/length keywords (limits are restated in descriptions); `parseReply` enforces
// them. JSON text is decoded only in ./validate.ts (tech.md).
import type { EngineReply } from "./types.js";
import { EMOTIONS, GESTURES } from "./types.js";
import { decodeJsonObject, isEmotion, isGesture } from "./validate.js";

/** The longest line the character may say aloud (requirement 1.4). */
export const MAX_LINE_CHARS = 250;

/** Error codes the engine raises across the API (`{ error: { code, message } }`). */
export type EngineErrorCode = "upstream" | "quota" | "bad_input";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

/** Structured-output schema for one reply. Every object has `additionalProperties: false`. */
export const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["line", "emotion"],
  properties: {
    line: {
      type: "string",
      description: "What the character says aloud. At most 250 characters, one or two sentences, in character.",
    },
    emotion: { type: "string", enum: [...EMOTIONS] },
    gesture: {
      type: "string",
      enum: [...GESTURES],
      description: "Optional; omit unless the line calls for it.",
    },
    answeredId: { type: "string", description: "The id of the chat message answered, if any." },
  },
} as const;

/** Ends a sentence: . ! or ? (also an ellipsis), optionally followed by closing quotes/brackets. */
const SENTENCE_END = /[.!?…]["'’”)\]]*(?=\s|$)/g;

/**
 * Trims `text` to at most `max` characters. Within the limit it is returned whitespace-trimmed.
 * Over it, it is cut at the last sentence boundary that fits; with none, at the last space that
 * fits; with no space either, hard at `max`. The result is always a prefix of the trimmed text.
 */
export function trimLine(text: string, max = MAX_LINE_CHARS): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  let cut = -1;
  for (const match of clean.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (end > max) break;
    cut = end;
  }
  if (cut > 0) return clean.slice(0, cut).trimEnd();
  const space = clean.lastIndexOf(" ", max);
  const head = clean.slice(0, space > 0 ? space : max).trimEnd();
  return head.length > 0 ? head : clean.slice(0, max);
}

/**
 * Validates engine output text into an EngineReply: `line` trimmed to 250 characters at a
 * sentence boundary, an unknown emotion becomes `neutral`, an unknown gesture or a non-string
 * `answeredId` is dropped. Anything that is not a JSON object with a non-empty string `line`
 * raises `EngineError("upstream")`; no other error escapes.
 */
export function parseReply(text: string): EngineReply {
  const fields = decodeJsonObject(text);
  if (fields === undefined) throw new EngineError("upstream", "engine reply is not a JSON object");
  const { line: rawLine, emotion, gesture, answeredId } = fields;
  if (typeof rawLine !== "string") throw new EngineError("upstream", "engine reply has no line");
  const line = trimLine(rawLine);
  if (line.length === 0) throw new EngineError("upstream", "engine reply line is empty");
  return {
    line,
    emotion: isEmotion(emotion) ? emotion : "neutral",
    ...(isGesture(gesture) ? { gesture } : {}),
    ...(typeof answeredId === "string" && answeredId.length > 0 ? { answeredId } : {}),
  };
}
