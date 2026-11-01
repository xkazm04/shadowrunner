// validateRig (rig-core req 2): the only place @sr/rig checks external rig data (tech.md).
// It takes an already-decoded JSON value. Shape is checked first (`bad_shape`, naming the JSON
// path); the semantic checks run only on shape-valid input. Every error found is collected.
// The returned Rig is a fresh object holding only contract fields.
import type { Result } from "./result.js";
import { RIG_VERSION, type Layer, type LayerKind, type Palette, type Rig } from "./types.js";

export const RIG_ERROR_CODES = [
  "bbox_out_of_bounds",
  "duplicate_name",
  "duplicate_z",
  "bad_follow",
  "bad_color",
  "bad_shape",
] as const;
export type RigErrorCode = (typeof RIG_ERROR_CODES)[number];

export interface RigError {
  code: RigErrorCode;
  message: string;
  /** Name of the offending layer, when the error belongs to one. */
  layer?: string;
  /** JSON path of the offending value, e.g. `$.layers[2].bbox`. */
  path?: string;
}

const LAYER_KINDS: Record<LayerKind, true> = {
  static: true,
  body: true,
  head: true,
  jaw: true,
  eye: true,
  accessory: true,
  crown: true,
};
const SOURCES: Record<Rig["source"], true> = { forge: true, replay: true, import: true };
const LAYER_NAME = /^[a-z0-9_]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type Guard<T> = (value: unknown) => value is T;
type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isFinite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isInteger = (value: unknown): value is number => Number.isInteger(value);
const isVersion = (value: unknown): value is typeof RIG_VERSION => value === RIG_VERSION;
const isSource = (value: unknown): value is Rig["source"] => typeof value === "string" && Object.hasOwn(SOURCES, value);
const isKind = (value: unknown): value is LayerKind => typeof value === "string" && Object.hasOwn(LAYER_KINDS, value);
const isTrue = (value: unknown): value is true => value === true;
const isFalse = (value: unknown): value is false => value === false;
const isDepth = (value: unknown): value is number => isFinite(value) && value >= 0 && value <= 1;

function got(value: unknown, expected: string): string {
  if (value === undefined) return `missing; expected ${expected}`;
  let actual = `a ${typeof value}`;
  if (value === null) actual = "null";
  else if (Array.isArray(value)) actual = "an array";
  else if (typeof value === "number" || typeof value === "boolean") actual = String(value);
  return `expected ${expected}, got ${actual}`;
}

/** Collects bad_shape errors while reading one decoded value. */
class Reader {
  readonly errors: RigError[] = [];

  fail(path: string, message: string, layer?: string): undefined {
    this.errors.push({ code: "bad_shape", message: `${path}: ${message}`, path, ...(layer === undefined ? {} : { layer }) });
    return undefined;
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

  tuple(fields: Fields, key: string, path: string, length: 2 | 4, layer: string | undefined): number[] | undefined {
    const value = fields[key];
    if (Array.isArray(value) && value.length === length) {
      const items: unknown[] = Array.from(value);
      if (items.every(isFinite)) return items;
    }
    return this.fail(`${path}.${key}`, got(value, `a tuple of ${length} finite numbers`), layer);
  }

  palette(value: unknown, path: string): Palette | undefined {
    if (!isRecord(value)) return this.fail(path, got(value, "an object"));
    const colour = "a \"#rrggbb\" string";
    const glow = this.required(value, "glow", path, isString, colour);
    const eye = this.required(value, "eye", path, isString, colour);
    const rim = this.required(value, "rim", path, isString, colour);
    const mouth = this.required(value, "mouth", path, isString, colour);
    if (glow === undefined || eye === undefined || rim === undefined || mouth === undefined) return undefined;
    return { glow, eye, rim, mouth };
  }

  layer(value: unknown, path: string): Layer | undefined {
    if (!isRecord(value)) return this.fail(path, got(value, "a layer object"));
    const before = this.errors.length;
    const raw = value.name;
    const named = typeof raw === "string" ? raw : undefined;
    const name = this.required(value, "name", path, isString, "a string", named);
    if (name !== undefined && !LAYER_NAME.test(name)) this.fail(`${path}.name`, `${JSON.stringify(name)} must match ^[a-z0-9_]+$`, named);
    const z = this.required(value, "z", path, isInteger, "an integer", named);
    const kind = this.required(value, "kind", path, isKind, `one of ${Object.keys(LAYER_KINDS).join(", ")}`, named);
    const file = this.required(value, "file", path, isString, "a string", named);
    const bbox = this.tuple(value, "bbox", path, 4, named);
    const [x, y, w, h] = bbox ?? [];
    if (w !== undefined && w <= 0) this.fail(`${path}.bbox[2]`, `width must be > 0, got ${w}`, named);
    if (h !== undefined && h <= 0) this.fail(`${path}.bbox[3]`, `height must be > 0, got ${h}`, named);
    const [ax, ay] = this.tuple(value, "anchor", path, 2, named) ?? [];
    const follow = this.optional(value, "follow", path, isString, "a layer name", named);
    const depth = this.optional(value, "depth", path, isDepth, "a number in [0, 1]", named);
    const visible = this.optional(value, "visible", path, isFalse, "false (omit the field when visible)", named);
    if (this.errors.length > before) return undefined;
    if (name === undefined || z === undefined || kind === undefined || file === undefined) return undefined;
    if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
    if (ax === undefined || ay === undefined) return undefined;
    return {
      name,
      z,
      kind,
      file,
      bbox: [x, y, w, h],
      anchor: [ax, ay],
      ...(follow === undefined ? {} : { follow }),
      ...(depth === undefined ? {} : { depth }),
      ...(visible === undefined ? {} : { visible }),
    };
  }

  layers(value: unknown, path: string): Layer[] | undefined {
    if (!Array.isArray(value)) {
      return this.fail(path, got(value, "an array of layers"));
    }
    const items: unknown[] = value;
    const layers: Layer[] = [];
    // A plain loop, not .map: holes in a sparse array must be visited and reported.
    for (let i = 0; i < items.length; i += 1) {
      const layer = this.layer(items[i], `${path}[${i}]`);
      if (layer !== undefined) layers.push(layer);
    }
    return layers.length === items.length ? layers : undefined;
  }

  rig(value: unknown): Rig | undefined {
    if (!isRecord(value)) return this.fail("$", got(value, "a rig object"));
    const before = this.errors.length;
    const version = this.required(value, "version", "$", isVersion, `${RIG_VERSION}`);
    const id = this.required(value, "id", "$", isString, "a string");
    const name = this.required(value, "name", "$", isString, "a string");
    const width = this.required(value, "width", "$", isFinite, "a finite number");
    const height = this.required(value, "height", "$", isFinite, "a finite number");
    const source = this.required(value, "source", "$", isSource, `one of ${Object.keys(SOURCES).join(", ")}`);
    const fictional = this.optional(value, "fictional", "$", isTrue, "true (omit the field when not fictional)");
    const palette = this.palette(value.palette, "$.palette");
    const layers = this.layers(value.layers, "$.layers");
    if (this.errors.length > before) return undefined;
    if (version === undefined || id === undefined || name === undefined || width === undefined || height === undefined) return undefined;
    if (source === undefined || palette === undefined || layers === undefined) return undefined;
    return { version, id, name, width, height, source, ...(fictional === undefined ? {} : { fictional }), palette, layers };
  }
}

function checkPalette(palette: Palette, errors: RigError[]): void {
  for (const [key, value] of Object.entries(palette)) {
    if (!HEX_COLOR.test(value)) {
      errors.push({ code: "bad_color", message: `palette.${key} is ${JSON.stringify(value)}; expected "#rrggbb"`, path: `$.palette.${key}` });
    }
  }
}

function checkBounds(rig: Rig, errors: RigError[]): void {
  rig.layers.forEach((layer, i) => {
    const [x, y, w, h] = layer.bbox;
    if (x < 0 || y < 0 || x + w > rig.width || y + h > rig.height) {
      errors.push({
        code: "bbox_out_of_bounds",
        message: `layer "${layer.name}" bbox [${x}, ${y}, ${w}, ${h}] leaves the ${rig.width} x ${rig.height} canvas`,
        layer: layer.name,
        path: `$.layers[${i}].bbox`,
      });
    }
  });
}

function checkUnique(rig: Rig, field: "name" | "z", code: "duplicate_name" | "duplicate_z", errors: RigError[]): void {
  const first = new Map<string | number, number>();
  rig.layers.forEach((layer, i) => {
    const value = layer[field];
    const earlier = first.get(value);
    if (earlier === undefined) {
      first.set(value, i);
      return;
    }
    errors.push({
      code,
      message: `layer "${layer.name}" reuses ${field} ${JSON.stringify(value)} of layers[${earlier}]`,
      layer: layer.name,
      path: `$.layers[${i}].${field}`,
    });
  });
}

/** Missing parents, then every layer that lies on a follow cycle (including following itself). */
function checkFollows(rig: Rig, errors: RigError[]): void {
  const index = new Map<string, number>();
  rig.layers.forEach((layer, i) => {
    if (!index.has(layer.name)) index.set(layer.name, i);
  });
  const parent = (i: number): number | undefined => {
    const follow = rig.layers[i]?.follow;
    return follow === undefined ? undefined : index.get(follow);
  };
  rig.layers.forEach((layer, i) => {
    if (layer.follow !== undefined && !index.has(layer.follow)) {
      errors.push({
        code: "bad_follow",
        message: `layer "${layer.name}" follows "${layer.follow}", which is not a layer of this rig`,
        layer: layer.name,
        path: `$.layers[${i}].follow`,
      });
      return;
    }
    const chain = [layer.name];
    for (let at = parent(i), steps = 0; at !== undefined && steps < rig.layers.length; at = parent(at), steps += 1) {
      chain.push(rig.layers[at]?.name ?? "?");
      if (at !== i) continue;
      errors.push({
        code: "bad_follow",
        message: `layer "${layer.name}" is on a follow cycle: ${chain.join(" -> ")}`,
        layer: layer.name,
        path: `$.layers[${i}].follow`,
      });
      break;
    }
  });
}

/** Decoded JSON -> Rig, or every reason it is not one. */
export function validateRig(input: unknown): Result<Rig, RigError[]> {
  const reader = new Reader();
  const rig = reader.rig(input);
  if (rig === undefined) return { ok: false, errors: reader.errors };
  const errors: RigError[] = [];
  checkPalette(rig.palette, errors);
  checkBounds(rig, errors);
  checkUnique(rig, "name", "duplicate_name", errors);
  checkUnique(rig, "z", "duplicate_z", errors);
  checkFollows(rig, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: rig };
}
