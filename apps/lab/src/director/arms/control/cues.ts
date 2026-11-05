// C1's inline cue grammar and its incremental parser. The model writes speech with direction tags
// in square brackets; the parser reads the stream chunk by chunk and hands out sentence-sized
// lines as soon as each sentence is complete, so voicing starts before the turn ends.
//
//   tag      := "[" body "]"            (never spoken; at most MAX_TAG_CHARS long)
//   body     := emotion [intensity]      [smug 0.7]   intensity 0..1 (also [emotion smug 0.7])
//             | "gesture" gesture        [gesture nod]  (a bare gesture name works too: [nod])
//             | ["scene"] op             [scene light warm] or [light warm]
//   op       := "light" dim|warm|cold|flicker|blackout
//             | "candles" burst|dim|steady
//             | "caption" plain|whisper|shout
//             | "card" "show" id ["|" title ["|" body]]  |  "card" "hide" id
//             | "poll" "open" question "|" option "|" option ...  (2-4 options)  |  "poll" "close"
//
// A tag's events come before the sentence it sits in front of. A tag after a sentence's end
// (".[gesture nod]") closes that sentence first. Unknown or malformed tags, stray "]", a "[" that
// never closes and a tag left open at turn end become `error` pieces (the arm counts them as
// control errors); their text never reaches a spoken line.
import type { Emotion, Gesture, SceneArgs } from "../../../contract.js";
import {
  cardArgs,
  isCandleAction,
  isCaptionStyle,
  isEmotionName,
  isGestureName,
  isIntensity,
  isLightCue,
  pollArgs,
} from "./vocab.js";

export type Cue =
  | { kind: "emotion"; value: Emotion; intensity?: number }
  | { kind: "gesture"; value: Gesture }
  | { kind: "scene"; args: SceneArgs };

export type CuePiece =
  | { type: "say"; text: string }
  | { type: "cue"; cue: Cue }
  | { type: "error"; tag: string; reason: string };

/** A "[" with no "]" within this many characters is not a tag. */
export const MAX_TAG_CHARS = 200;

/** Sentence end: terminators, optional closing quotes, then whitespace. */
const SENTENCE_END = /[.!?…]+["'”’)]*\s/;
const ENDS_SENTENCE = /[.!?…]+["'”’)]*$/;

/** One tag body (between the brackets) -> a cue, or the reason it is malformed. */
export function parseTag(raw: string): Cue | string {
  const body = raw.replace(/\s+/g, " ").trim();
  if (body === "") return "empty tag";
  const [head = "", ...rest] = body.split(" ");
  const word = head.toLowerCase();
  if (word === "scene") return sceneTag(rest.join(" "));
  if (word === "emotion" || word === "emote") return emotionTag(rest);
  if (isEmotionName(word)) return emotionTag([word, ...rest]);
  if (word === "gesture") {
    const name = rest.join("_").toLowerCase();
    return rest.length > 0 && isGestureName(name) ? { kind: "gesture", value: name } : `unknown gesture "${rest.join(" ")}"`;
  }
  if (isGestureName(word) && rest.length === 0) return { kind: "gesture", value: word };
  const scene = sceneTag(body);
  return typeof scene === "string" && scene.startsWith("unknown scene op") ? `unknown tag "${head}"` : scene;
}

function emotionTag(words: readonly string[]): Cue | string {
  const [name = "", amount, ...extra] = words;
  const value = name.toLowerCase();
  if (!isEmotionName(value)) return `unknown emotion "${name}"`;
  if (extra.length > 0) return `emotion takes one intensity, got "${words.join(" ")}"`;
  if (amount === undefined) return { kind: "emotion", value };
  const intensity = Number(amount);
  if (amount.trim() === "" || !isIntensity(intensity)) return `intensity must be 0..1, got "${amount}"`;
  return { kind: "emotion", value, intensity };
}

function sceneTag(text: string): Cue | string {
  const [op = "", ...words] = text.trim().split(" ");
  const arg = words.join(" ").toLowerCase();
  const wrap = (args: SceneArgs | string): Cue | string => (typeof args === "string" ? args : { kind: "scene", args });
  switch (op.toLowerCase()) {
    case "light":
      return isLightCue(arg) ? { kind: "scene", args: { op: "light", cue: arg } } : `unknown light cue "${arg}"`;
    case "candles":
    case "candle":
      return isCandleAction(arg) ? { kind: "scene", args: { op: "candles", action: arg } } : `unknown candles action "${arg}"`;
    case "caption":
      return isCaptionStyle(arg) ? { kind: "scene", args: { op: "caption", style: arg } } : `unknown caption style "${arg}"`;
    case "card": {
      const [action = "", ...after] = words;
      const [id = "", title, body, ...extra] = after.join(" ").split("|").map((s) => s.trim());
      if (extra.length > 0) return "card takes id | title | body";
      if (action.toLowerCase() === "hide" && (title !== undefined || id.includes(" "))) return "card hide takes only an id";
      return wrap(cardArgs(action.toLowerCase(), id, title, body));
    }
    case "poll": {
      const [action = "", ...after] = words;
      if (action.toLowerCase() === "close") return after.length === 0 ? wrap(pollArgs("close")) : "poll close takes nothing";
      const [question, ...options] = after.join(" ").split("|").map((s) => s.trim());
      return wrap(pollArgs(action.toLowerCase(), question, options));
    }
    default:
      return `unknown scene op "${op}"`;
  }
}

/** Speech as it will be voiced: whitespace collapsed, no bracket characters. */
const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Feed the model's text with `push(chunk)` as it streams and call `end()` once; each returns the
 * pieces now complete, in order.
 */
export class CueStream {
  /** Raw text not yet consumed (starts with "[" when a tag is open). */
  #pending = "";
  /** Speech of the sentence being built. */
  #sentence = "";

  push(chunk: string): CuePiece[] {
    this.#pending += chunk;
    const out: CuePiece[] = [];
    for (;;) {
      const open = this.#pending.indexOf("[");
      const close = this.#pending.indexOf("]");
      if (open === -1 && close === -1) {
        this.#speech(this.#pending, out);
        this.#pending = "";
        break;
      }
      if (close !== -1 && (open === -1 || close < open)) {
        this.#speech(this.#pending.slice(0, close), out);
        out.push({ type: "error", tag: "]", reason: "stray ]" });
        this.#pending = this.#pending.slice(close + 1);
        continue;
      }
      this.#speech(this.#pending.slice(0, open), out);
      this.#pending = this.#pending.slice(open);
      const end = this.#pending.indexOf("]");
      const reopen = this.#pending.indexOf("[", 1);
      if (reopen !== -1 && (end === -1 || reopen < end)) {
        // "[smug [gesture nod]": the first "[" never closed; drop its fragment.
        out.push({ type: "error", tag: this.#pending.slice(0, reopen), reason: "tag never closed" });
        this.#pending = this.#pending.slice(reopen);
        continue;
      }
      if (end === -1) {
        if (this.#pending.length <= MAX_TAG_CHARS) break; // wait for the rest of the tag
        out.push({ type: "error", tag: this.#pending.slice(0, 24), reason: "tag never closed" });
        this.#pending = this.#pending.slice(1);
        continue;
      }
      const raw = this.#pending.slice(1, end);
      this.#pending = this.#pending.slice(end + 1);
      // A tag right after a finished sentence belongs to the next one: close the sentence first.
      if (ENDS_SENTENCE.test(this.#sentence.trimEnd())) this.#flush(out);
      const cue = parseTag(raw);
      out.push(typeof cue === "string" ? { type: "error", tag: `[${raw}]`, reason: cue } : { type: "cue", cue });
    }
    return out;
  }

  end(): CuePiece[] {
    const out: CuePiece[] = [];
    if (this.#pending.startsWith("[")) {
      out.push({ type: "error", tag: this.#pending.slice(0, 24), reason: "tag open at turn end" });
    } else {
      this.#speech(this.#pending, out);
    }
    this.#pending = "";
    this.#flush(out);
    return out;
  }

  #speech(text: string, out: CuePiece[]): void {
    if (text === "") return;
    this.#sentence += text;
    for (let m = SENTENCE_END.exec(this.#sentence); m !== null; m = SENTENCE_END.exec(this.#sentence)) {
      const cut = m.index + m[0].length;
      const line = clean(this.#sentence.slice(0, cut));
      this.#sentence = this.#sentence.slice(cut);
      if (line !== "") out.push({ type: "say", text: line });
    }
  }

  #flush(out: CuePiece[]): void {
    const line = clean(this.#sentence);
    this.#sentence = "";
    if (line !== "") out.push({ type: "say", text: line });
  }
}
