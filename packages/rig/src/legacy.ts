// importLegacyLayers (rig-core req 3): Overlord-era `layers.json` (rig_type "glow") plus optional
// `m8.spec.json` colours -> Rig v1 with source "import". Kinds map per design.md "Legacy import".
// The converted rig is passed through validateRig, so a successful import is always a valid Rig.
// A legacy per-layer `depth` in [0, 1] is kept; any other value is warned about and dropped, so
// the layer falls back to the per-kind default of the Rig format. Static layers always get depth
// 0 (mapping table). Float and pulse curves (`float {amp, freq, rot_deg}`, `pulse {amp, freq}`)
// are kept as `motion` (amended by cast-forge, req 1.4): from the layer, else from the m8 spec
// element of the same name, with a phase from the layer-name hash so sibling shards never move in
// lockstep and the same rig always moves alike. A curve outside the Rig ranges is warned about and
// dropped. Other legacy-only fields (numeric follow weights, gains, modes) are dropped.
import type { Result } from "./result.js";
import { phaseFromName } from "./motion.js";
import { RIG_VERSION, type LayerKind, type Motion, type Palette, type Rig } from "./types.js";
import { validateRig, type RigError } from "./validate.js";
import { readFloat, readPulse, type MotionCanvas } from "./validateMotion.js";

export interface LegacyWarning {
  /** Legacy layer name. */
  layer: string;
  message: string;
}

export interface LegacyImport {
  rig: Rig;
  warnings: LegacyWarning[];
}

/** Used when no spec is given: Malakor's own colours from his m8.spec.json (mapped as below). */
export const DEFAULT_LEGACY_PALETTE: Palette = { glow: "#d9731f", eye: "#33d9c7", rim: "#ff9e38", mouth: "#33d9c7" };

interface Mapping {
  kind: LayerKind;
  follow?: "head";
  depth?: 0;
}

/**
 * design.md mapping table. Overlord writes the jaw as kind `aperture_lower` (the lower lip of the
 * mouth aperture), so that spelling maps to `jaw` too.
 */
const KIND_MAP = new Map<string, Mapping>([
  ["static", { kind: "static", depth: 0 }],
  ["background", { kind: "static", depth: 0 }],
  ["body", { kind: "body" }],
  ["head", { kind: "head" }],
  ["jaw", { kind: "jaw", follow: "head" }],
  ["aperture_lower", { kind: "jaw", follow: "head" }],
  ["eye", { kind: "eye", follow: "head" }],
  ["pulse", { kind: "accessory", follow: "head" }],
]);
const CROWN: Mapping = { kind: "crown", follow: "head" };
const UNKNOWN: Mapping = { kind: "accessory" };

const SLUG = /^[a-z0-9_-]+$/;

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shape = (path: string, message: string, layer?: string): RigError => ({
  code: "bad_shape",
  message: `${path}: ${message}`,
  path,
  ...(layer === undefined ? {} : { layer }),
});

const isUnit = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** [r, g, b] in 0..1 -> "#rrggbb", or undefined when `value` is not such a triple. */
function toHex(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const channels: unknown[] = Array.from(value);
  if (!channels.every(isUnit)) return undefined;
  return `#${channels.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * spec.colors -> palette (rig-core task 7, director rulings 2026-11-01): the eye light `mouth`
 * (teal) -> `eye` and `mouth`; `line_glow` -> `glow`; `line_core` (the orange monocle line) ->
 * `rim`. The renderer multiplies eye texels by `palette.eye`, so an orange eye colour turned the
 * teal eyes green; a teal glow, added over the monocle, turned its orange ring yellow. Paths start
 * at `spec`.
 */
function specPalette(spec: unknown, errors: RigError[]): Palette | undefined {
  const colors = isRecord(spec) ? spec.colors : undefined;
  if (!isRecord(colors)) {
    errors.push(shape("spec.colors", "expected an object of 0..1 RGB triples"));
    return undefined;
  }
  const read = (key: string): string | undefined => {
    const hex = toHex(colors[key]);
    if (hex === undefined) errors.push(shape(`spec.colors.${key}`, "expected [r, g, b] with each channel in 0..1"));
    return hex;
  };
  const glow = read("line_glow");
  const core = read("line_core");
  const mouth = read("mouth");
  if (glow === undefined || core === undefined || mouth === undefined) return undefined;
  return { glow, eye: mouth, rim: core, mouth };
}

/** A legacy depth in [0, 1], or undefined (absent, or warned about and dropped). */
function legacyDepth(layer: string, value: unknown, warnings: LegacyWarning[]): number | undefined {
  if (value === undefined || isUnit(value)) return value;
  warnings.push({ layer, message: `legacy depth ${String(JSON.stringify(value))} is not a number in [0, 1]; using the kind default` });
  return undefined;
}

/** spec.elements by name (the m8 spec's per-layer curves); empty without a spec or elements. */
function specElements(spec: unknown): Map<string, Fields> {
  const elements = isRecord(spec) && Array.isArray(spec.elements) ? (Array.from(spec.elements) as unknown[]) : [];
  const byName = new Map<string, Fields>();
  for (const element of elements) {
    if (isRecord(element) && typeof element.name === "string" && !byName.has(element.name)) byName.set(element.name, element);
  }
  return byName;
}

const dimension = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined);

/** The layer's float and pulse curves as Rig motion (phase from the name), or undefined when it has none. */
function legacyMotion(name: string, item: Fields, element: Fields | undefined, canvas: MotionCanvas, warnings: LegacyWarning[]): Motion | undefined {
  const phase = phaseFromName(name);
  const curve = (key: "float" | "pulse"): unknown => {
    const own = item[key];
    const raw = own === undefined ? element?.[key] : own;
    return isRecord(raw) ? { ...raw, phase } : raw;
  };
  const rawFloat = curve("float");
  const rawPulse = curve("pulse");
  const float = rawFloat === undefined ? undefined : readFloat(rawFloat, "float", canvas);
  const pulse = rawPulse === undefined ? undefined : readPulse(rawPulse, "pulse");
  for (const problem of [...(float?.problems ?? []), ...(pulse?.problems ?? [])]) {
    warnings.push({ layer: name, message: `legacy ${problem.message}; curve dropped` });
  }
  if (float?.float === undefined && pulse?.pulse === undefined) return undefined;
  return { ...(float?.float === undefined ? {} : { float: float.float }), ...(pulse?.pulse === undefined ? {} : { pulse: pulse.pulse }) };
}

/** Legacy layers -> undecoded Rig layers (validateRig checks them). Image-less layers are skipped. */
function convertLayers(value: unknown, spec: unknown, canvas: MotionCanvas, errors: RigError[], warnings: LegacyWarning[]): Fields[] {
  if (!Array.isArray(value)) {
    errors.push(shape("$.layers", "expected an array of layers"));
    return [];
  }
  const items: unknown[] = Array.from(value);
  const elements = specElements(spec);
  const layers: Fields[] = [];
  items.forEach((item, i) => {
    const path = `$.layers[${i}]`;
    if (!isRecord(item)) {
      errors.push(shape(path, "expected a layer object"));
      return;
    }
    const { name, kind } = item;
    if (typeof name !== "string") {
      errors.push(shape(`${path}.name`, "expected a string"));
      return;
    }
    if (typeof kind !== "string") {
      errors.push(shape(`${path}.kind`, "expected a string", name));
      return;
    }
    if (item.file === undefined) {
      warnings.push({ layer: name, message: `legacy kind ${JSON.stringify(kind)} has no image file; skipped` });
      return;
    }
    let mapping = name.startsWith("shard_") ? CROWN : KIND_MAP.get(kind);
    if (mapping === undefined) {
      warnings.push({ layer: name, message: `unknown legacy kind ${JSON.stringify(kind)}; imported as accessory` });
      mapping = UNKNOWN;
    }
    const depth = mapping.depth ?? legacyDepth(name, item.depth, warnings);
    const motion = legacyMotion(name, item, elements.get(name), canvas, warnings);
    layers.push({
      name,
      z: item.z,
      kind: mapping.kind,
      file: item.file,
      bbox: item.bbox,
      anchor: item.anchor,
      ...(mapping.follow === undefined ? {} : { follow: mapping.follow }),
      ...(depth === undefined ? {} : { depth }),
      ...(motion === undefined ? {} : { motion }),
    });
  });
  return layers;
}

/**
 * Overlord `layers.json` (+ optional `m8.spec.json`) -> Rig. Legacy shape faults are `bad_shape`
 * at paths into `json` (`$...`) or `spec` (`spec...`); the converted rig is then validated, and
 * its errors use paths into the converted rig. The rig id and name are the legacy `portrait_id`
 * (or "legacy"); callers rename as needed.
 */
export function importLegacyLayers(json: unknown, spec?: unknown): Result<LegacyImport, RigError[]> {
  if (!isRecord(json)) return { ok: false, errors: [shape("$", "expected a legacy layers.json object")] };
  const errors: RigError[] = [];
  const warnings: LegacyWarning[] = [];
  if (json.rig_type !== "glow") errors.push(shape("$.rig_type", `expected "glow", got ${JSON.stringify(json.rig_type) ?? "nothing"}`));
  const palette = spec === undefined ? DEFAULT_LEGACY_PALETTE : specPalette(spec, errors);
  const width = dimension(json.width);
  const height = dimension(json.height);
  const canvas = { ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) };
  const layers = convertLayers(json.layers, spec, canvas, errors, warnings);
  if (errors.length > 0 || palette === undefined) return { ok: false, errors };
  const portrait = json.portrait_id;
  const id = typeof portrait === "string" && SLUG.test(portrait) ? portrait : "legacy";
  const result = validateRig({
    version: RIG_VERSION,
    id,
    name: id,
    width: json.width,
    height: json.height,
    source: "import",
    palette,
    layers,
  });
  return result.ok ? { ok: true, value: { rig: result.value, warnings } } : { ok: false, errors: result.errors };
}
