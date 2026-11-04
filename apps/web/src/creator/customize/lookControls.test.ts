// character-control task 4: the look reducer's region and shape actions, and the library's checked
// read and persistence of `regions` / `shape` (invalid parts dropped, never the whole look).
import { clampShape, defaultLook, IDENTITY_SHAPE, isIdentityShape, SHAPE_LIMITS, type Look, type PartShape } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { memoryLibrary, type CharacterRecord } from "../library/libraryStore";
import { testRig } from "../testFixtures";
import { lookReducer } from "./lookReducer";

const rig = {
  ...testRig(),
  layers: testRig().layers.map((l) => (l.name === "head" ? { ...l, regions: { map: "head.regions.png", slots: [{ id: "r1", name: "hood", hex: "#334455" }] } } : l)),
};
const base = (): Look => defaultLook(rig);
const KEYS = Object.keys(IDENTITY_SHAPE) as (keyof PartShape)[];

describe("lookReducer: regions", () => {
  it("sets a region (lower-cased), refuses a non-colour, and a null or omitted value deletes the key and then the field", () => {
    const set = lookReducer(base(), { type: "region", key: "head/r1", value: "#FF0000" });
    expect(set.regions).toEqual({ "head/r1": "#ff0000" });
    expect(lookReducer(set, { type: "region", key: "head/r1", value: "red" })).toBe(set);
    expect(lookReducer(set, { type: "region", key: "head/r1", value: null }).regions).toBeUndefined();
    expect(lookReducer(set, { type: "region", key: "head/r1" })).toEqual(base());
    const unchanged = base();
    expect(lookReducer(unchanged, { type: "region", key: "head/r1" })).toBe(unchanged);
  });

  it("other actions keep regions and shape", () => {
    let look = lookReducer(base(), { type: "region", key: "head/r1", value: "#00ff00" });
    look = lookReducer(look, { type: "shape", layer: "crown", value: { size: 1.2 } });
    look = lookReducer(look, { type: "emotion", emotion: "smug" });
    look = lookReducer(look, { type: "toggle", layer: "jaw" });
    look = lookReducer(look, { type: "palette", key: "eye", value: "#123456" });
    expect(look.regions).toEqual({ "head/r1": "#00ff00" });
    expect(look.shape?.crown?.size).toBe(1.2);
  });
});

describe("lookReducer: shape", () => {
  it("merges with the current shape and clamps every field (property)", () => {
    const value = fc.record(Object.fromEntries(KEYS.map((k) => [k, fc.double({ min: -1000, max: 1000, noNaN: true })])) as Record<keyof PartShape, fc.Arbitrary<number>>, {
      requiredKeys: [],
    });
    fc.assert(
      fc.property(value, value, (a, b) => {
        const once = lookReducer(base(), { type: "shape", layer: "crown", value: a });
        const twice = lookReducer(once, { type: "shape", layer: "crown", value: b });
        const want = clampShape({ ...(once.shape?.crown ?? IDENTITY_SHAPE), ...b });
        if (isIdentityShape(want)) expect(twice.shape).toBeUndefined();
        else expect(twice.shape?.crown).toEqual(want);
        for (const k of KEYS) {
          const v = twice.shape?.crown?.[k] ?? IDENTITY_SHAPE[k];
          expect(v).toBeGreaterThanOrEqual(SHAPE_LIMITS[k][0]);
          expect(v).toBeLessThanOrEqual(SHAPE_LIMITS[k][1]);
        }
      }),
    );
  });

  it("an identity result deletes the key; shapeReset and shapeResetAll empty the map and drop the field", () => {
    const big = lookReducer(base(), { type: "shape", layer: "crown", value: { size: 9 } });
    expect(big.shape?.crown?.size).toBe(SHAPE_LIMITS.size[1]);
    expect(lookReducer(big, { type: "shape", layer: "crown", value: { size: 1 } }).shape).toBeUndefined();
    const two = lookReducer(big, { type: "shape", layer: "jaw", value: { rot: -5 } });
    expect(Object.keys(lookReducer(two, { type: "shapeReset", layer: "crown" }).shape ?? {})).toEqual(["jaw"]);
    expect(lookReducer(two, { type: "shapeResetAll" }).shape).toBeUndefined();
    const plain = base();
    expect(lookReducer(plain, { type: "shapeReset", layer: "crown" })).toBe(plain);
    expect(lookReducer(plain, { type: "shapeResetAll" })).toBe(plain);
  });
});

describe("the library keeps regions and shape", () => {
  it("a look with regions and shape survives saveLook and a read back", async () => {
    const store = memoryLibrary();
    const assets: Record<string, Blob> = {};
    for (const file of [...rig.layers.map((l) => l.file), "head.regions.png"]) assets[file] = new Blob([file]);
    const record: CharacterRecord = { id: rig.id, rig, assets, look: base(), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
    await store.put(record);
    let look = lookReducer(base(), { type: "shape", layer: "crown", value: { sx: 1.25, rot: 99 } });
    look = lookReducer(look, { type: "region", key: "head/r1", value: "#aa0000" });
    await store.saveLook(rig.id, look);
    const entry = await store.get(rig.id);
    expect(entry?.kind).toBe("ok");
    if (entry?.kind !== "ok") return;
    expect(entry.record.look.shape).toEqual({ crown: { ...IDENTITY_SHAPE, sx: 1.25, rot: SHAPE_LIMITS.rot[1] } });
    expect(entry.record.look.regions).toEqual({ "head/r1": "#aa0000" });
    // The region map is kept with the layer images.
    expect(Object.keys(entry.record.assets)).toContain("head.regions.png");
    await store.saveLook(rig.id, lookReducer(entry.record.look, { type: "shapeResetAll" }));
    const reset = await store.get(rig.id);
    expect(reset?.kind === "ok" ? reset.record.look.shape : "damaged").toBeUndefined();
  });
});
