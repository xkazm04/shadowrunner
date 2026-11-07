// Character-control checks (.kiro/specs/character-control/design.md "Wire types"): the shape of
// `Layer.variants` and `Layer.regions` on an undecoded value (called by validateRig, every problem
// a `bad_shape` error at its own path), and `validateLookControls`, the check of a saved look's
// `regions` and `shape` the web library runs on read. Every problem is reported.
// A patch bbox inside the canvas and a slot's "#rrggbb" are validateRig's semantic checks
// (`bbox_out_of_bounds`, `bad_color`), as for the layer's own bbox and the palette.
import { ACT_KINDS, readAct } from "./act.js";
import { EXPRESSION_FAMILIES, MAX_REGION_SLOTS, SHAPE_LIMITS } from "./control.js";
import type { ExpressionFamily, LayerAct, LayerPatch, LayerRegions, PartShape, Rig, RegionSlot } from "./types.js";

export interface ControlProblem {
  path: string;
  message: string;
}

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const SLOT_ID = /^[a-z0-9_]+$/;
const HEX = /^#[0-9a-f]{6}$/i;
const PATCH_MODES: readonly LayerPatch["mode"][] = ["over", "replace"];
const isFamily = (key: string): key is ExpressionFamily => (EXPRESSION_FAMILIES as readonly string[]).includes(key);

function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `a ${typeof value}`;
}

/** Why a file name is unusable, or undefined (validate.ts's rule for layer files). */
export type FileRule = (file: string) => string | undefined;

class ControlReader {
  readonly problems: ControlProblem[] = [];

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

  bbox(value: unknown, path: string): LayerPatch["bbox"] | undefined {
    const items: unknown[] = Array.isArray(value) ? Array.from(value) : [];
    if (items.length !== 4 || !items.every(isFiniteNumber)) return this.fail(path, `expected a tuple of 4 finite numbers, got ${describe(value)}`);
    const [x, y, w, h] = items as [number, number, number, number];
    if (w <= 0) this.fail(`${path}[2]`, `width must be > 0, got ${w}`);
    if (h <= 0) this.fail(`${path}[3]`, `height must be > 0, got ${h}`);
    return w > 0 && h > 0 ? [x, y, w, h] : undefined;
  }

  patch(value: unknown, path: string): LayerPatch | undefined {
    if (!isRecord(value)) return this.fail(path, `expected a patch object, got ${describe(value)}`);
    const file = this.file(value.file, `${path}.file`);
    const bbox = this.bbox(value.bbox, `${path}.bbox`);
    const mode = PATCH_MODES.find((m) => m === value.mode);
    if (mode === undefined) this.fail(`${path}.mode`, `expected "over" or "replace", got ${describe(value.mode)}`);
    // face-control: an eye patch's own lid opening and its narrowed flag.
    const socket = value.socket === undefined ? undefined : this.file(value.socket, `${path}.socket`);
    if (value.narrowed !== undefined && value.narrowed !== true) this.fail(`${path}.narrowed`, `expected true (omit the field otherwise), got ${describe(value.narrowed)}`);
    if (file === undefined || bbox === undefined || mode === undefined) return undefined;
    return { file, bbox, mode, ...(socket === undefined ? {} : { socket }), ...(value.narrowed === true ? { narrowed: true as const } : {}) };
  }

  variants(value: unknown, path: string): Partial<Record<ExpressionFamily, LayerPatch>> | undefined {
    if (!isRecord(value)) return this.fail(path, `when present, expected an object of family -> patch, got ${describe(value)}`);
    const out: Partial<Record<ExpressionFamily, LayerPatch>> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!isFamily(key)) {
        this.fail(`${path}.${key}`, `${JSON.stringify(key)} is not an expression family (${EXPRESSION_FAMILIES.join(", ")})`);
        continue;
      }
      const patch = this.patch(item, `${path}.${key}`);
      if (patch !== undefined) out[key] = patch;
    }
    return out;
  }

  slot(value: unknown, path: string, seen: Set<string>): RegionSlot | undefined {
    if (!isRecord(value)) return this.fail(path, `expected a slot object, got ${describe(value)}`);
    const { id, name, hex } = value;
    let okId = typeof id === "string" && SLOT_ID.test(id);
    if (!okId) this.fail(`${path}.id`, `expected an id matching ^[a-z0-9_]+$, got ${typeof id === "string" ? JSON.stringify(id) : describe(id)}`);
    if (typeof id === "string" && okId && seen.has(id)) {
      this.fail(`${path}.id`, `${JSON.stringify(id)} is already a slot of this layer`);
      okId = false;
    }
    if (typeof id === "string") seen.add(id);
    if (typeof name !== "string" || name === "") this.fail(`${path}.name`, `expected a non-empty string, got ${describe(name)}`);
    if (typeof hex !== "string") this.fail(`${path}.hex`, `expected a "#rrggbb" string, got ${describe(hex)}`);
    if (!okId || typeof id !== "string" || typeof name !== "string" || name === "" || typeof hex !== "string") return undefined;
    return { id, name, hex };
  }

  regions(value: unknown, path: string): LayerRegions | undefined {
    if (!isRecord(value)) return this.fail(path, `when present, expected a regions object, got ${describe(value)}`);
    const map = this.file(value.map, `${path}.map`);
    const raw = value.slots;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_REGION_SLOTS) {
      const count = Array.isArray(raw) ? `${raw.length} slots` : describe(raw);
      return this.fail(`${path}.slots`, `expected 1..${MAX_REGION_SLOTS} slots, got ${count}`);
    }
    const items: unknown[] = Array.from(raw);
    const seen = new Set<string>();
    const slots: RegionSlot[] = [];
    items.forEach((item, j) => {
      const slot = this.slot(item, `${path}.slots[${j}]`, seen);
      if (slot !== undefined) slots.push(slot);
    });
    return map === undefined || slots.length !== items.length ? undefined : { map, slots };
  }
}

export interface ControlRead {
  variants?: Partial<Record<ExpressionFamily, LayerPatch>>;
  regions?: LayerRegions;
  /** Eye layers (face-control): the lid-opening mask and the closed-lid art. */
  socket?: string;
  closed?: string;
  /** Eye and iris layers (cast-face-pass): false = not tinted by the palette's eye colour. */
  tint?: false;
  /** tiger L1: read leniently (`readAct`), dropped on a kind that may not carry one; never a problem. */
  act?: LayerAct;
  problems: ControlProblem[];
}

/** A layer's `variants` and `regions` at `path` (the layer's path, e.g. `$.layers[3]`); absent is fine. */
export function readLayerControls(layer: Fields, path: string, fileRule: FileRule): ControlRead {
  const reader = new ControlReader(fileRule);
  const variants = layer.variants === undefined ? undefined : reader.variants(layer.variants, `${path}.variants`);
  const regions = layer.regions === undefined ? undefined : reader.regions(layer.regions, `${path}.regions`);
  const socket = layer.socket === undefined ? undefined : reader.file(layer.socket, `${path}.socket`);
  const closed = layer.closed === undefined ? undefined : reader.file(layer.closed, `${path}.closed`);
  if ((socket !== undefined || closed !== undefined) && layer.kind !== "eye") reader.fail(`${path}.${socket !== undefined ? "socket" : "closed"}`, `only an eye layer has a socket or closed art, this one is ${describe(layer.kind)}`);
  if (layer.tint !== undefined && layer.tint !== false) reader.fail(`${path}.tint`, `expected false (omit the field otherwise), got ${describe(layer.tint)}`);
  else if (layer.tint === false && layer.kind !== "eye" && layer.kind !== "iris") reader.fail(`${path}.tint`, `only an eye or iris layer has tint, this one is ${describe(layer.kind)}`);
  if (reader.problems.length > 0) return { problems: reader.problems };
  const act = ACT_KINDS.some((kind) => kind === layer.kind) ? readAct(layer.act) : undefined;
  return {
    ...(act === undefined ? {} : { act }),
    ...(variants === undefined ? {} : { variants }),
    ...(regions === undefined ? {} : { regions }),
    ...(socket === undefined ? {} : { socket }),
    ...(closed === undefined ? {} : { closed }),
    ...(layer.tint === false ? { tint: false as const } : {}),
    problems: [],
  };
}

const SHAPE_KEYS = Object.keys(SHAPE_LIMITS) as (keyof PartShape)[];
const REGION_KEY = /^([a-z0-9_]+)\/([a-z0-9_]+)$/;
const LAYER_NAME = /^[a-z0-9_]+$/;

function checkRegions(value: unknown, rig: Rig | undefined, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`regions: when present, expected an object of "layer/slot" -> "#rrggbb", got ${describe(value)}`);
    return;
  }
  for (const [key, hex] of Object.entries(value)) {
    const at = `regions[${JSON.stringify(key)}]`;
    const m = REGION_KEY.exec(key);
    if (m === null) errors.push(`${at}: key must be "layer/slot" ([a-z0-9_]+/[a-z0-9_]+)`);
    else if (rig !== undefined) {
      const layer = rig.layers.find((l) => l.name === m[1]);
      if (layer === undefined) errors.push(`${at}: no layer ${JSON.stringify(m[1])} in this rig`);
      else if (!(layer.regions?.slots ?? []).some((s) => s.id === m[2])) errors.push(`${at}: layer ${JSON.stringify(m[1])} has no region slot ${JSON.stringify(m[2])}`);
    }
    if (typeof hex !== "string" || !HEX.test(hex)) errors.push(`${at}: expected a "#rrggbb" string, got ${typeof hex === "string" ? JSON.stringify(hex) : describe(hex)}`);
  }
}

function checkShape(value: unknown, rig: Rig | undefined, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`shape: when present, expected an object of layer -> part shape, got ${describe(value)}`);
    return;
  }
  for (const [name, item] of Object.entries(value)) {
    const at = `shape.${name}`;
    if (!LAYER_NAME.test(name)) errors.push(`${at}: layer name must match ^[a-z0-9_]+$`);
    else if (rig !== undefined && !rig.layers.some((l) => l.name === name)) errors.push(`${at}: no layer ${JSON.stringify(name)} in this rig`);
    if (!isRecord(item)) {
      errors.push(`${at}: expected a part shape object, got ${describe(item)}`);
      continue;
    }
    for (const key of SHAPE_KEYS) {
      const v = item[key];
      const [lo, hi] = SHAPE_LIMITS[key];
      if (!isFiniteNumber(v) || v < lo || v > hi) errors.push(`${at}.${key}: expected a number in [${lo}, ${hi}], got ${describe(v)}`);
    }
  }
}

/**
 * Every problem with a decoded look's `regions` (keys `layer/slot`, values "#rrggbb") and `shape`
 * (layer -> six finite numbers within SHAPE_LIMITS). With `rig`, keys must name its layers and
 * slots. Other look fields are not checked here. Empty when both are absent or valid.
 */
export function validateLookControls(look: unknown, rig?: Rig): string[] {
  if (!isRecord(look)) return [`look: expected an object, got ${describe(look)}`];
  const errors: string[] = [];
  if (look.regions !== undefined) checkRegions(look.regions, rig, errors);
  if (look.shape !== undefined) checkShape(look.shape, rig, errors);
  return errors;
}
