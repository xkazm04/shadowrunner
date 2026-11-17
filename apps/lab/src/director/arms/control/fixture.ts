// --control-fixture: recorded performances per chat id (src/scenarios/<scenario>.fixture.json), so a
// run needs no model. `pnpm lab fixture <runId>` writes one from a recorded run's timeline. The
// fixture is served to the arm as a transport (llm/fixtureTransport.ts), in the arm's own wire.
//
//   v2  { version: 2, scenario, source, turns: { <chatId>: [ { kind, ... } ] } }   every say, emotion,
//       gesture and scene event the turn produced, in order (no `t`; say ids are assigned on load)
//   v1  { scenario, source, replies: { <chatId>: { line, emotion, gesture? } } }  C0's shape; upcast
//       on load to [emotion, gesture?, say]
import type { EngineReply } from "@sr/engine";
import { isEmotion, isGesture } from "@sr/engine";
import { isRecord, readJsonFile } from "../../json.js";
import { parseTimelineEvent } from "../../timeline.js";
import type { ControlEvent } from "./types.js";

export interface ControlFixture {
  scenario: string;
  /** Where the performances came from (a run id and transport), for provenance. */
  source: string;
  /** Each turn's performance in order, `t` 0, say ids `say-<chatId>-<n>`. */
  turns: Record<string, ControlEvent[]>;
  /** C0's view of each turn that spoke: its first line, with the emotion and gesture set before it. */
  replies: Record<string, EngineReply>;
}

export const FIXTURE_VERSION = 2;

/** The first line a turn spoke, with the last emotion (default neutral) and gesture before it. */
export function replyOf(chatId: string, events: readonly ControlEvent[]): EngineReply | undefined {
  let emotion: EngineReply["emotion"] = "neutral";
  let gesture: EngineReply["gesture"];
  for (const e of events) {
    if (e.kind === "emotion") emotion = e.value;
    else if (e.kind === "gesture") gesture = e.value;
    else if (e.kind === "say") return { line: e.text, emotion, ...(gesture === undefined ? {} : { gesture }), answeredId: chatId };
  }
  return undefined;
}

/** Say ids renumbered `say-<chatId>-<n>` and `t` zeroed, so a turn compares equal however it was recorded. */
export function normalizeTurn(chatId: string, events: readonly ControlEvent[]): ControlEvent[] {
  let lines = 0;
  return events.map((e) => (e.kind === "say" ? { t: 0, kind: "say", id: `say-${chatId}-${(lines += 1)}`, text: e.text } : { ...e, t: 0 }));
}

function parseTurn(path: string, chatId: string, value: unknown): ControlEvent[] {
  if (!Array.isArray(value)) throw new Error(`${path}: turns.${chatId} must be a list of events.`);
  return normalizeTurn(
    chatId,
    value.map((item: unknown, i) => {
      const event = parseTimelineEvent(isRecord(item) ? { id: "say", ...item, t: 0 } : item);
      if (event === undefined || (event.kind !== "say" && event.kind !== "emotion" && event.kind !== "gesture" && event.kind !== "scene")) {
        throw new Error(`${path}: turns.${chatId}[${i}] is not a valid say, emotion, gesture or scene event.`);
      }
      return event;
    }),
  );
}

function upcastReply(path: string, chatId: string, reply: unknown): ControlEvent[] {
  if (!isRecord(reply) || typeof reply.line !== "string" || !isEmotion(reply.emotion)) {
    throw new Error(`${path}: replies.${chatId} needs a string line and a known emotion.`);
  }
  return [
    { t: 0, kind: "emotion", value: reply.emotion },
    ...(isGesture(reply.gesture) ? [{ t: 0, kind: "gesture" as const, value: reply.gesture }] : []),
    { t: 0, kind: "say", id: `say-${chatId}-1`, text: reply.line },
  ];
}

export function parseFixture(value: unknown, path: string): ControlFixture {
  const shape = `${path} must hold { scenario, source, turns: { <chatId>: [events] } } (or v1 replies: { <chatId>: { line, emotion, gesture? } }).`;
  if (!isRecord(value) || typeof value.scenario !== "string" || typeof value.source !== "string") throw new Error(shape);
  const turns: Record<string, ControlEvent[]> = {};
  if (isRecord(value.turns)) {
    for (const [id, turn] of Object.entries(value.turns)) turns[id] = parseTurn(path, id, turn);
  } else if (isRecord(value.replies)) {
    for (const [id, reply] of Object.entries(value.replies)) turns[id] = upcastReply(path, id, reply);
  } else throw new Error(shape);
  const replies: Record<string, EngineReply> = {};
  for (const [id, turn] of Object.entries(turns)) {
    const reply = replyOf(id, turn);
    if (reply !== undefined) replies[id] = reply;
  }
  return { scenario: value.scenario, source: value.source, turns, replies };
}

export function loadFixture(path: string): ControlFixture {
  return parseFixture(readJsonFile(path), path);
}

/** The v2 file body: events without `t`, says without ids (both are assigned on load). */
export function fixtureFile(fixture: Pick<ControlFixture, "scenario" | "source" | "turns">): Record<string, unknown> {
  const turns: Record<string, unknown[]> = {};
  for (const [id, events] of Object.entries(fixture.turns)) {
    turns[id] = events.map((e) => (e.kind === "say" ? { kind: "say", text: e.text } : Object.fromEntries(Object.entries(e).filter(([k]) => k !== "t"))));
  }
  return { version: FIXTURE_VERSION, scenario: fixture.scenario, source: fixture.source, turns };
}
