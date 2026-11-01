// The only place @sr/theme parses JSON (tech.md). Each parser takes file text plus its source
// path, checks the shape, and throws an Error naming the file and the offending entry.
import type { Ramp, Scales, ThemeMap } from "./tokens.ts";

/** Role names become `--sr-<role>`, so they must be plain CSS identifiers. */
const ROLE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RAMP = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STEP = /^[a-z0-9]+$/;
const REF = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z0-9]+$/;
/** Raw values are written into CSS verbatim: nothing that could end a declaration or a block. */
const VALUE = /^[^;{}<>\\\r\n]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: not valid JSON (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
}

/** roles.json: a non-empty array of unique role names. */
export function parseRoles(text: string, source: string): string[] {
  const data = parseJson(text, source);
  if (!Array.isArray(data) || data.length === 0) throw new Error(`${source}: expected a non-empty array of role names`);
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const role of data) {
    if (typeof role !== "string" || !ROLE.test(role)) throw new Error(`${source}: ${JSON.stringify(role)} is not a role name`);
    if (seen.has(role)) throw new Error(`${source}: role "${role}" is listed twice`);
    seen.add(role);
    roles.push(role);
  }
  return roles;
}

/** scales/*.json: `{ "<ramp>": { "<step>": "<raw value>" } }`. */
export function parseScale(text: string, source: string): Scales {
  const data = parseJson(text, source);
  if (!isRecord(data)) throw new Error(`${source}: expected an object of ramps`);
  const ramps: [string, Ramp][] = [];
  for (const [name, steps] of Object.entries(data)) {
    if (!RAMP.test(name)) throw new Error(`${source}: "${name}" is not a ramp name`);
    if (!isRecord(steps)) throw new Error(`${source}: ramp "${name}" must be an object of steps`);
    const entries: [string, string][] = [];
    for (const [step, value] of Object.entries(steps)) {
      if (!STEP.test(step)) throw new Error(`${source}: "${name}.${step}" is not a step name`);
      if (typeof value !== "string" || !VALUE.test(value.trim())) {
        throw new Error(`${source}: "${name}.${step}" must be a non-empty CSS value without ; { } < > or \\`);
      }
      entries.push([step, value.trim()]);
    }
    ramps.push([name, Object.fromEntries(entries)]);
  }
  return Object.fromEntries(ramps);
}

/** themes/*.json: `{ "<role>": "<ramp>.<step>" }`. Role membership is checked by resolveTheme. */
export function parseTheme(text: string, source: string): ThemeMap {
  const data = parseJson(text, source);
  if (!isRecord(data)) throw new Error(`${source}: expected an object of role -> scale reference`);
  const entries: [string, string][] = [];
  for (const [role, ref] of Object.entries(data)) {
    if (!ROLE.test(role)) throw new Error(`${source}: "${role}" is not a role name`);
    if (typeof ref !== "string" || !REF.test(ref)) {
      throw new Error(`${source}: role "${role}" must map to a scale reference "<ramp>.<step>"`);
    }
    entries.push([role, ref]);
  }
  return Object.fromEntries(entries);
}
