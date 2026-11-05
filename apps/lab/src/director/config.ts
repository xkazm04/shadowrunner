// RunConfig from `--config baseline|<json>`: "baseline" is BASELINE; anything else is inline JSON or
// a path to a JSON file holding a partial RunConfig whose arms override the baseline.
import { existsSync } from "node:fs";
import {
  BASELINE,
  type ControlArmId,
  type LipArmId,
  type OutputArmId,
  type RunConfig,
  type SceneArmId,
} from "../contract.js";
import { isFiniteNumber, isRecord, oneOf, parseJson, readJsonFile, type JsonRecord } from "./json.js";

export const CONTROL_IDS: readonly ControlArmId[] = ["C0", "C1", "C2"];
export const LIP_IDS: readonly LipArmId[] = ["L0", "L1", "L2"];
export const SCENE_IDS: readonly SceneArmId[] = ["S0", "S1"];
export const OUTPUT_IDS: readonly OutputArmId[] = ["O0", "O1"];

function pick<T extends string>(list: readonly T[], value: unknown, fallback: T, key: string): T {
  if (value === undefined) return fallback;
  if (oneOf(list, value)) return value;
  throw new Error(`config.${key} must be one of ${list.join(", ")} (got ${JSON.stringify(value)}).`);
}

function configSource(spec: string): JsonRecord {
  const trimmed = spec.trim();
  const value = trimmed.startsWith("{") ? parseJson(trimmed) : existsSync(trimmed) ? readJsonFile(trimmed) : undefined;
  if (value === undefined) throw new Error(`--config "${spec}" is neither "baseline", inline JSON, nor a JSON file that exists.`);
  if (!isRecord(value)) throw new Error(`--config must be a JSON object.`);
  return value;
}

/** Arms from `spec` over BASELINE, plus the scenario and seed of this run. */
export function resolveConfig(spec: string, scenario: string, seed: number): RunConfig {
  const fields: JsonRecord = spec === "baseline" ? {} : configSource(spec);
  if (fields.external !== undefined) throw new Error("External pipeline runs (config.external) start with `pnpm lab overlord`, not `pnpm lab run`.");
  const character = fields.character;
  if (character !== undefined && (typeof character !== "string" || character === "")) {
    throw new Error("config.character must be a non-empty pack id.");
  }
  return {
    control: pick(CONTROL_IDS, fields.control, BASELINE.control, "control"),
    lip: pick(LIP_IDS, fields.lip, BASELINE.lip, "lip"),
    scene: pick(SCENE_IDS, fields.scene, BASELINE.scene, "scene"),
    output: pick(OUTPUT_IDS, fields.output, BASELINE.output, "output"),
    scenario,
    ...(typeof character === "string" ? { character } : {}),
    seed,
  };
}

/** A RunConfig read back from a run's config.json. */
export function parseRunConfig(value: unknown): RunConfig {
  if (!isRecord(value)) throw new Error("config.json must be a JSON object.");
  const { scenario, seed, character, replayOf, external } = value;
  if (typeof scenario !== "string") throw new Error("config.json: scenario must be a string.");
  if (!isFiniteNumber(seed)) throw new Error("config.json: seed must be a number.");
  return {
    control: pick(CONTROL_IDS, value.control, BASELINE.control, "control"),
    lip: pick(LIP_IDS, value.lip, BASELINE.lip, "lip"),
    scene: pick(SCENE_IDS, value.scene, BASELINE.scene, "scene"),
    output: pick(OUTPUT_IDS, value.output, BASELINE.output, "output"),
    scenario,
    ...(typeof character === "string" ? { character } : {}),
    seed,
    ...(typeof replayOf === "string" ? { replayOf } : {}),
    ...(external === "overlord" ? { external } : {}),
  };
}

/** Short arm tag for run ids: C0L0S0O0. */
export function armTag(config: RunConfig): string {
  return `${config.control}${config.lip}${config.scene}${config.output}`;
}
