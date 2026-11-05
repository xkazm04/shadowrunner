// Scenarios (src/scenarios/<id>.json): a character, a persona and a timed chat.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage, Scenario } from "../contract.js";
import { isFiniteNumber, isRecord, readJsonFile } from "./json.js";
import { SCENARIOS_DIR } from "./paths.js";

const SCENARIO_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parseChat(value: unknown, at: string): ChatMessage {
  if (!isRecord(value)) throw new Error(`${at} must be an object.`);
  const { id, user, text, atMs } = value;
  if (typeof id !== "string" || id === "") throw new Error(`${at}.id must be a non-empty string.`);
  if (typeof user !== "string" || user === "") throw new Error(`${at}.user must be a non-empty string.`);
  if (typeof text !== "string" || text === "") throw new Error(`${at}.text must be a non-empty string.`);
  if (!isFiniteNumber(atMs) || atMs < 0) throw new Error(`${at}.atMs must be a number of milliseconds >= 0.`);
  return { id, user, text, atMs };
}

/** A checked Scenario; the first problem throws as a sentence. Chat is sorted by `atMs`. */
export function parseScenario(value: unknown, source = "scenario"): Scenario {
  if (!isRecord(value)) throw new Error(`${source} must be a JSON object.`);
  const { id, title, character, persona, seed, chat } = value;
  for (const [key, v] of Object.entries({ id, title, character, persona })) {
    if (typeof v !== "string" || v.trim() === "") throw new Error(`${source}: ${key} must be a non-empty string.`);
  }
  if (!isFiniteNumber(seed)) throw new Error(`${source}: seed must be a number.`);
  if (!Array.isArray(chat) || chat.length === 0) throw new Error(`${source}: chat must be a non-empty array.`);
  const messages = chat.map((m, i) => parseChat(m, `${source}: chat[${i}]`));
  const ids = new Set(messages.map((m) => m.id));
  if (ids.size !== messages.length) throw new Error(`${source}: chat ids must be unique.`);
  return {
    id: String(id),
    title: String(title),
    character: String(character),
    persona: String(persona),
    seed,
    chat: messages.sort((a, b) => a.atMs - b.atMs),
  };
}

export function scenarioPath(id: string): string {
  if (!SCENARIO_ID.test(id)) throw new Error(`"${id}" is not a scenario id (lowercase letters, digits, dashes).`);
  return join(SCENARIOS_DIR, `${id}.json`);
}

export function loadScenario(id: string): Scenario {
  const path = scenarioPath(id);
  if (!existsSync(path)) throw new Error(`Scenario "${id}" does not exist: expected ${path}.`);
  const scenario = parseScenario(readJsonFile(path), `${id}.json`);
  if (scenario.id !== id) throw new Error(`${id}.json declares id "${scenario.id}"; the file name and id must match.`);
  return scenario;
}
