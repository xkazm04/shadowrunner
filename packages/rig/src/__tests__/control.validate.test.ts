// Character-control validation and wire (task 1, design.md "Wire types"): validateRig reads
// `Layer.variants` and `Layer.regions` and reports every fault at its own path; serializeRig
// round-trips them and omits them when absent; validateLookControls checks a saved look's
// `regions` and `shape`.
import { describe, expect, it } from "vitest";
import { importLegacyLayers } from "../legacy.js";
import { serializeRig } from "../serialize.js";
import type { Layer, Rig } from "../types.js";
import { parseRigJson, validateRig, type RigError } from "../validate.js";
import { validateLookControls } from "../validateControl.js";

const base = (layers: unknown[]): Record<string, unknown> => ({
  version: 1,
  id: "ctl",
  name: "Ctl",
  width: 1000,
  height: 800,
  source: "replay",
  fictional: true,
  palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
  layers,
});
const head = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "head", z: 0, kind: "head", file: "head.png", bbox: [100, 100, 400, 400], anchor: [300, 300], ...extra });
const jaw = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "jaw", z: 1, kind: "jaw", file: "jaw.png", bbox: [200, 400, 200, 100], anchor: [300, 410], follow: "head", ...extra });

const GOOD: Layer[] = [
  {
    name: "head",
    z: 0,
    kind: "head",
    file: "head.png",
    bbox: [100, 100, 400, 400],
    anchor: [300, 300],
    variants: { smug: { file: "head.smug.png", bbox: [150, 150, 200, 100], mode: "over" }, joy: { file: "data:image/png;base64,AAAA", bbox: [0, 0, 1000, 800], mode: "over" } },
    regions: { map: "head.regions.png", slots: [{ id: "r1", name: "head", hex: "#A0b0c0" }, { id: "r2", name: "head 2", hex: "#102030" }] },
  },
  {
    name: "jaw",
    z: 1,
    kind: "jaw",
    file: "jaw.png",
    bbox: [200, 400, 200, 100],
    anchor: [300, 410],
    follow: "head",
    regions: { map: "jaw.regions.png", slots: [{ id: "cavity", name: "mouth", hex: "#300000" }] },
  },
];
const RIG: Rig = {
  version: 1,
  id: "ctl",
  name: "Ctl",
  width: 1000,
  height: 800,
  source: "replay",
  fictional: true,
  palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
  layers: GOOD,
};

function errorsOf(input: unknown): RigError[] {
  const result = validateRig(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}
const paths = (errors: RigError[]): string[] => errors.map((e) => `${e.code} ${e.path ?? ""}`).sort();

describe("validateRig: variants and regions", () => {
  it("accepts and keeps both", () => {
    expect(validateRig(RIG)).toEqual({ ok: true, value: RIG });
  });

  it("reports every variants fault at its own path", () => {
    const variants = {
      wrath: { file: "a.png", bbox: [0, 0, 1, 1], mode: "over" },
      joy: { file: "", bbox: [0, 0, 1, 1], mode: "over" },
      anger: { file: "a.png", bbox: [0, 0, 0, -1], mode: "under" },
      gloom: { file: "a.png", bbox: [0, Number.NaN, 1, 1], mode: "replace" },
      smug: "a.png",
    };
    expect(paths(errorsOf(base([head({ variants })])))).toEqual(
      [
        "bad_shape $.layers[0].variants.wrath",
        "bad_shape $.layers[0].variants.joy.file",
        "bad_shape $.layers[0].variants.anger.bbox[2]",
        "bad_shape $.layers[0].variants.anger.bbox[3]",
        "bad_shape $.layers[0].variants.anger.mode",
        "bad_shape $.layers[0].variants.gloom.bbox",
        "bad_shape $.layers[0].variants.smug",
      ].sort(),
    );
    expect(paths(errorsOf(base([head({ variants: [] })])))).toEqual(["bad_shape $.layers[0].variants"]);
  });

  it("reports a patch bbox outside the canvas, every one", () => {
    const variants = { joy: { file: "a.png", bbox: [-1, 0, 10, 10], mode: "over" }, anger: { file: "a.png", bbox: [990, 790, 11, 10], mode: "replace" } };
    expect(paths(errorsOf(base([head({ variants })])))).toEqual(["bbox_out_of_bounds $.layers[0].variants.anger.bbox", "bbox_out_of_bounds $.layers[0].variants.joy.bbox"]);
  });

  it("reports every regions fault: map, slot count, id format and uniqueness, name, hex", () => {
    const slots = [
      { id: "r1", name: "a", hex: "#000000" },
      { id: "r1", name: "b", hex: "#000000" },
      { id: "R 2", name: "", hex: 12 },
    ];
    expect(paths(errorsOf(base([head({ regions: { map: "/abs.png", slots } })])))).toEqual(
      [
        "bad_shape $.layers[0].regions.map",
        "bad_shape $.layers[0].regions.slots[1].id",
        "bad_shape $.layers[0].regions.slots[2].id",
        "bad_shape $.layers[0].regions.slots[2].name",
        "bad_shape $.layers[0].regions.slots[2].hex",
      ].sort(),
    );
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: "x", hex: "#000000" }));
    expect(paths(errorsOf(base([head({ regions: { map: "m.png", slots: five } }), jaw({ regions: { map: "m.png", slots: [] } })])))).toEqual([
      "bad_shape $.layers[0].regions.slots",
      "bad_shape $.layers[1].regions.slots",
    ]);
    expect(paths(errorsOf(base([head({ regions: "m.png" })])))).toEqual(["bad_shape $.layers[0].regions"]);
  });

  it("a slot's shade is \"move\" or absent: kept and round-tripped when \"move\", omitted when absent, anything else bad_shape", () => {
    const slots = [
      { id: "r1", name: "a", hex: "#101010", shade: "move" },
      { id: "r2", name: "b", hex: "#202020" },
    ];
    const read = validateRig(base([head({ regions: { map: "m.png", slots } })]));
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    expect(read.value.layers[0]?.regions?.slots).toEqual(slots);
    expect(read.value.layers[0]?.regions?.slots[1]).not.toHaveProperty("shade");
    const wire = JSON.parse(serializeRig(read.value)) as Rig;
    expect(wire.layers[0]?.regions?.slots).toEqual(slots);
    expect(JSON.stringify(wire.layers[0]?.regions?.slots[1])).not.toContain("shade");
    for (const shade of [null, "keep", true]) {
      expect(paths(errorsOf(base([head({ regions: { map: "m.png", slots: [{ id: "r1", name: "a", hex: "#000000", shade }] } })])))).toEqual(["bad_shape $.layers[0].regions.slots[0].shade"]);
    }
  });

  it("reports a slot hex that is not #rrggbb as bad_color, every one", () => {
    const regions = { map: "m.png", slots: [{ id: "r1", name: "a", hex: "red" }, { id: "r2", name: "b", hex: "#12345" }] };
    expect(paths(errorsOf(base([head({ regions })])))).toEqual(["bad_color $.layers[0].regions.slots[0].hex", "bad_color $.layers[0].regions.slots[1].hex"]);
  });

  it("names the layer on each error", () => {
    expect(errorsOf(base([head({ variants: { joy: 1 } })])).map((e) => e.layer)).toEqual(["head"]);
  });
});

describe("serializeRig / legacy: the new fields", () => {
  it("round-trips variants and regions (families in contract order)", () => {
    const text = serializeRig(RIG);
    expect(parseRigJson(text)).toEqual({ ok: true, value: RIG });
    expect(text.indexOf('"joy"')).toBeLessThan(text.indexOf('"smug"'));
    expect(Object.keys(JSON.parse(text).layers[0])).toEqual(["name", "z", "kind", "file", "bbox", "anchor", "variants", "regions"]);
  });

  it("omits them when absent", () => {
    const bare = (layer: Layer): Layer => {
      const copy = { ...layer };
      delete copy.variants;
      delete copy.regions;
      return copy;
    };
    const plain = { ...RIG, layers: RIG.layers.map(bare) };
    const text = serializeRig(plain);
    expect(text).not.toContain("variants");
    expect(text).not.toContain("regions");
    expect(parseRigJson(text)).toEqual({ ok: true, value: plain });
  });

  it("carries a legacy layer's variants and regions through the import", () => {
    const legacy = {
      rig_type: "glow",
      width: 64,
      height: 64,
      layers: [{ name: "head", kind: "head", file: "head.png", z: 0, bbox: [0, 0, 64, 64], anchor: [32, 32] }, { name: "eye_l", kind: "eye", file: "eye_l.png", z: 1, bbox: [0, 0, 8, 8], anchor: [4, 4], variants: { gloom: { file: "e.gloom.png", bbox: [0, 0, 8, 4], mode: "replace" } }, regions: { map: "e.regions.png", slots: [{ id: "r1", name: "eye", hex: "#33d9c7" }] } }],
    };
    const result = importLegacyLayers(legacy);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.rig.layers[1]?.variants).toEqual(legacy.layers[1]?.variants);
    expect(result.value.rig.layers[1]?.regions).toEqual(legacy.layers[1]?.regions);
  });
});

describe("validateLookControls", () => {
  const ok = { size: 1.2, sx: 1, sy: 0.8, dx: 0.05, dy: -0.15, rot: 25 };

  it("accepts valid regions and shape, and a look with neither", () => {
    expect(validateLookControls({ regions: { "head/r1": "#ff0000", "jaw/cavity": "#00FF00" }, shape: { head: ok } }, RIG)).toEqual([]);
    expect(validateLookControls({ palette: {}, hidden: [], emotion: "neutral" })).toEqual([]);
  });

  it("reports every bad region key and colour", () => {
    const errors = validateLookControls({ regions: { head: "#ff0000", "head/r1": "red", "Head/r1": "#ff0000" } });
    expect(errors).toHaveLength(3);
    expect(errors.join("\n")).toMatch(/regions\["head"\]: key must be "layer\/slot"/);
    expect(errors.join("\n")).toMatch(/regions\["head\/r1"\]: expected a "#rrggbb" string, got "red"/);
  });

  it("with a rig, keys must name its layers and slots", () => {
    const errors = validateLookControls({ regions: { "torso/r1": "#000000", "head/r9": "#000000" }, shape: { torso: ok } }, RIG);
    expect(errors).toEqual([
      'regions["torso/r1"]: no layer "torso" in this rig',
      'regions["head/r9"]: layer "head" has no region slot "r9"',
      'shape.torso: no layer "torso" in this rig',
    ]);
  });

  it("reports every shape field missing, non-finite or outside SHAPE_LIMITS", () => {
    const errors = validateLookControls({ shape: { head: { ...ok, size: 2, rot: Number.POSITIVE_INFINITY, dx: undefined }, jaw: 3 } });
    expect(errors).toEqual([
      "shape.head.size: expected a number in [0.6, 1.6], got 2",
      "shape.head.dx: expected a number in [-0.15, 0.15], got missing",
      "shape.head.rot: expected a number in [-25, 25], got Infinity",
      "shape.jaw: expected a part shape object, got 3",
    ]);
  });

  it("rejects a non-object look, regions or shape", () => {
    expect(validateLookControls(null)).toHaveLength(1);
    expect(validateLookControls({ regions: [], shape: "big" })).toHaveLength(2);
  });
});
