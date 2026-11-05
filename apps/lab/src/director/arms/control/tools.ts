// C2's tools and the validator every call passes before it becomes an event. The schemas carry the
// contract enums, so the api transport's real tool_use and the cli transport's emulated calls
// (llm/cliStream.ts toolCallSchema) are constrained the same way; the validator still checks each
// call, because neither the model nor a schema-less path is trusted.
import { EMOTIONS, GESTURES } from "@sr/engine";
import { isRecord } from "../../json.js";
import type { LlmTool } from "../../llm/index.js";
import type { ControlEvent } from "./types.js";
import {
  CANDLE_ACTIONS,
  CAPTION_STYLES,
  CARD_ACTIONS,
  cardArgs,
  isCandleAction,
  isCaptionStyle,
  isEmotionName,
  isGestureName,
  isIntensity,
  isLightCue,
  LIGHT_CUES,
  MAX_BODY_CHARS,
  MAX_ID_CHARS,
  MAX_OPTION_CHARS,
  MAX_POLL_OPTIONS,
  MAX_QUESTION_CHARS,
  MAX_TITLE_CHARS,
  MIN_POLL_OPTIONS,
  POLL_ACTIONS,
  pollArgs,
} from "./vocab.js";
import { MAX_SPEECH_CHARS } from "./prompts.js";

const object = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
// Limits live in descriptions, not keywords: structured outputs reject several numeric and string
// constraints, and the validator enforces every limit anyway.
const text = (description: string, maxLength: number): Record<string, unknown> => ({
  type: "string",
  description: `${description} At most ${maxLength} characters.`,
});

export const C2_TOOLS: readonly LlmTool[] = [
  {
    name: "say",
    description: "Speak one sentence aloud, in character. Spoken words only.",
    input_schema: object({ text: text("The sentence.", MAX_SPEECH_CHARS) }, ["text"]),
  },
  {
    name: "emote",
    description: "Set your face's emotion, optionally how strongly (0-1).",
    input_schema: object(
      { emotion: { type: "string", enum: [...EMOTIONS] }, intensity: { type: "number", description: "0 (faint) to 1 (full)." } },
      ["emotion"],
    ),
  },
  {
    name: "gesture",
    description: "Play one body gesture.",
    input_schema: object({ name: { type: "string", enum: [...GESTURES] } }, ["name"]),
  },
  {
    name: "light",
    description: "Change the room light.",
    input_schema: object({ cue: { type: "string", enum: [...LIGHT_CUES] } }, ["cue"]),
  },
  {
    name: "candles",
    description: "Make the candles flare up (burst), gutter low (dim) or burn steady.",
    input_schema: object({ action: { type: "string", enum: [...CANDLE_ACTIONS] } }, ["action"]),
  },
  {
    name: "card",
    description: "Show an on-screen card (title and body) or hide it by id.",
    input_schema: object(
      {
        action: { type: "string", enum: [...CARD_ACTIONS] },
        id: text("One word: letters, digits, _ or -.", MAX_ID_CHARS),
        title: text("Card title (show).", MAX_TITLE_CHARS),
        body: text("Card body (show).", MAX_BODY_CHARS),
      },
      ["action", "id"],
    ),
  },
  {
    name: "caption",
    description: "Style the caption of the words that follow: plain, whisper or shout.",
    input_schema: object({ style: { type: "string", enum: [...CAPTION_STYLES] } }, ["style"]),
  },
  {
    name: "poll",
    description: `Open a poll (question and ${MIN_POLL_OPTIONS}-${MAX_POLL_OPTIONS} options) or close the open one.`,
    input_schema: object(
      {
        action: { type: "string", enum: [...POLL_ACTIONS] },
        question: text("The question (open).", MAX_QUESTION_CHARS),
        options: { type: "array", items: text("One option.", MAX_OPTION_CHARS), description: `${MIN_POLL_OPTIONS}-${MAX_POLL_OPTIONS} options (open).` },
      },
      ["action"],
    ),
  },
];

/** One call -> its event, or the reason it is invalid. `sayId` names the line if it is a say. */
export function validateCall(name: string, input: unknown, sayId: string): ControlEvent | string {
  if (!C2_TOOLS.some((t) => t.name === name)) return `unknown tool "${name}"`;
  if (!isRecord(input)) return `${name}: input is not an object`;
  switch (name) {
    case "say": {
      if (typeof input.text !== "string") return "say: text missing";
      const line = input.text.replace(/\s+/g, " ").trim().slice(0, MAX_SPEECH_CHARS);
      return line === "" ? "say: text empty" : { t: 0, kind: "say", id: sayId, text: line };
    }
    case "emote":
      if (!isEmotionName(input.emotion)) return `emote: unknown emotion ${JSON.stringify(input.emotion)}`;
      if (input.intensity !== undefined && !isIntensity(input.intensity)) return "emote: intensity must be 0..1";
      return { t: 0, kind: "emotion", value: input.emotion };
    case "gesture":
      return isGestureName(input.name) ? { t: 0, kind: "gesture", value: input.name } : `gesture: unknown ${JSON.stringify(input.name)}`;
    case "light":
      return isLightCue(input.cue) ? { t: 0, kind: "scene", op: "light", cue: input.cue } : `light: unknown cue ${JSON.stringify(input.cue)}`;
    case "candles":
      return isCandleAction(input.action)
        ? { t: 0, kind: "scene", op: "candles", action: input.action }
        : `candles: unknown action ${JSON.stringify(input.action)}`;
    case "caption":
      return isCaptionStyle(input.style)
        ? { t: 0, kind: "scene", op: "caption", style: input.style }
        : `caption: unknown style ${JSON.stringify(input.style)}`;
    case "card": {
      const args = cardArgs(input.action, input.id, input.title, input.body);
      return typeof args === "string" ? args : { t: 0, kind: "scene", ...args };
    }
    case "poll": {
      const args = pollArgs(input.action, input.question, input.options);
      return typeof args === "string" ? args : { t: 0, kind: "scene", ...args };
    }
    default:
      return `unknown tool "${name}"`;
  }
}
