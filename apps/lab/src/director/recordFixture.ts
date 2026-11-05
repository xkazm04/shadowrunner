// `pnpm lab fixture <runId>`: the replies a recorded run spoke, per chat id, as
// src/scenarios/<scenario>.fixture.json, so later runs can use --control-fixture with no model.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineReply } from "@sr/engine";
import type { TimelineEvent } from "../contract.js";
import type { ControlFixture } from "./arms/control/fixture.js";
import { parseRunConfig } from "./config.js";
import { readJsonFile } from "./json.js";
import { runDir, SCENARIOS_DIR } from "./paths.js";
import { PLAY_MARK } from "./session.js";
import { readTimeline } from "./timeline.js";

/**
 * The first line, emotion and gesture each turn spoke. A turn's output starts at its `play:<n>`
 * mark (turns queue, so a later chat message may arrive first); without marks, at its turn event.
 */
export function repliesOf(events: readonly TimelineEvent[]): Record<string, EngineReply> {
  const out: Record<string, EngineReply> = {};
  const chatOfTurn = new Map<number, string>();
  const marked = events.some((e) => e.kind === "mark" && PLAY_MARK.test(e.name));
  let chatId: string | undefined;
  let emotion: EngineReply["emotion"] = "neutral";
  let gesture: EngineReply["gesture"];
  const begin = (id: string | undefined): void => {
    chatId = id;
    emotion = "neutral";
    gesture = undefined;
  };
  for (const e of events) {
    if (e.kind === "turn") {
      chatOfTurn.set(e.turn, e.chat.id);
      if (!marked) begin(e.chat.id);
    } else if (e.kind === "mark") {
      const play = PLAY_MARK.exec(e.name);
      if (play?.[1] !== undefined) begin(chatOfTurn.get(Number(play[1])));
    } else if (e.kind === "emotion") emotion = e.value;
    else if (e.kind === "gesture") gesture = e.value;
    else if (e.kind === "say" && chatId !== undefined && out[chatId] === undefined) {
      out[chatId] = { line: e.text, emotion, ...(gesture === undefined ? {} : { gesture }), answeredId: chatId };
    }
  }
  return out;
}

export function fixturePath(scenario: string): string {
  return join(SCENARIOS_DIR, `${scenario}.fixture.json`);
}

export function recordFixture(runId: string): string {
  const dir = runDir(runId);
  const config = parseRunConfig(readJsonFile(join(dir, "config.json")));
  const events = readTimeline(join(dir, "timeline.jsonl"));
  const wire = events.find((e) => e.kind === "mark" && e.name.startsWith("wire:"));
  const fixture: ControlFixture = {
    scenario: config.scenario,
    source: `run ${runId} (control ${config.control}${wire?.kind === "mark" ? `, ${wire.name}` : ""})`,
    replies: repliesOf(events),
  };
  const path = fixturePath(config.scenario);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  return path;
}
