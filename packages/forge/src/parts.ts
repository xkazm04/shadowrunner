// Part parsing (forge-pipeline requirement 3): the segmentation model's decoded JSON -> Part[].
// parseParts takes an already-decoded value; it never sees raw text and never JSON.parses.
// Anything off-contract is rejected with code `upstream`. Error messages name the JSON path and
// the rule broken, never the offending value, so no raw upstream text can leak through them.
import { type LayerKind, type Result, readMotion } from "@sr/rig";
import { followOf, headNameOf } from "./named.js";
import { PART_NAMES, type NamedPart, type Part, type PartName, type PartRole, type Polygon } from "./types.js";
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

/** cast-forge design.md "Named parts": every role a named part may have. */
export const PART_ROLES: readonly PartRole[] = [...PART_NAMES, "eye", "float", "pulse"];

/** cast-forge design.md `ROLE_KIND`: the v1 PART_KIND for the ten names, eye -> eye, float and pulse -> accessory. */
export const ROLE_KIND: Readonly<Record<PartRole, LayerKind>> = { ...PART_KIND, eye: "eye", float: "accessory", pulse: "accessory" };

/** A v2 file holds at most this many named parts (cast-forge design.md). */
export const MAX_NAMED_PARTS = 40;
/** A named part's name: becomes the layer name and its file name. */
export const PART_NAME_PATTERN = /^[a-z0-9_]{1,40}$/;
/** Names a part may not take: the assembled rig's own layers. */
export const RESERVED_PART_NAMES: readonly string[] = ["background"];
/** Named-part motion is in canvas px of a canvas this wide and high (cast-forge design.md). */
export const MOTION_CANVAS = 1024;

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
  /** v1: the parts. v2: the v1 view (`v1View`) of the named parts, for callers that know only v1. */
  parts: Part[];
  warnings: PartsWarning[];
  /** v2 only: the named parts, in file order (repeats dropped). */
  named?: NamedPart[];
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
  if (isRecord(json) && "version" in json) return parseNamed(json);
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

/** The first part of each v1 role, renamed to its role: what v1-only code (the palette) reads. */
export function v1View(named: readonly NamedPart[]): Part[] {
  const seen = new Set<string>();
  const out: Part[] = [];
  for (const p of named) {
    if (!isPartName(p.role) || seen.has(p.role)) continue;
    seen.add(p.role);
    out.push({ name: p.role, box_2d: p.box_2d, poly: p.poly });
  }
  return out;
}

const isRole = (value: unknown): value is PartRole => typeof value === "string" && (PART_ROLES as readonly string[]).includes(value);
const NAME_RULE = `must match ${PART_NAME_PATTERN.source} and not be ${RESERVED_PART_NAMES.join(", ")}`;

function namedPart(value: unknown, path: string, errors: PartsError[]): NamedPart | undefined {
  if (!isRecord(value)) {
    errors.push({ code: "upstream", path, message: "must be an object { name, role, box_2d, poly }" });
    return undefined;
  }
  const before = errors.length;
  const { name, role, follow, key } = value;
  const nameOk = typeof name === "string" && PART_NAME_PATTERN.test(name) && !RESERVED_PART_NAMES.includes(name);
  if (!nameOk) errors.push({ code: "upstream", path: `${path}.name`, message: NAME_RULE });
  if (!isRole(role)) errors.push({ code: "upstream", path: `${path}.role`, message: `must be one of ${PART_ROLES.join(", ")}` });
  const box2d = box(value.box_2d, `${path}.box_2d`, errors);
  const points = poly(value.poly, `${path}.poly`, errors);
  if (follow !== undefined && typeof follow !== "string") errors.push({ code: "upstream", path: `${path}.follow`, message: "must be a part name when present" });
  if (key !== undefined && typeof key !== "boolean") errors.push({ code: "upstream", path: `${path}.key`, message: "must be a boolean when present" });
  const motion = readMotion(value.motion, `${path}.motion`, { width: MOTION_CANVAS, height: MOTION_CANVAS });
  for (const problem of motion.problems) {
    errors.push({ code: "upstream", path: problem.path, message: "is out of range or the wrong shape (cast-forge design.md Motion)" });
  }
  if (errors.length > before || !nameOk || !isRole(role) || box2d === undefined || points === undefined) return undefined;
  return {
    name,
    role,
    box_2d: box2d,
    poly: points,
    ...(typeof follow === "string" ? { follow } : {}),
    ...(motion.motion === undefined ? {} : { motion: motion.motion }),
    ...(typeof key === "boolean" ? { key } : {}),
  };
}

/**
 * Unknown names, self-follows and cycles, each reported at the follower's path. A cycle may run
 * through a default follow (`followOf`): a second head-role part that follows a part which follows
 * the head by default.
 */
function checkFollows(named: readonly { part: NamedPart; at: number }[], errors: PartsError[]): void {
  const byName = new Map(named.map((n) => [n.part.name, n.part]));
  const head = headNameOf(named.map((n) => n.part));
  for (const { part, at } of named) {
    if (part.follow === undefined) continue;
    const path = `$.parts[${at}].follow`;
    if (!byName.has(part.follow) || part.follow === part.name) {
      errors.push({ code: "upstream", path, message: "must name another part of this file" });
      continue;
    }
    const seen = new Set([part.name]);
    const after = (p: NamedPart): NamedPart | undefined => {
      const next = followOf(p, head);
      return next === undefined ? undefined : byName.get(next);
    };
    for (let next = after(part); next !== undefined; next = after(next)) {
      if (seen.has(next.name)) {
        errors.push({ code: "upstream", path, message: "makes a follow cycle" });
        break;
      }
      seen.add(next.name);
    }
  }
}

/**
 * A v2 file `{ version: 2, parts: NamedPart[] }` (cast-forge design.md "Named parts"). Strict on
 * shape like v1, plus: names unique `[a-z0-9_]`, roles from PART_ROLES, `follow` naming another
 * part with no cycle, `motion` in the rig's ranges at a MOTION_CANVAS canvas, `key` boolean; a head
 * role is required. Lenient on count like v1: the first MAX_NAMED_PARTS are read and a repeated
 * name keeps its first occurrence, each with a warning.
 */
function parseNamed(json: Fields): Result<ParsedParts, PartsError[]> {
  if (json.version !== 2) return { ok: false, errors: [{ code: "upstream", path: "$.version", message: "must be 2 for a named-parts file" }] };
  const list = json.parts;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, errors: [{ code: "upstream", path: "$.parts", message: "must be a non-empty array of named parts" }] };
  }
  const warnings: PartsWarning[] = [];
  if (list.length > MAX_NAMED_PARTS) {
    warnings.push({ path: "$.parts", message: `has more than ${MAX_NAMED_PARTS} parts; kept the first ${MAX_NAMED_PARTS}` });
  }
  const errors: PartsError[] = [];
  const named: { part: NamedPart; at: number }[] = [];
  const firstAt = new Map<string, number>();
  list.slice(0, MAX_NAMED_PARTS).forEach((item: unknown, i) => {
    const parsed = namedPart(item, `$.parts[${i}]`, errors);
    if (parsed === undefined) return;
    const first = firstAt.get(parsed.name);
    if (first !== undefined) {
      warnings.push({ path: `$.parts[${i}].name`, message: `repeats part ${parsed.name}; kept the first at $.parts[${first}]` });
      return;
    }
    firstAt.set(parsed.name, i);
    named.push({ part: parsed, at: i });
  });
  if (errors.length === 0) checkFollows(named, errors);
  if (errors.length === 0 && !named.some((n) => n.part.role === "head")) {
    errors.push({ code: "upstream", path: "$.parts", message: "has no part with role head" });
  }
  if (errors.length > 0) return { ok: false, errors };
  const parts = named.map((n) => n.part);
  return { ok: true, value: { parts: v1View(parts), warnings, named: parts } };
}

/** Model polygon ([y, x], 0..1000) -> canvas pixels ([x, y]) for a width x height canvas. */
export function toCanvas(points: Part["poly"], width: number, height: number): Polygon {
  return points.map(([y, x]) => [(x * width) / COORD_MAX, (y * height) / COORD_MAX]);
}
