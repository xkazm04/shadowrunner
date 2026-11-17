// The read kernel of @sr/rig (challenge-2026-11-17 rig/A): the one place the shape readers' shared
// pieces live. Every reader of undecoded data (validateRig, the motion, control, morph, mouth and
// face readers, readLook, readAct, the legacy import) uses these guards, words and `Reader`, so a
// problem reads the same everywhere: `{ path, message }` with the message prefixed `<path>: `.
// validateRig turns problems into `bad_shape` errors as they are, never re-cutting the message.

/** One shape fault of a read: where (a JSON path) and why (prefixed with the path). */
export interface Problem {
  path: string;
  message: string;
  /** The layer the fault belongs to, when validateRig reads one. */
  layer?: string;
}

/** A section read: the value when it is good (a fresh object of contract fields), and every fault. */
export interface SectionRead<T> {
  value?: T;
  problems: Problem[];
}

export type Fields = Record<string, unknown>;
export type Guard<T> = (value: unknown) => value is T;
/** Why a file name is unusable, or undefined (the layer-file rule, `fileProblem`). */
export type FileRule = (file: string) => string | undefined;

export const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
export const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A value as a fault message names it: missing, null, an array, the number or boolean, or `a <type>`. */
export function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `a ${typeof value}`;
}

/** `missing; expected <x>` or `expected <x>, got <value>`. */
export const got = (value: unknown, expected: string): string => (value === undefined ? `missing; expected ${expected}` : `expected ${expected}, got ${describe(value)}`);

/** design.md: a layer file may be a "data:" URL from the forge; only PNG and (asset-webp amendment) WebP ones are accepted. */
const DATA_URL_PREFIXES: readonly string[] = ["data:image/png;base64,", "data:image/webp;base64,"];

/**
 * Why `file` is not a relative POSIX path inside the rig folder (or a non-empty PNG or WebP data: URL),
 * or undefined when it is.
 */
export function fileProblem(file: string): string | undefined {
  const prefix = DATA_URL_PREFIXES.find((p) => file.startsWith(p));
  if (prefix !== undefined) return file.length > prefix.length ? undefined : "is an empty data: URL";
  if (file === "") return "must not be empty";

  if (file.startsWith("/")) return "must be relative (no leading /)";
  if (file.includes("\\")) return "must use / separators (no backslash)";
  if (file.includes(":")) return "must not carry a scheme or drive (no :)";
  const segments = file.split("/");
  if (segments.includes("")) return "must not have an empty path segment (no // or trailing /)";
  if (segments.includes("..")) return "must stay inside the rig folder (no .. segment)";
  return undefined;
}

/** Collects problems while reading one undecoded value. */
export class Reader {
  readonly problems: Problem[] = [];

  private readonly fileRule: FileRule;

  constructor(fileRule: FileRule = fileProblem) {
    this.fileRule = fileRule;
  }

  fail(path: string, message: string, layer?: string): undefined {
    this.problems.push({ path, message: `${path}: ${message}`, ...(layer === undefined ? {} : { layer }) });
    return undefined;
  }

  /** A sub-reader's problems, as they are (tagged with `layer` when given). */
  report(problems: readonly Problem[], layer?: string): void {
    for (const problem of problems) this.problems.push(layer === undefined ? problem : { ...problem, layer });
  }

  required<T>(fields: Fields, key: string, path: string, guard: Guard<T>, expected: string, layer?: string): T | undefined {
    const value = fields[key];
    return guard(value) ? value : this.fail(`${path}.${key}`, got(value, expected), layer);
  }

  /** Absent (or undefined) is fine; present with any value `guard` rejects is not. */
  optional<T>(fields: Fields, key: string, path: string, guard: Guard<T>, expected: string, layer?: string): T | undefined {
    const value = fields[key];
    if (value === undefined || guard(value)) return value;
    return this.fail(`${path}.${key}`, `when present, ${got(value, expected)}`, layer);
  }

  /** A finite number in [lo, hi] (or [lo, hi) when `open`); `hi` undefined means no upper bound. */
  number(value: unknown, path: string, lo: number, hi: number | undefined, open = false): number | undefined {
    const range = hi === undefined ? `>= ${lo}` : `in [${lo}, ${hi}${open ? ")" : "]"}`;
    if (!isFiniteNumber(value)) return this.fail(path, `expected a number ${range}, got ${describe(value)}`);
    const above = hi !== undefined && (open ? value >= hi : value > hi);
    if (value < lo || above) return this.fail(path, `expected a number ${range}, got ${value}`);
    return value;
  }

  /** A file name the file rule accepts. */
  file(value: unknown, path: string): string | undefined {
    if (typeof value !== "string") return this.fail(path, `expected a file name, got ${describe(value)}`);
    const problem = this.fileRule(value);
    return problem === undefined ? value : this.fail(path, `${JSON.stringify(value)} ${problem}`);
  }
}

/** `{ value, problems: [] }` when there is a value and no fault, else `{ problems }`. */
export const sectionRead = <T>(value: T | undefined, problems: Problem[]): SectionRead<T> =>
  value === undefined || problems.length > 0 ? { problems } : { value, problems: [] };
