// Rig.morph (companion-lanes requirement 1.2): the shape read of an undecoded `morph` (called by
// validateRig; every fault a `bad_shape` problem at its own path) and the checks against the read
// rig (`checkMorph`: the layer, unique ids, boxes on the canvas). Every problem is reported.
//
// Decisions the requirement leaves open:
// - Shape (`bad_shape`): `layer`, `atlas` strings (the layer-file rule for the files), `keys` an array
//   of 1..MORPH_MAX_KEYS keys, `eyes` two [x, y] pairs of finite numbers; per key an id matching
//   ^[a-z0-9_]+$, a known track, `at` in (0, 1], integer `bbox` and `cell` tuples with w, h > 0 and
//   x, y >= 0, `flowCell` (integers, as `cell`) only with `flowMax` in (0, 256] and with `flow`, and
//   `flowMax` only with `flowCell`, `backCell` (round 2; integers, as `cell`) only with `flowCell`; at most MORPH_MAX_STOPS keys on a track and no two at one stop
//   (the stop rule divides by the gap); `flow` only when some key has a `flowCell` (the wire rule:
//   a rig whose keys all lack motion has no flow); `sway` an object of a `map` file and `amp` in
//   (0, 0.05 x width].
// - Against the rig: `layer` names a visible `head` layer (`bad_shape` at `$.morph.layer`), a
//   repeated key id is `duplicate_name` at its `id`, a key `bbox` or an eye centre off the canvas
//   is `bbox_out_of_bounds` at its own path.
import { isMorphTrack, MORPH_MAX_KEYS, MORPH_MAX_STOPS, MORPH_TRACKS } from "./morph.js";
import type { MorphKey, MorphSway, Rig, RigMorph } from "./types.js";

export interface MorphProblem {
  path: string;
  message: string;
}

/** Why a file name is unusable, or undefined (validate.ts's rule for layer files). */
type FileRule = (file: string) => string | undefined;
type Box = [x: number, y: number, w: number, h: number];
type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const KEY_ID = /^[a-z0-9_]+$/;
/** `MorphSway.amp` at most this share of the rig's width. */
export const MORPH_SWAY_MAX = 0.05;
/** `MorphKey.flowMax` upper bound, canvas px. */
export const MORPH_FLOW_MAX = 256;

function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `a ${typeof value}`;
}

class MorphReader {
  readonly problems: MorphProblem[] = [];

  private readonly fileRule: FileRule;

  constructor(fileRule: FileRule) {
    this.fileRule = fileRule;
  }

  fail(path: string, message: string): undefined {
    this.problems.push({ path, message: `${path}: ${message}` });
    return undefined;
  }

  file(value: unknown, path: string): string | undefined {
    if (typeof value !== "string") return this.fail(path, `expected a file name, got ${describe(value)}`);
    const problem = this.fileRule(value);
    return problem === undefined ? value : this.fail(path, `${JSON.stringify(value)} ${problem}`);
  }

  /** An integer box with w, h > 0 and x, y >= 0. */
  box(value: unknown, path: string): Box | undefined {
    const items: unknown[] = Array.isArray(value) ? Array.from(value) : [];
    if (items.length !== 4 || !items.every((v) => Number.isInteger(v))) return this.fail(path, `expected a tuple of 4 integers, got ${describe(value)}`);
    const [x, y, w, h] = items as Box;
    if (x < 0 || y < 0 || w <= 0 || h <= 0) return this.fail(path, `expected x, y >= 0 and w, h > 0, got [${x}, ${y}, ${w}, ${h}]`);
    return [x, y, w, h];
  }

  key(value: unknown, path: string): MorphKey | undefined {
    if (!isRecord(value)) return this.fail(path, `expected a key object, got ${describe(value)}`);
    const before = this.problems.length;
    const { id, track, at, flowMax } = value;
    if (typeof id !== "string" || !KEY_ID.test(id)) this.fail(`${path}.id`, `expected an id matching ^[a-z0-9_]+$, got ${typeof id === "string" ? JSON.stringify(id) : describe(id)}`);
    if (!isMorphTrack(track)) this.fail(`${path}.track`, `${typeof track === "string" ? JSON.stringify(track) : describe(track)} is not a track (${MORPH_TRACKS.join(", ")})`);
    if (at !== undefined && !(isFiniteNumber(at) && at > 0 && at <= 1)) this.fail(`${path}.at`, `when present, expected a number in (0, 1], got ${describe(at)}`);
    const bbox = this.box(value.bbox, `${path}.bbox`);
    const cell = this.box(value.cell, `${path}.cell`);
    const flowCell = value.flowCell === undefined ? undefined : this.box(value.flowCell, `${path}.flowCell`);
    const backCell = value.backCell === undefined ? undefined : this.box(value.backCell, `${path}.backCell`);
    if (value.backCell !== undefined && value.flowCell === undefined) this.fail(`${path}.flowCell`, "required with backCell");
    if (flowMax !== undefined && !(isFiniteNumber(flowMax) && flowMax > 0 && flowMax <= MORPH_FLOW_MAX)) this.fail(`${path}.flowMax`, `when present, expected a number in (0, ${MORPH_FLOW_MAX}], got ${describe(flowMax)}`);
    if (value.flowCell !== undefined && flowMax === undefined) this.fail(`${path}.flowMax`, "required with flowCell");
    if (value.flowCell === undefined && flowMax !== undefined) this.fail(`${path}.flowCell`, "required with flowMax (omit both for a key without motion)");
    if (this.problems.length > before || typeof id !== "string" || !isMorphTrack(track) || bbox === undefined || cell === undefined) return undefined;
    const moving = flowCell !== undefined && isFiniteNumber(flowMax);
    return { id, track, ...(isFiniteNumber(at) ? { at } : {}), bbox, cell, ...(moving ? { flowCell, flowMax } : {}), ...(moving && backCell !== undefined ? { backCell } : {}) };
  }

  eyes(value: unknown, path: string): RigMorph["eyes"] | undefined {
    const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber);
    if (!Array.isArray(value) || value.length !== 2 || !pair(value[0]) || !pair(value[1])) return this.fail(path, `expected two [x, y] pairs of finite numbers, got ${describe(value)}`);
    return [[value[0][0], value[0][1]], [value[1][0], value[1][1]]];
  }

  sway(value: unknown, path: string, width: number | undefined): MorphSway | undefined {
    if (!isRecord(value)) return this.fail(path, `when present, expected a sway object { map, amp }, got ${describe(value)}`);
    const map = this.file(value.map, `${path}.map`);
    const max = width === undefined ? Infinity : MORPH_SWAY_MAX * width;
    const amp = value.amp;
    if (!(isFiniteNumber(amp) && amp > 0 && amp <= max)) return this.fail(`${path}.amp`, `expected a number in (0, ${width === undefined ? `${MORPH_SWAY_MAX} x width` : max}], got ${describe(amp)}`);
    return map === undefined ? undefined : { map, amp };
  }

  morph(value: unknown, path: string, width: number | undefined): RigMorph | undefined {
    if (!isRecord(value)) return this.fail(path, `when present, expected a morph object, got ${describe(value)}`);
    const layer = typeof value.layer === "string" && value.layer !== "" ? value.layer : this.fail(`${path}.layer`, `expected a layer name, got ${describe(value.layer)}`);
    const atlas = this.file(value.atlas, `${path}.atlas`);
    const flow = value.flow === undefined ? undefined : this.file(value.flow, `${path}.flow`);
    const eyes = this.eyes(value.eyes, `${path}.eyes`);
    const sway = value.sway === undefined ? undefined : this.sway(value.sway, `${path}.sway`, width);
    const raw = value.keys;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MORPH_MAX_KEYS) {
      return this.fail(`${path}.keys`, `expected 1..${MORPH_MAX_KEYS} keys, got ${Array.isArray(raw) ? `${raw.length} keys` : describe(raw)}`);
    }
    const items: unknown[] = Array.from(raw);
    const keys: MorphKey[] = [];
    items.forEach((item, i) => {
      const key = this.key(item, `${path}.keys[${i}]`);
      if (key !== undefined) keys.push(key);
    });
    if (keys.length !== items.length) return undefined;
    this.stops(keys, `${path}.keys`);
    const moving = keys.some((key) => key.flowCell !== undefined);
    if (moving && value.flow === undefined) this.fail(`${path}.flow`, "required when a key has a flowCell");
    if (!moving && value.flow !== undefined) this.fail(`${path}.flow`, "no key has a flowCell (omit flow when no key moves)");
    if (this.problems.length > 0 || layer === undefined || atlas === undefined || eyes === undefined) return undefined;
    return { layer, atlas, ...(flow === undefined ? {} : { flow }), keys, eyes, ...(sway === undefined ? {} : { sway }) };
  }

  /** At most MORPH_MAX_STOPS keys per track, and no two at one stop. */
  stops(keys: readonly MorphKey[], path: string): void {
    for (const track of MORPH_TRACKS) {
      const on = keys.flatMap((key, i) => (key.track === track ? [i] : []));
      if (on.length > MORPH_MAX_STOPS) this.fail(`${path}[${on[MORPH_MAX_STOPS] ?? 0}].track`, `${on.length} keys on track ${track}; at most ${MORPH_MAX_STOPS} stops`);
      const seen = new Map<number, number>();
      for (const i of on) {
        const at = keys[i]?.at ?? 1;
        const earlier = seen.get(at);
        if (earlier !== undefined) this.fail(`${path}[${i}].at`, `keys[${earlier}] is already the ${track} stop at ${at}`);
        seen.set(at, i);
      }
    }
  }
}

/** `Rig.morph` at `path`; absent is fine. `width` bounds the sway's reach. */
export function readMorph(value: unknown, path: string, width: number | undefined, fileRule: FileRule): { morph?: RigMorph; problems: MorphProblem[] } {
  if (value === undefined) return { problems: [] };
  const reader = new MorphReader(fileRule);
  const morph = reader.morph(value, path, width);
  return morph === undefined || reader.problems.length > 0 ? { problems: reader.problems } : { morph, problems: [] };
}

export interface MorphCheck {
  code: "bad_shape" | "duplicate_name" | "bbox_out_of_bounds";
  message: string;
  path: string;
  layer?: string;
}

/** The morph against its rig (module header); empty when the rig has none or it fits. */
export function checkMorph(rig: Rig): MorphCheck[] {
  const morph = rig.morph;
  if (morph === undefined) return [];
  const out: MorphCheck[] = [];
  const layer = rig.layers.find((l) => l.name === morph.layer);
  if (layer?.kind !== "head" || layer.visible === false) {
    const what = layer === undefined ? "is not a layer of this rig" : `is a ${layer.visible === false ? "hidden " : ""}${layer.kind} layer`;
    out.push({ code: "bad_shape", message: `$.morph.layer: ${JSON.stringify(morph.layer)} ${what}; expected a visible head layer`, path: "$.morph.layer" });
  }
  const ids = new Map<string, number>();
  morph.keys.forEach((key, i) => {
    const earlier = ids.get(key.id);
    if (earlier !== undefined) out.push({ code: "duplicate_name", message: `morph key "${key.id}" reuses the id of keys[${earlier}]`, path: `$.morph.keys[${i}].id`, layer: morph.layer });
    else ids.set(key.id, i);
    const [x, y, w, h] = key.bbox;
    if (x + w > rig.width || y + h > rig.height) {
      out.push({ code: "bbox_out_of_bounds", message: `morph key "${key.id}" bbox [${x}, ${y}, ${w}, ${h}] leaves the ${rig.width} x ${rig.height} canvas`, path: `$.morph.keys[${i}].bbox`, layer: morph.layer });
    }
  });
  morph.eyes.forEach(([x, y], i) => {
    if (x < 0 || y < 0 || x > rig.width || y > rig.height) out.push({ code: "bbox_out_of_bounds", message: `morph eye [${x}, ${y}] leaves the ${rig.width} x ${rig.height} canvas`, path: `$.morph.eyes[${i}]` });
  });
  return out;
}
