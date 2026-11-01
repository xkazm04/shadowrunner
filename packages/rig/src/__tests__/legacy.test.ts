// importLegacyLayers (rig-core task 3.2): the design.md mapping table, unknown-kind warnings,
// spec colours and malformed input.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEGACY_PALETTE, importLegacyLayers, type LegacyImport, type LegacyWarning } from "../legacy.js";
import type { LayerKind } from "../types.js";
import type { RigError } from "../validate.js";

/**
 * design.md "Legacy import", plus the jaw's Overlord spelling `aperture_lower`. `depth` is the
 * table's fixed depth; kinds without one keep the legacy depth.
 */
const TABLE: [legacyKind: string, kind: LayerKind, follow: string | undefined, depth: number | undefined][] = [
  ["static", "static", undefined, 0],
  ["background", "static", undefined, 0],
  ["body", "body", undefined, undefined],
  ["head", "head", undefined, undefined],
  ["jaw", "jaw", "head", undefined],
  ["aperture_lower", "jaw", "head", undefined],
  ["eye", "eye", "head", undefined],
  ["pulse", "accessory", "head", undefined],
];
const KNOWN = new Set(TABLE.map(([k]) => k));
const STATIC = new Set(TABLE.filter(([, kind]) => kind === "static").map(([k]) => k));

const HEAD = { name: "head", z: 0, kind: "head", file: "head.png", bbox: [10, 10, 50, 50], anchor: [35, 35] };
const LEGACY_DEPTH = 0.4;

function legacyLayer(name: string, z: number, kind: string): Record<string, unknown> {
  return { name, z, kind, file: `${name}.png`, bbox: [0, 0, 10, 10], anchor: [5, 5], mode: "cut", occl: 1, follow: 0.5, depth: LEGACY_DEPTH };
}

function legacy(layers: unknown[]): Record<string, unknown> {
  return { version: 1, portrait_id: "p1", rig_type: "glow", width: 100, height: 100, layers };
}

function imported(json: unknown, spec?: unknown): LegacyImport {
  const result = importLegacyLayers(json, spec);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

function errorsOf(json: unknown, spec?: unknown): RigError[] {
  const result = importLegacyLayers(json, spec);
  if (result.ok) throw new Error("expected the import to fail");
  return result.errors;
}

const arbName = fc.stringMatching(/^[a-z0-9_]{1,10}$/).filter((n) => n !== "head" && !n.startsWith("shard_"));
const arbUnknownKind = fc.string().filter((k) => !KNOWN.has(k));
const arbLegacyKind = fc.oneof(fc.constantFrom(...KNOWN), arbUnknownKind);

describe("importLegacyLayers: kind mapping", () => {
  it("maps every legacy kind in the table, sets follow and depth per the table, drops legacy-only fields", () => {
    for (const [legacyKind, kind, follow, depth] of TABLE) {
      const { rig, warnings } = imported(legacy([HEAD, legacyLayer("part", 1, legacyKind)]));
      expect(warnings).toEqual([]);
      expect(rig.layers[1]).toEqual({
        name: "part",
        z: 1,
        kind,
        file: "part.png",
        bbox: [0, 0, 10, 10],
        anchor: [5, 5],
        ...(follow === undefined ? {} : { follow }),
        depth: depth ?? LEGACY_DEPTH,
      });
    }
  });

  it("maps shard_* names to crown following the head, whatever their legacy kind", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9_]{0,8}$/), arbLegacyKind, (suffix, legacyKind) => {
        const { rig, warnings } = imported(legacy([HEAD, legacyLayer(`shard_${suffix}`, 1, legacyKind)]));
        expect(warnings).toEqual([]);
        expect(rig.layers[1]).toMatchObject({ kind: "crown", follow: "head" });
      }),
    );
  });

  it("maps unknown kinds to accessory and reports each one, in order, as a warning", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.tuple(arbName, arbLegacyKind), { selector: ([n]) => n, maxLength: 8 }), (parts) => {
        const layers = parts.map(([name, kind], i) => legacyLayer(name, i + 1, kind));
        const { rig, warnings } = imported(legacy([HEAD, ...layers]));
        expect(rig.layers).toHaveLength(parts.length + 1);
        const unknown = parts.filter(([, kind]) => !KNOWN.has(kind));
        expect(warnings.map((w) => w.layer)).toEqual(unknown.map(([name]) => name));
        unknown.forEach(([, kind], k) => expect(warnings[k]?.message).toContain(JSON.stringify(kind)));
        for (const [name] of unknown) {
          const layer = rig.layers.find((l) => l.name === name);
          expect(layer).toEqual({
            name,
            z: expect.any(Number),
            kind: "accessory",
            file: `${name}.png`,
            bbox: [0, 0, 10, 10],
            anchor: [5, 5],
            depth: LEGACY_DEPTH,
          });
        }
      }),
    );
  });

  it("skips a layer without an image file and warns about it", () => {
    const glow = { name: "mouth_glow", z: 4, kind: "aperture_glow", depth: 0.5, mode: "none", gain: 0.12 };
    const { rig, warnings } = imported(legacy([HEAD, glow]));
    expect(rig.layers.map((l) => l.name)).toEqual(["head"]);
    expect(warnings).toEqual([{ layer: "mouth_glow", message: expect.stringContaining("aperture_glow") }]);
  });

  it("builds a Rig v1 with source import and the portrait id", () => {
    const { rig } = imported(legacy([HEAD]));
    expect(rig).toMatchObject({ version: 1, id: "p1", name: "p1", width: 100, height: 100, source: "import" });
    expect(rig).not.toHaveProperty("fictional");
  });
});

describe("importLegacyLayers: depth", () => {
  const nonStaticKind = arbLegacyKind.filter((k) => !STATIC.has(k));
  // Unknown-kind warnings quote the kind, which may itself contain "depth"; match the prefix.
  const isDepthWarning = (w: LegacyWarning): boolean => w.message.startsWith("legacy depth");
  const withDepth = (kind: string, depth: unknown): Record<string, unknown> => {
    const layer = legacyLayer("part", 1, kind);
    if (depth === undefined) delete layer.depth;
    else layer.depth = depth;
    return layer;
  };

  it("keeps a legacy depth in [0, 1] without a warning", () => {
    fc.assert(
      fc.property(nonStaticKind, fc.double({ min: 0, max: 1, noNaN: true }), (kind, depth) => {
        const { rig, warnings } = imported(legacy([HEAD, withDepth(kind, depth)]));
        expect(rig.layers[1]?.depth).toBe(depth);
        expect(warnings.filter((w) => isDepthWarning(w))).toEqual([]);
      }),
    );
  });

  it("omits depth (kind default) and stays silent when the legacy layer has none", () => {
    fc.assert(
      fc.property(nonStaticKind, (kind) => {
        const { rig, warnings } = imported(legacy([HEAD, withDepth(kind, undefined)]));
        expect(rig.layers[1]).not.toHaveProperty("depth");
        expect(warnings.filter((w) => isDepthWarning(w))).toEqual([]);
      }),
    );
  });

  it("warns about a depth outside [0, 1] or not a number, and falls back to the kind default", () => {
    const badDepth = fc.oneof(
      fc.double({ min: 1.000001, max: 1e9, noNaN: true }),
      fc.double({ max: -1e-9, noNaN: true }),
      fc.constantFrom(NaN, Infinity, -Infinity, null, "0.5", [0.5], { samples: [0.1] }, true),
    );
    fc.assert(
      fc.property(nonStaticKind, badDepth, (kind, depth) => {
        const { rig, warnings } = imported(legacy([HEAD, withDepth(kind, depth)]));
        expect(rig.layers[1]).not.toHaveProperty("depth");
        const depthWarnings = warnings.filter((w) => isDepthWarning(w));
        expect(depthWarnings).toEqual([{ layer: "part", message: expect.stringContaining("[0, 1]") }]);
      }),
    );
  });

  it("gives static layers depth 0 whatever the legacy depth", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATIC), fc.oneof(fc.double({ noNaN: true }), fc.constant(undefined)), (kind, depth) => {
        const { rig } = imported(legacy([HEAD, withDepth(kind, depth)]));
        expect(rig.layers[1]?.depth).toBe(0);
      }),
    );
  });
});

describe("importLegacyLayers: palette", () => {
  const unit = fc.double({ min: 0, max: 1, noNaN: true });
  const rgb = fc.tuple(unit, unit, unit);
  const hex = (c: readonly number[]): string => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

  it("takes eye and mouth from the eye light (mouth), glow from line_glow, rim from line_core (0..1 -> #rrggbb)", () => {
    fc.assert(
      fc.property(rgb, rgb, rgb, (glow, core, mouth) => {
        const spec = { colors: { line_glow: glow, line_core: core, mouth } };
        const { rig } = imported(legacy([HEAD]), spec);
        expect(rig.palette).toEqual({ glow: hex(glow), eye: hex(mouth), rim: hex(core), mouth: hex(mouth) });
      }),
    );
  });

  it("uses the fixed default palette when no spec is given", () => {
    expect(imported(legacy([HEAD])).rig.palette).toEqual(DEFAULT_LEGACY_PALETTE);
  });

  it("rejects spec colours that are not 0..1 RGB triples with bad_shape at the spec path", () => {
    const badRgb = fc.oneof(
      fc.constant(undefined),
      fc.constant("#ff0000"),
      fc.tuple(unit, unit),
      fc.tuple(unit, unit, fc.oneof(fc.double({ min: 1.0001, max: 1e6, noNaN: true }), fc.double({ min: -1e6, max: -0.0001, noNaN: true }), fc.constant(NaN))),
    );
    fc.assert(
      fc.property(fc.constantFrom("line_glow", "line_core", "mouth"), badRgb, (key, value) => {
        const colors: Record<string, unknown> = { line_glow: [1, 0, 0], line_core: [0, 1, 0], mouth: [0, 0, 1], [key]: value };
        const errors = errorsOf(legacy([HEAD]), { colors });
        expect(errors.map((e) => [e.code, e.path])).toEqual([["bad_shape", `spec.colors.${key}`]]);
      }),
    );
  });
});

describe("importLegacyLayers: malformed input", () => {
  it("rejects a non-object, a non-glow rig_type, and a missing layers array", () => {
    expect(errorsOf(null).map((e) => e.path)).toEqual(["$"]);
    expect(errorsOf({ ...legacy([HEAD]), rig_type: "mesh" }).map((e) => [e.code, e.path])).toEqual([["bad_shape", "$.rig_type"]]);
    expect(errorsOf({ ...legacy([]), layers: undefined }).map((e) => [e.code, e.path])).toEqual([["bad_shape", "$.layers"]]);
  });

  it("rejects layers that are not objects or have no string name or kind", () => {
    const errors = errorsOf(legacy([HEAD, 3, { ...HEAD, name: 7 }, { ...HEAD, name: "x", z: 9, kind: undefined }]));
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ["bad_shape", "$.layers[1]"],
      ["bad_shape", "$.layers[2].name"],
      ["bad_shape", "$.layers[3].kind"],
    ]);
  });

  it("passes converted layers through validateRig, so contract faults surface with their codes", () => {
    const errors = errorsOf(legacy([HEAD, { ...legacyLayer("eye", 0, "eye"), bbox: [95, 0, 10, 10] }]));
    expect(errors.map((e) => [e.code, e.layer]).sort()).toEqual([
      ["bbox_out_of_bounds", "eye"],
      ["duplicate_z", "eye"],
    ]);
  });
});
