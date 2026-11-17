// `pnpm lab fixture <runId>`: every turn a recorded run performed (each line, emotion, gesture and
// scene op, in order), per chat id, as src/scenarios/<scenario>.fixture.json (format v2), so later
// runs can use --control-fixture with no model, through any control arm.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineReply } from "@sr/engine";
import type { TimelineEvent } from "../contract.js";
import { fixtureFile, normalizeTurn, replyOf, type ControlFixture } from "./arms/control/fixture.js";
import type { ControlEvent } from "./arms/control/types.js";
import { parseRunConfig } from "./config.js";
import { readJsonFile } from "./json.js";
import { runDir, SCENARIOS_DIR } from "./paths.js";
import { PLAY_MARK } from "./session.js";
import { readTimeline } from "./timeline.js";

/**
 * Each turn's performance: its say, emotion, gesture and scene events in order. A turn's output
 * starts at its `play:<n>` mark (turns queue, so a later chat message may arrive first); without
 * marks, at its turn event.
 */
export function performancesOf(events: readonly TimelineEvent[]): Record<string, ControlEvent[]> {
  const out: Record<string, ControlEvent[]> = {};
  const chatOfTurn = new Map<number, string>();
  const marked = events.some((e) => e.kind === "mark" && PLAY_MARK.test(e.name));
  let chatId: string | undefined;
  for (const e of events) {
    if (e.kind === "turn") {
      chatOfTurn.set(e.turn, e.chat.id);
      if (!marked) chatId = e.chat.id;
    } else if (e.kind === "mark") {
      const play = PLAY_MARK.exec(e.name);
      if (play?.[1] !== undefined) chatId = chatOfTurn.get(Number(play[1]));
    } else if (chatId !== undefined && (e.kind === "say" || e.kind === "emotion" || e.kind === "gesture" || e.kind === "scene")) {
      (out[chatId] ??= []).push(e);
    }
  }
  for (const [id, turn] of Object.entries(out)) out[id] = normalizeTurn(id, turn);
  return out;
}

/** C0's view of each turn: the first line, with the emotion (default neutral) and gesture set before it. */
export function repliesOf(events: readonly TimelineEvent[]): Record<string, EngineReply> {
  const out: Record<string, EngineReply> = {};
  for (const [id, turn] of Object.entries(performancesOf(events))) {
    const reply = replyOf(id, turn);
    if (reply !== undefined) out[id] = reply;
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
  const fixture: Pick<ControlFixture, "scenario" | "source" | "turns"> = {
    scenario: config.scenario,
    source: `run ${runId} (control ${config.control}${wire?.kind === "mark" ? `, ${wire.name}` : ""})`,
    turns: performancesOf(events),
  };
  const path = fixturePath(config.scenario);
  writeFileSync(path, `${JSON.stringify(fixtureFile(fixture), null, 2)}\n`);
  return path;
}
