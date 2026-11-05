// Narrowing helpers for JSON read from disk, the CLI and the page: validate, never cast.
import { readFileSync } from "node:fs";

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads a JSON file; a missing or unreadable file throws a sentence naming it. */
export function readJsonFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} could not be read.`);
  }
  const value = parseJson(text);
  if (value === undefined) throw new Error(`${path} is not valid JSON.`);
  return value;
}

export function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && list.some((item) => item === value);
}
