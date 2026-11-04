// Golden (rig-core task 3.3, req 3.3): the committed Malakor rig imports with zero errors.
// The JSON is imported as modules (resolveJsonModule), so no JSON.parse of external text here.
import { describe, expect, it } from "vitest";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import { importLegacyLayers, type LegacyImport } from "../legacy.js";
import { phaseFromName } from "../motion.js";
import { poseLayers } from "../pose.js";
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

  it("takes its palette from m8.spec.json: teal eye light for eye/mouth, orange lines for glow and rim", () => {
    // mouth [0.2, 0.85, 0.78] -> #33d9c7, line_glow [0.85, 0.45, 0.12] -> #d9731f,
    // line_core [1, 0.62, 0.22] -> #ff9e38 (x255, rounded).
    expect(malakor().rig.palette).toEqual({ glow: "#d9731f", eye: "#33d9c7", rim: "#ff9e38", mouth: "#33d9c7" });
  });

  it("gives the eyes a teal light (green and blue well above red), the monocle ring an orange rim and glow", () => {
    const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    const { palette } = malakor().rig;
    const [er, eg, eb] = rgb(palette.eye);
    expect(eg).toBeGreaterThan(2 * er);
    expect(eb).toBeGreaterThan(2 * er);
    for (const ring of [palette.rim, palette.glow]) {
      const [rr, rg, rb] = rgb(ring);
      expect(rr).toBeGreaterThan(rg);
      expect(rg).toBeGreaterThan(rb);
    }
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
    for (const layer of rig.layers) expect(layer.file).toBe(`${layer.name}.webp`);
    expect(warnings.map((w) => w.layer)).toEqual(["mouth_glow"]);
  });

  it("survives a serialize -> parse round trip unchanged", () => {
    const { rig } = malakor();
    expect(parseRigJson(serializeRig(rig))).toEqual({ ok: true, value: rig });
  });

  // cast-forge req 1.4. The design says 13 floats; Malakor's layers.json and m8.spec.json carry 11
  // (shard_c plus five pairs), and those are the ones that float.
  it("keeps the legacy float curves on all 11 shards and the pulse on the monocle, with name-hash phases", () => {
    const { rig } = malakor();
    const legacy = new Map(layersJson.layers.map((l) => [l.name, l]));
    const floats = rig.layers.filter((l) => l.motion?.float !== undefined);
    const pulses = rig.layers.filter((l) => l.motion?.pulse !== undefined);
    expect(floats.map((l) => l.name).sort()).toEqual([...SHARDS].sort());
    expect(pulses.map((l) => l.name)).toEqual(["monocle"]);
    for (const layer of floats) {
      const source = legacy.get(layer.name);
      expect(source && "float" in source ? source.float : undefined).toBeDefined();
      if (source === undefined || !("float" in source)) continue;
      expect(layer.motion).toEqual({ float: { ...source.float, phase: phaseFromName(layer.name) } });
    }
    expect(rig.layers.find((l) => l.name === "monocle")?.motion).toEqual({ pulse: { amp: 0.12, freq: 0.13, phase: phaseFromName("monocle") } });
    expect(new Set(floats.map((l) => l.motion?.float?.phase)).size).toBe(floats.length);
  });

  it("takes the curves from m8.spec.json when layers.json lacks them", () => {
    const bare = { ...layersJson, layers: layersJson.layers.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== "float" && k !== "pulse"))) };
    const result = importLegacyLayers(bare, specJson);
    if (!result.ok) throw new Error("import failed");
    expect(result.value.rig).toEqual(malakor().rig);
  });

  it("floats in the app: shards are elsewhere 1 s apart, and still under reduced motion", () => {
    const { rig } = malakor();
    const look = { palette: rig.palette, hidden: [], emotion: "neutral" as const };
    const at = (t: number, still?: true) => new Map(poseLayers(rig, look, { t, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, ...(still ? { still } : {}) }).map((p) => [p.name, p]));
    const [a, b] = [at(3), at(4)];
    for (const shard of SHARDS) expect(Math.hypot((a.get(shard)?.x ?? 0) - (b.get(shard)?.x ?? 0), (a.get(shard)?.y ?? 0) - (b.get(shard)?.y ?? 0))).toBeGreaterThan(0.05);
    expect(a.get("monocle")?.tint).not.toBeCloseTo(b.get("monocle")?.tint ?? 0, 6);
    expect(at(3, true)).toEqual(at(4, true));
  });
});
