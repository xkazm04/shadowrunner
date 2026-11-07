// faces.ts: the merge rule for faces that arrive after Wake (forge-creator C1).
import fc from "fast-check";
import { EXPRESSION_FAMILIES, type ExpressionFamily, type Layer, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { isAdditive, mergeFaces, newFiles, same, type Woken } from "./faces";

const assetsOf = (rig: Rig): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const l of rig.layers) {
    out[l.file] = `u:${l.file}`;
    for (const p of Object.values(l.variants ?? {})) out[p.file] = `u:${p.file}`;
  }
  return out;
};
const woken = (rig: Rig): Woken => ({ rig, assets: assetsOf(rig) });

function withFace(rig: Rig, layer: string, family: ExpressionFamily): Rig {
  return {
    ...rig,
    layers: rig.layers.map((l) =>
      l.name !== layer ? l : { ...l, variants: { ...l.variants, [family]: { file: `${l.name}.${family}.png`, bbox: [l.bbox[0], l.bbox[1], 2, 2], mode: "over" } } },
    ),
  };
}

const BASE = testRig("g1");
const NAMES = BASE.layers.map((l) => l.name);
const faceArb = fc.tuple(fc.constantFrom(...NAMES), fc.constantFrom(...EXPRESSION_FAMILIES));
/** A rig with some faces already, and a later rig with more. */
const growthArb = fc.tuple(fc.array(faceArb, { maxLength: 6 }), fc.array(faceArb, { minLength: 1, maxLength: 6 })).map(([before, more]) => {
  const a = before.reduce((r, [l, f]) => withFace(r, l, f), BASE);
  const b = more.reduce((r, [l, f]) => (r.layers.find((x) => x.name === l)?.variants?.[f] === undefined ? withFace(r, l, f) : r), a);
  return { a, b };
});

type Fault = (rig: Rig) => Rig;
const layerEdit = (fn: (l: Layer) => Layer): Fault => (rig) => ({ ...rig, layers: rig.layers.map((l, i) => (i === 2 ? fn(l) : l)) });
const FAULTS: Record<string, Fault> = {
  "a layer removed": (rig) => ({ ...rig, layers: rig.layers.filter((_, i) => i !== 3) }),
  "a layer's file changed": layerEdit((l) => ({ ...l, file: `${l.name}-v2.png` })),
  "a layer moved": layerEdit((l) => ({ ...l, bbox: [l.bbox[0] + 1, l.bbox[1], l.bbox[2], l.bbox[3]] })),
  "a layer added": (rig) => ({ ...rig, layers: [...rig.layers, { name: "iris_l", kind: "eye", file: "iris_l.png", bbox: [22, 18, 2, 2], anchor: [23, 19], z: 9 }] }),
  "the canvas changed": (rig) => ({ ...rig, width: rig.width + 1 }),
  "a face dropped": (rig) => ({ ...rig, layers: rig.layers.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== "variants")) as Layer) }),
};

describe("mergeFaces", () => {
  it("accepts a variants-only addition and fetches only the new patch files", () => {
    const a = woken(BASE);
    const b = woken(withFace(BASE, "head", "joy"));
    const merged = mergeFaces(a, b);
    expect(merged.rig).toEqual(b.rig);
    expect(newFiles(a.rig, merged.rig)).toEqual(["head.joy.png"]);
    expect(merged.assets["head.joy.png"]).toBe("u:head.joy.png");
  });

  it.each(Object.keys(FAULTS))("refuses %s and keeps the awake rig", (name) => {
    const a = woken(withFace(BASE, "head", "joy"));
    const fault = FAULTS[name];
    if (fault === undefined) throw new Error(name);
    const b = woken(withFace(fault(a.rig), "head", "anger"));
    expect(isAdditive(a.rig, b.rig)).toBe(false);
    expect(mergeFaces(a, b)).toBe(a);
  });

  it("refuses a new patch that reuses a file the rig already names, and a later rig that does not validate", () => {
    const a = woken(BASE);
    const clash: Rig = { ...BASE, layers: BASE.layers.map((l) => (l.name === "head" ? { ...l, variants: { joy: { file: "torso.png", bbox: [16, 8, 2, 2], mode: "over" } } } : l)) };
    expect(mergeFaces(a, woken(clash))).toBe(a);
    const bad = withFace(BASE, "head", "joy");
    expect(mergeFaces(a, { rig: bad, assets: {} })).toBe(a);
  });

  it("is b when b only adds faces, else a; never drops a layer or a face (property)", () => {
    fc.assert(
      fc.property(growthArb, fc.constantFrom(...Object.keys(FAULTS), "none"), ({ a, b }, faultName) => {
        const fault = FAULTS[faultName];
        const later = fault === undefined ? b : fault(b);
        const before = woken(a);
        const merged = mergeFaces(before, woken(later));
        expect(merged === before || same(merged.rig, later)).toBe(true);
        if (fault === undefined) expect(merged.rig).toEqual(later);
        else expect(merged).toBe(before);
        expect(merged.rig.layers.map((l) => l.name)).toEqual(a.layers.map((l) => l.name));
        for (const l of a.layers) {
          const kept = merged.rig.layers.find((x) => x.name === l.name);
          for (const [family, patch] of Object.entries(l.variants ?? {})) expect(kept?.variants?.[family as ExpressionFamily]).toEqual(patch);
        }
        expect(mergeFaces(merged, merged)).toBe(merged);
      }),
    );
  });
});
