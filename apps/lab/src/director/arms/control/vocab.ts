// The direction vocabulary C1 (inline tags) and C2 (tool calls) share: the contract's emotion,
// gesture and scene enums as runtime lists, the text limits, and one validator per scene op so both
// arms accept exactly the same SceneArgs.
import { EMOTIONS, GESTURES } from "@sr/engine";
import type { Emotion, Gesture, SceneArgs } from "../../../contract.js";

type Arg<O extends SceneArgs["op"], K extends string> = Extract<SceneArgs, { op: O }> extends infer A
  ? A extends Record<K, infer V>
    ? V
    : never
  : never;

export const LIGHT_CUES = ["dim", "warm", "cold", "flicker", "blackout"] as const satisfies readonly Arg<"light", "cue">[];
export const CANDLE_ACTIONS = ["burst", "dim", "steady"] as const satisfies readonly Arg<"candles", "action">[];
export const CARD_ACTIONS = ["show", "hide"] as const satisfies readonly Arg<"card", "action">[];
export const CAPTION_STYLES = ["plain", "whisper", "shout"] as const satisfies readonly Arg<"caption", "style">[];
export const POLL_ACTIONS = ["open", "close"] as const satisfies readonly Arg<"poll", "action">[];

// Compile-time: each list covers its contract union (a new contract value fails the build here).
type Covers<L extends readonly string[], U extends string> = Exclude<U, L[number]> extends never ? true : never;
export const VOCAB_COVERS_CONTRACT: [
  Covers<typeof LIGHT_CUES, Arg<"light", "cue">>,
  Covers<typeof CANDLE_ACTIONS, Arg<"candles", "action">>,
  Covers<typeof CARD_ACTIONS, Arg<"card", "action">>,
  Covers<typeof CAPTION_STYLES, Arg<"caption", "style">>,
  Covers<typeof POLL_ACTIONS, Arg<"poll", "action">>,
] = [true, true, true, true, true];

export const MAX_TITLE_CHARS = 60;
export const MAX_BODY_CHARS = 200;
export const MAX_QUESTION_CHARS = 120;
export const MAX_OPTION_CHARS = 40;
export const MAX_POLL_OPTIONS = 4;
export const MIN_POLL_OPTIONS = 2;
export const MAX_ID_CHARS = 32;

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

export const isEmotionName = (v: unknown): v is Emotion => oneOf(EMOTIONS, v);
export const isGestureName = (v: unknown): v is Gesture => oneOf(GESTURES, v);
export const isLightCue = (v: unknown): v is Arg<"light", "cue"> => oneOf(LIGHT_CUES, v);
export const isCandleAction = (v: unknown): v is Arg<"candles", "action"> => oneOf(CANDLE_ACTIONS, v);
export const isCaptionStyle = (v: unknown): v is Arg<"caption", "style"> => oneOf(CAPTION_STYLES, v);

/** Intensity is 0..1 inclusive. */
export const isIntensity = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** A one-word card id: letters, digits, `_` and `-`. */
export const CARD_ID = /^[A-Za-z0-9_-]+$/;

const clip = (text: string, max: number): string => text.replace(/\s+/g, " ").trim().slice(0, max);

/** A card op from loose fields; a string is the reason it is invalid. */
export function cardArgs(action: unknown, id: unknown, title?: unknown, body?: unknown): SceneArgs | string {
  if (!oneOf(CARD_ACTIONS, action)) return `card action must be one of ${CARD_ACTIONS.join("/")}`;
  if (typeof id !== "string" || !CARD_ID.test(id) || id.length > MAX_ID_CHARS) return "card needs a one-word id";
  if (title !== undefined && typeof title !== "string") return "card title must be text";
  if (body !== undefined && typeof body !== "string") return "card body must be text";
  if (action === "hide") return { op: "card", action, id };
  const t = typeof title === "string" ? clip(title, MAX_TITLE_CHARS) : "";
  const b = typeof body === "string" ? clip(body, MAX_BODY_CHARS) : "";
  return { op: "card", action, id, ...(t === "" ? {} : { title: t }), ...(b === "" ? {} : { body: b }) };
}

/** A poll op from loose fields. Opening needs a question and 2-4 options (a poll the stage can draw). */
export function pollArgs(action: unknown, question?: unknown, options?: unknown): SceneArgs | string {
  if (!oneOf(POLL_ACTIONS, action)) return `poll action must be one of ${POLL_ACTIONS.join("/")}`;
  if (action === "close") return { op: "poll", action };
  if (typeof question !== "string" || question.trim() === "") return "poll open needs a question";
  if (!Array.isArray(options) || !options.every((o) => typeof o === "string")) return "poll options must be a list of text";
  const opts = options.map((o: string) => clip(o, MAX_OPTION_CHARS)).filter((o) => o !== "");
  if (opts.length < MIN_POLL_OPTIONS || opts.length > MAX_POLL_OPTIONS) {
    return `poll open needs ${MIN_POLL_OPTIONS}-${MAX_POLL_OPTIONS} options`;
  }
  return { op: "poll", action, question: clip(question, MAX_QUESTION_CHARS), options: opts };
}
