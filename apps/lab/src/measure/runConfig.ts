// A run's config.json as a RunConfig (parseRunConfig keeps `external` for an Overlord run).
import { join } from "node:path";
import type { RunConfig } from "../contract.js";
import { parseRunConfig } from "../director/config.js";
import { readJsonFile } from "../director/json.js";

export function readRunConfig(dir: string): RunConfig {
  return parseRunConfig(readJsonFile(join(dir, "config.json")));
}
