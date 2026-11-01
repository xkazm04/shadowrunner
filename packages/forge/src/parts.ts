// Part parsing (forge-pipeline requirement 3): the segmentation model's decoded JSON -> Part[].
// parseParts takes an already-decoded value; it never sees raw text and never JSON.parses.
// Anything off-contract is rejected with code `upstream`. Error messages name the JSON path and
// the rule broken, never the offending value, so no raw upstream text can leak through them.
import type { LayerKind, Result } from "@sr/rig";
import { PART_NAMES, type Part, type PartName, type Polygon } from "./types.js";
import type { ForgeErrorCode } from "./wire.js";

/** design.md "PART_KIND": which Rig layer kind each part becomes (requirement 3.4). */
export const PART_KIND: Readonly<Record<PartName, LayerKind>> = {
  head: "head",
  jaw: "jaw",
  eye_l: "eye",
  eye_r: "eye",
  monocle: "accessory",
  hat: "accessory",
  accessory: "accessory",
  crown: "crown",
  hair: "crown",
  torso: "body",
};

/** Model coordinates are integers in 0..COORD_MAX. */
export const COORD_MAX = 1000;
export const POLY_MIN_POINTS = 3;
export const POLY_MAX_POINTS = 60;

/** At most this many entries are read from the model's array (director ruling (b), task 2.2). */
export const MAX_PARTS = PART_NAMES.length;

export interface PartsError {
  code: Extract<ForgeErrorCode, "upstream">;
  /** JSON path of the offending value, e.g. `$[2].poly[5]`. */
  path: string;
  message: string;
}

/** A count problem that `parseParts` repaired instead of rejecting (ruling (b)). */
export interface PartsWarning {
  /** JSON path of the entry concerned: `$` for the cap, `$[i].name` for a repeat. */
  path: string;
  message: string;
}

export interface ParsedParts {
  parts: Part[];
  warnings: PartsWarning[];
}

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCoord = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= COORD_MAX;
const isPartName = (value: unknown): value is PartName =>
  typeof value === "string" && (PART_NAMES as readonly string[]).includes(value);

const COORD_RULE = `an integer in 0..${COORD_MAX}`;

function pair(value: unknown, path: string, errors: PartsError[]): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    errors.push({ code: "upstream", path, message: `must be a [y, x] pair of ${COORD_RULE}` });
    return undefined;
  }
  const [y, x] = value;
  if (!isCoord(y) || !isCoord(x)) {
    errors.push({ code: "upstream", path, message: `coordinates must each be ${COORD_RULE}` });
    return undefined;
  }
  return [y, x];
}

function box(value: unknown, path: string, errors: PartsError[]): Part["box_2d"] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    errors.push({ code: "upstream", path, message: "must be [ymin, xmin, ymax, xmax]" });
    return undefined;
  }
  const [ymin, xmin, ymax, xmax] = value;
  if (!isCoord(ymin) || !isCoord(xmin) || !isCoord(ymax) || !isCoord(xmax)) {
    errors.push({ code: "upstream", path, message: `values must each be ${COORD_RULE}` });
    return undefined;
  }
  if (ymin > ymax || xmin > xmax) {
    errors.push({ code: "upstream", path, message: "min must not exceed max" });
    return undefined;
  }
  return [ymin, xmin, ymax, xmax];
}

function poly(value: unknown, path: string, errors: PartsError[]): Part["poly"] | undefined {
  if (!Array.isArray(value) || value.length < POLY_MIN_POINTS || value.length > POLY_MAX_POINTS) {
    errors.push({ code: "upstream", path, message: `must be an array of ${POLY_MIN_POINTS}..${POLY_MAX_POINTS} points` });
    return undefined;
  }
  const before = errors.length;
  const points = value.map((point: unknown, i) => pair(point, `${path}[${i}]`, errors));
  if (errors.length > before) return undefined;
  return points.filter((p): p is [number, number] => p !== undefined);
}

function part(value: unknown, path: string, errors: PartsError[]): Part | undefined {
  if (!isRecord(value)) {
    errors.push({ code: "upstream", path, message: "must be an object { name, box_2d, poly }" });
    return undefined;
  }
  const before = errors.length;
  if (!isPartName(value.name)) {
    errors.push({ code: "upstream", path: `${path}.name`, message: `must be one of ${PART_NAMES.join(", ")}` });
  }
  const box2d = box(value.box_2d, `${path}.box_2d`, errors);
  const points = poly(value.poly, `${path}.poly`, errors);
  if (errors.length > before || !isPartName(value.name) || box2d === undefined || points === undefined) return undefined;
  // A fresh object with the contract fields only; extra keys from the model are dropped.
  return { name: value.name, box_2d: box2d, poly: points };
}

/**
 * Decoded model JSON -> parts (requirements 3.2, 3.3; director ruling (b)).
 * Strict on shape: the value must be an array; every entry read must be `{ name, box_2d, poly }`
 * with a name from the closed list, an integer `box_2d` (min <= max) and a 3..60 point `poly`,
 * all coordinates in 0..1000; `head` must be present. Every shape problem is reported with code
 * `upstream` and nothing is returned.
 * Lenient on count: only the first MAX_PARTS entries are read (the rest are not inspected), and a
 * repeated name keeps its first occurrence. Each repair adds a warning.
 */
export function parseParts(json: unknown): Result<ParsedParts, PartsError[]> {
  if (!Array.isArray(json)) {
    return { ok: false, errors: [{ code: "upstream", path: "$", message: "must be an array of parts" }] };
  }
  const warnings: PartsWarning[] = [];
  if (json.length > MAX_PARTS) {
    warnings.push({ path: "$", message: `has more than ${MAX_PARTS} parts; kept the first ${MAX_PARTS}` });
  }
  const errors: PartsError[] = [];
  const parts: Part[] = [];
  const firstAt = new Map<PartName, number>();
  json.slice(0, MAX_PARTS).forEach((item: unknown, i) => {
    const parsed = part(item, `$[${i}]`, errors);
    if (parsed === undefined) return;
    const first = firstAt.get(parsed.name);
    if (first !== undefined) {
      warnings.push({ path: `$[${i}].name`, message: `repeats part ${parsed.name}; kept the first at $[${first}]` });
      return;
    }
    firstAt.set(parsed.name, i);
    parts.push(parsed);
  });
  if (errors.length === 0 && !firstAt.has("head")) {
    errors.push({ code: "upstream", path: "$", message: "has no head part" });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { parts, warnings } };
}

/** Model polygon ([y, x], 0..1000) -> canvas pixels ([x, y]) for a width x height canvas. */
export function toCanvas(points: Part["poly"], width: number, height: number): Polygon {
  return points.map(([y, x]) => [(x * width) / COORD_MAX, (y * height) / COORD_MAX]);
}
