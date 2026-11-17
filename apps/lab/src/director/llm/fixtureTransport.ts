// --control-fixture as a transport: a recorded turn (arms/control/fixture.ts) served in whatever wire
// the request asks for, so every control arm replays through its own live path with no per-arm
// adapter and no model call. The turn is picked by `request.key` (the chat id):
//   tools   -> one `toolCall` chunk per event (emote / gesture / say / the scene op's tool)
//   schema  -> one `json` chunk { line, emotion, gesture? } (REPLY_SCHEMA; C0 through messagesFetch)
//   else    -> `text` chunks in C1's cue grammar (cues.ts), one per event, that CueStream reads back
// Then usage 0/0 and stop. A chat id with no recorded turn throws, as a failed model call would.
import type { SceneArgs } from "../../contract.js";
import { replyOf, type ControlFixture } from "../arms/control/fixture.js";
import type { ControlEvent } from "../arms/control/types.js";
import type { LlmChunk, LlmRequest, LlmTransport } from "./types.js";

/** Brackets would open or close a tag; "|" would split a card or poll field. */
const plain = (text: string): string => text.replace(/\[/g, "(").replace(/\]/g, ")");
const field = (text: string): string => plain(text).replace(/\|/g, "/");

function sceneTag(args: SceneArgs): string {
  switch (args.op) {
    case "light":
      return `light ${args.cue}`;
    case "candles":
      return `candles ${args.action}`;
    case "caption":
      return `caption ${args.style}`;
    case "card": {
      if (args.action === "hide") return `card hide ${args.id}`;
      const title = args.title === undefined && args.body === undefined ? "" : ` | ${field(args.title ?? "")}`;
      return `card show ${args.id}${title}${args.body === undefined ? "" : ` | ${field(args.body)}`}`;
    }
    case "poll":
      return args.action === "close" ? "poll close" : `poll open ${[args.question ?? "", ...(args.options ?? [])].map(field).join(" | ")}`;
  }
}

/** One event in C1's cue grammar: a tag, or the spoken text. */
export function cueSegment(event: ControlEvent): string {
  switch (event.kind) {
    case "emotion":
      return `[${event.value}]`;
    case "gesture":
      return `[gesture ${event.value}]`;
    case "say":
      return plain(event.text);
    case "scene":
      return `[scene ${sceneTag(event)}]`;
  }
}

/** One event as the C2 tool call that performs it. */
export function toolCallOf(event: ControlEvent): { name: string; input: Record<string, unknown> } {
  switch (event.kind) {
    case "emotion":
      return { name: "emote", input: { emotion: event.value } };
    case "gesture":
      return { name: "gesture", input: { name: event.value } };
    case "say":
      return { name: "say", input: { text: event.text } };
    case "scene":
      return { name: event.op, input: Object.fromEntries(Object.entries(event).filter(([k]) => k !== "t" && k !== "kind" && k !== "op")) };
  }
}

function* render(key: string, turn: readonly ControlEvent[], request: LlmRequest): Generator<LlmChunk> {
  if (request.tools !== undefined) {
    for (const [i, event] of turn.entries()) yield { type: "toolCall", id: `fixture-call-${i + 1}`, ...toolCallOf(event) };
  } else if (request.schema !== undefined) {
    const reply = replyOf(key, turn);
    if (reply === undefined) throw new Error(`The fixture's turn for chat "${key}" has no spoken line to answer with.`);
    yield { type: "json", value: { line: reply.line, emotion: reply.emotion, ...(reply.gesture === undefined ? {} : { gesture: reply.gesture }) } };
  } else {
    for (const [i, event] of turn.entries()) yield { type: "text", text: `${i === 0 ? "" : " "}${cueSegment(event)}` };
  }
}

export function createFixtureTransport(fixture: ControlFixture): LlmTransport {
  return {
    kind: "fixture",
    async *complete(request) {
      const key = request.key;
      const turn = key === undefined ? undefined : fixture.turns[key];
      if (key === undefined || turn === undefined) {
        throw new Error(`The fixture (${fixture.source}) has no recorded turn for chat "${key ?? "(no chat id)"}".`);
      }
      yield* render(key, turn, request);
      yield { type: "usage", tokensIn: 0, tokensOut: 0 };
      yield { type: "stop", reason: request.tools === undefined ? "end_turn" : "tool_use" };
    },
  };
}
