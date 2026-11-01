// Golden (rig-core task 3.3, req 3.3): the committed Malakor rig imports with zero errors.
// The JSON is imported as modules (resolveJsonModule), so no JSON.parse of external text here.
import { describe, expect, it } from "vitest";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import { importLegacyLayers, type LegacyImport } from "../legacy.js";
import { serializeRig } from "../serialize.js";
import { parseRigJson } from "../validate.js";

function malakor(): LegacyImport {
  const result = importLegacyLayers(layersJson, specJson);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.value;
}

const SHARDS = ["shard_r5", "shard_l5", "shard_r4", "shard_l4", "shard_r3", "shard_l3", "shard_r2", "shard_l2", "shard_r1", "shard_l1", "shard_c"];

describe("Malakor golden import", () => {
  it("imports with 0 errors, 18 layers and source import", () => {
    const { rig } = malakor();
    expect(rig.layers).toHaveLength(18);
    expect(rig).toMatchObject({ version: 1, source: "import", width: 1024, height: 1024 });
  });

  it("takes its palette from m8.spec.json", () => {
    // line_glow [0.85, 0.45, 0.12], line_core [1, 0.62, 0.22], mouth [0.2, 0.85, 0.78], x255, rounded.
    expect(malakor().rig.palette).toEqual({ glow: "#d9731f", eye: "#ff9e38", rim: "#ff9e38", mouth: "#33d9c7" });
  });

  it("maps every layer per the design.md table and follows the head", () => {
    const kinds = Object.fromEntries(malakor().rig.layers.map((l) => [l.name, [l.kind, l.follow ?? null]]));
    expect(kinds).toEqual({
      background: ["static", null],
      torso: ["body", null],
      head: ["head", null],
      jaw: ["jaw", "head"],
      eye_l: ["eye", "head"],
      eye_r: ["eye", "head"],
      monocle: ["accessory", "head"],
      ...Object.fromEntries(SHARDS.map((s) => [s, ["crown", "head"]])),
    });
  });

  it("keeps the legacy depths (all in [0, 1]), pins the background to 0, and leaves the rest to kind defaults", () => {
    const depths = Object.fromEntries(malakor().rig.layers.flatMap((l) => (l.depth === undefined ? [] : [[l.name, l.depth]])));
    expect(depths).toEqual({ background: 0, jaw: 0.466, shard_c: 0.25, eye_l: 0.518, eye_r: 0.47, monocle: 0.392 });
  });

  it("keeps legacy z order and file names, and warns only about the image-less mouth_glow", () => {
    const { rig, warnings } = malakor();
    const zs = rig.layers.map((l) => l.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    for (const layer of rig.layers) expect(layer.file).toBe(`${layer.name}.png`);
    expect(warnings.map((w) => w.layer)).toEqual(["mouth_glow"]);
  });

  it("survives a serialize -> parse round trip unchanged", () => {
    const { rig } = malakor();
    expect(parseRigJson(serializeRig(rig))).toEqual({ ok: true, value: rig });
  });
});
