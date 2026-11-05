// Prompts for C1 and C2: the product engine's persona prompt (same bible, same rules as C0) with
// its one-line, no-stage-directions rule swapped for the arm's direction channel, and the same
// quoted chat window as C0's turn prompt.
import { EMOTIONS, GESTURES, personaPrompt, quoteChat, type EngineRequest, type Persona } from "@sr/engine";
import { CANDLE_ACTIONS, CAPTION_STYLES, LIGHT_CUES, MAX_POLL_OPTIONS, MIN_POLL_OPTIONS } from "./vocab.js";

/** Spoken text budget per reply, as the engine's rule (250 characters). */
export const MAX_SPEECH_CHARS = 250;

const ONE_LINE_RULE = /^- Answer with one spoken line.*$/m;

/** The engine's persona prompt without its output-format rule (each arm states its own). */
export function basePersona(persona: Persona): string {
  const prompt = personaPrompt(persona);
  if (!ONE_LINE_RULE.test(prompt)) throw new Error("@sr/engine personaPrompt changed: its one-line rule is gone; update prompts.ts.");
  return prompt.replace(ONE_LINE_RULE, `- Speak one to three short sentences, at most ${MAX_SPEECH_CHARS} characters of speech in total.`);
}

const ROOM =
  "You also run the room: the light, the candles, on-screen cards, the caption style and polls. " +
  "Use them when chat asks for them or the moment earns it (at most three room changes per reply).";

export function c1System(persona: Persona): string {
  return [
    basePersona(persona),
    "",
    "Direct yourself with inline tags in square brackets, each placed right before the words it colours. Tags are never spoken.",
    `- [<emotion>] or [<emotion> <intensity 0-1>]. Emotions: ${EMOTIONS.join(", ")}. Start every reply with one.`,
    `- [gesture <name>]. Gestures: ${GESTURES.join(", ")}.`,
    `- [light ${LIGHT_CUES.join("|")}]`,
    `- [candles ${CANDLE_ACTIONS.join("|")}]`,
    `- [caption ${CAPTION_STYLES.join("|")}] styles the caption of the words that follow.`,
    "- [card show <id> | <title> | <body>] puts a card on screen (id is one word); [card hide <id>] takes it down.",
    `- [poll open <question> | <option> | <option>] opens a poll with ${MIN_POLL_OPTIONS}-${MAX_POLL_OPTIONS} options; [poll close] ends it.`,
    `- ${ROOM}`,
    "- No other brackets, no asterisks, no markdown, no stage directions outside tags.",
    "Example: [smug 0.7] Name recorded. [gesture nod] [light warm] Do not wander off.",
  ].join("\n");
}

export function c2System(persona: Persona): string {
  return [
    basePersona(persona),
    "",
    "You perform only through tool calls, made all at once in the order they happen:",
    "- `emote` first, then `say` for each sentence you speak (one sentence per call).",
    "- Put `gesture` and room calls right before the `say` they belong to.",
    `- ${ROOM}`,
    "- Every reply has at least one `say`. Never put stage directions inside `say` text.",
  ].join("\n");
}

/** The user turn: C0's quoted chat window and which message to answer. */
export function turnText(request: EngineRequest): string {
  const picked = request.pickedId === undefined ? "the room" : `the chat message with id ${JSON.stringify(request.pickedId)}`;
  return `${quoteChat(request.chat)}\n\nBeat ${request.beat}. Answer ${picked}.`;
}
