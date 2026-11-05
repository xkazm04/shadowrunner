// --control-fixture: recorded replies per chat id (src/scenarios/<scenario>.fixture.json), so a
// run needs no model. `pnpm lab fixture <runId>` writes one from a recorded run's timeline.
import type { EngineReply } from "@sr/engine";
import { isEmotion, isGesture } from "@sr/engine";
import { isRecord, readJsonFile } from "../../json.js";

export interface ControlFixture {
  scenario: string;
  /** Where the replies came from (a run id and transport), for provenance. */
  source: string;
  replies: Record<string, EngineReply>;
}

export function parseFixture(value: unknown, path: string): ControlFixture {
  if (!isRecord(value) || typeof value.scenario !== "string" || typeof value.source !== "string" || !isRecord(value.replies)) {
    throw new Error(`${path} must hold { scenario, source, replies: { <chatId>: { line, emotion, gesture? } } }.`);
  }
  const replies: Record<string, EngineReply> = {};
  for (const [id, reply] of Object.entries(value.replies)) {
    if (!isRecord(reply) || typeof reply.line !== "string" || !isEmotion(reply.emotion)) {
      throw new Error(`${path}: replies.${id} needs a string line and a known emotion.`);
    }
    replies[id] = {
      line: reply.line,
      emotion: reply.emotion,
      ...(isGesture(reply.gesture) ? { gesture: reply.gesture } : {}),
      answeredId: id,
    };
  }
  return { scenario: value.scenario, source: value.source, replies };
}

export function loadFixture(path: string): ControlFixture {
  return parseFixture(readJsonFile(path), path);
}
