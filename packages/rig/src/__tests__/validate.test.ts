import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { serializeRig } from "../serialize.js";
import type { Layer, Rig } from "../types.js";
import { validateRig, type RigError } from "../validate.js";
import { arbRig, PALETTE_KEYS, rigArb } from "./arb.js";

const codes = (errors: RigError[]): string[] => errors.map((e) => e.code);

function errorsOf(input: unknown): RigError[] {
  const result = validateRig(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

/** The fabricated example from docs/rig-format.md. */
const DOC_EXAMPLE: Rig = {
  version: 1,
  id: "example_lich",
  name: "Example Lich",
  width: 1024,
  height: 1024,
  source: "replay",
  fictional: true,
  palette: { glow: "#7cf2c4", eye: "#e8fff4", rim: "#e8fff4", mouth: "#1a0f24" },
  layers: [
    { name: "head", z: 0, kind: "head", file: "head.png", bbox: [312, 180, 400, 520], anchor: [512, 640] },
    { name: "jaw", z: 1, kind: "jaw", file: "jaw.png", bbox: [400, 560, 224, 160], anchor: [512, 580], follow: "head" },
    {
      name: "monocle",
      z: 2,
      kind: "accessory",
      file: "monocle.png",
      bbox: [540, 360, 96, 96],
      anchor: [588, 408],
      follow: "head",
      depth: 0.8,
      visible: false,
    },
  ],
};

describe("validateRig: valid rigs", () => {
  it("accepts every rig produced by serializeRig, unchanged (round trip, req 2.6)", () => {
    fc.assert(
      fc.property(arbRig, (rig) => {
        const result = validateRig(JSON.parse(serializeRig(rig)));
        expect(result).toEqual({ ok: true, value: rig });
      }),
    );
  });

  it("accepts in-memory rigs and returns a fresh copy that does not alias the input", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), (rig) => {
        const result = validateRig(rig);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        expect(result.value).toEqual(rig);
        expect(result.value).not.toBe(rig);
        expect(result.value.layers[0]).not.toBe(rig.layers[0]);
        expect(result.value.palette).not.toBe(rig.palette);
      }),
    );
  });

  it("drops fields outside the contract", () => {
    fc.assert(
      fc.property(arbRig, (rig) => {
        const extra = { ...rig, extra: 1, palette: { ...rig.palette, extra: 2 }, layers: rig.layers.map((l) => ({ ...l, extra: 3 })) };
        expect(validateRig(extra)).toEqual({ ok: true, value: rig });
      }),
    );
  });

  it("accepts the docs/rig-format.md example", () => {
    expect(validateRig(DOC_EXAMPLE)).toEqual({ ok: true, value: DOC_EXAMPLE });
  });

  it("accepts boundary values: bbox touching every canvas edge, depth 0 and 1, no layers", () => {
    const edge: Rig = {
      ...DOC_EXAMPLE,
      layers: [
        { name: "a", z: 0, kind: "static", file: "a.png", bbox: [0, 0, 1024, 1024], anchor: [0, 0], depth: 0 },
        { name: "b", z: 1, kind: "eye", file: "b.png", bbox: [1023.5, 1023.5, 0.5, 0.5], anchor: [-5, 2000], depth: 1 },
      ],
    };
    expect(validateRig(edge).ok).toBe(true);
    expect(validateRig({ ...DOC_EXAMPLE, layers: [] }).ok).toBe(true);
  });
});

describe("validateRig: ordering and collection (req 2.7, 2.8)", () => {
  it("checks shape first: a shape fault hides the semantic faults", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 2 }), (rig) => {
        const [first, second, ...rest] = rig.layers;
        if (first === undefined || second === undefined) throw new Error("rigArb minLayers");
        const input = { ...rig, palette: { ...rig.palette, glow: 7 }, layers: [first, { ...second, z: first.z }, ...rest] };
        const errors = errorsOf(input);
        expect(errors.map((e) => [e.code, e.path])).toEqual([["bad_shape", "$.palette.glow"]]);
      }),
    );
  });

  it("collects every semantic error instead of stopping at the first", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), (rig) => {
        const input: Rig = {
          ...rig,
          palette: { glow: "red", eye: "#12345", rim: "", mouth: "#gggggg" },
          layers: rig.layers.map((l): Layer => ({ ...l, bbox: [-1, l.bbox[1], l.bbox[2], l.bbox[3]] })),
        };
        const errors = errorsOf(input);
        expect(codes(errors).filter((c) => c === "bad_color")).toHaveLength(PALETTE_KEYS.length);
        expect(errors.filter((e) => e.code === "bbox_out_of_bounds").map((e) => e.layer)).toEqual(rig.layers.map((l) => l.name));
        expect(errors).toHaveLength(PALETTE_KEYS.length + rig.layers.length);
      }),
    );
  });

  it("collects every shape error, each naming its JSON path and layer", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), (rig) => {
        const input = { ...rig, id: 5, layers: rig.layers.map((l) => ({ ...l, file: undefined, z: 0.5 })) };
        const errors = errorsOf(input);
        expect(errors.every((e) => e.code === "bad_shape")).toBe(true);
        const expected = [{ path: "$.id" }];
        rig.layers.forEach((l, i) => expected.push({ path: `$.layers[${i}].z` }, { path: `$.layers[${i}].file` }));
        expect(errors.map((e) => ({ path: e.path }))).toEqual(expect.arrayContaining(expected));
        expect(errors).toHaveLength(expected.length);
        for (const e of errors.filter((x) => x.path !== "$.id")) expect(rig.layers.map((l) => l.name)).toContain(e.layer);
      }),
    );
  });

  it("errors carry a message and omit absent optional fields rather than writing undefined or null", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result = validateRig(input);
        if (result.ok) return;
        for (const e of result.errors) {
          expect(e.message.length).toBeGreaterThan(0);
          for (const value of Object.values(e)) expect(value ?? "absent").not.toBe("absent");
        }
      }),
    );
  });
});
