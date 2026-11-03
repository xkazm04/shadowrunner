// character-control design.md "Regions" (requirement 2.1-2.2), on synthetic layers: the seven steps,
// the cavity slot (painted mask, or inferred on a jaw), and a property over random layers.
import { MAX_REGION_SLOTS, type Rig } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeImage } from "./image.js";
import { emptyMask } from "./mask.js";
import { CAVITY_SLOT, cavityHolder, regionsForRig, regionsOf } from "./regions.js";
import type { Rgba } from "./types.js";

type Rgb = [number, number, number];

/** A w x h layer painted by `paint(x, y)` (undefined = transparent). */
function layer(width: number, height: number, paint: (x: number, y: number) => Rgb | undefined): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = paint(x, y);
      if (c !== undefined) data.set([...c, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const RED: Rgb = [200, 30, 30];
const BLUE: Rgb = [30, 40, 200];
const GREY: Rgb = [128, 128, 128];
const BLACK: Rgb = [10, 10, 10];
const at = (image: Rgba, x: number, y: number): number => image.data[(y * image.width + x) * 4] ?? -1;

describe("regionsOf", () => {
  it("two colours: two slots by pixel count, named after the part, median hex; the map is R = slot + 1, G = B = 0, A = 255", () => {
    const image = layer(40, 20, (x) => (x < 25 ? RED : BLUE));
    const found = regionsOf({ name: "robe", kind: "body" }, image);
    expect(found?.regions).toEqual({
      map: "robe.regions.png",
      slots: [
        { id: "r1", name: "robe", hex: "#c81e1e" },
        { id: "r2", name: "robe 2", hex: "#1e28c8" },
      ],
    });
    if (found === undefined) return;
    expect(at(found.map, 3, 5)).toBe(1);
    expect(at(found.map, 35, 5)).toBe(2);
    for (let i = 0; i < 40 * 20; i++) expect([found.map.data[i * 4 + 1], found.map.data[i * 4 + 2], found.map.data[i * 4 + 3]]).toEqual([0, 0, 255]);
  });

  it("step 7: none for the background, one class, or under 2% opaque pixels", () => {
    const two = layer(40, 20, (x) => (x < 25 ? RED : BLUE));
    expect(regionsOf({ name: "background", kind: "static" }, two)).toBeUndefined();
    expect(regionsOf({ name: "hood", kind: "head" }, layer(40, 20, () => GREY))).toBeUndefined();
    expect(regionsOf({ name: "hood", kind: "head" }, layer(40, 40, (x, y) => (y === 0 && x < 31 ? (x < 15 ? RED : BLUE) : undefined)))).toBeUndefined();
  });

  it("step 3: a class under 4% is merged away and at most four slots remain", () => {
    // Six hues in wide stripes plus a sliver of green (1 column of 100 = 1%).
    const hues: Rgb[] = [RED, [200, 120, 20], [180, 180, 20], [20, 160, 160], BLUE, [160, 20, 160]];
    const image = layer(100, 10, (x) => (x === 99 ? [20, 200, 20] : hues[Math.floor(x / 17)] ?? RED));
    const found = regionsOf({ name: "cloak", kind: "body" }, image);
    expect(found?.regions.slots.length).toBe(MAX_REGION_SLOTS);
  });

  it("step 4: a lone speckle takes its neighbours' slot", () => {
    const image = layer(30, 30, (x, y) => (x === 15 && y === 15 ? BLUE : x < 10 ? BLUE : RED));
    const found = regionsOf({ name: "cape", kind: "body" }, image);
    if (found === undefined) throw new Error("no regions");
    expect(at(found.map, 15, 15)).toBe(at(found.map, 20, 20));
  });

  it("semi-transparent edge pixels take their opaque neighbour's slot (no painted rim under a recolour)", () => {
    const image = layer(30, 30, (x) => (x < 15 ? RED : BLUE));
    for (let y = 0; y < 30; y++) image.data[(y * 30 + 29) * 4 + 3] = 60;
    const found = regionsOf({ name: "cape", kind: "body" }, image);
    if (found === undefined) throw new Error("no regions");
    expect(at(found.map, 29, 10)).toBe(at(found.map, 25, 10));
  });

  it("a painted cavity mask is its own slot `cavity` named mouth, kept even under 4%", () => {
    const image = layer(50, 50, (x, y) => (x >= 20 && x < 25 && y >= 20 && y < 25 ? BLACK : y < 25 ? RED : GREY));
    const cavity = emptyMask(50, 50);
    for (let y = 20; y < 25; y++) for (let x = 20; x < 25; x++) cavity.data[y * 50 + x] = 255;
    const found = regionsOf({ name: "head", kind: "head" }, image, { cavity });
    const slot = found?.regions.slots.find((s) => s.id === CAVITY_SLOT);
    expect(slot).toEqual({ id: "cavity", name: "mouth", hex: "#0a0a0a" });
    expect(found?.regions.slots.filter((s) => s.id !== CAVITY_SLOT).map((s) => s.id)).toEqual(["r1", "r2"]);
  });

  it("a jaw with no mask: the dark, grey, enclosed class in its upper half is the cavity; elsewhere it is not", () => {
    const mouth = (x: number, y: number): Rgb => (x >= 10 && x < 30 && y >= 3 && y < 8 ? BLACK : RED);
    const jaw = regionsOf({ name: "jaw", kind: "jaw" }, layer(40, 20, mouth));
    expect(jaw?.regions.slots.map((s) => s.id)).toEqual(["r1", "cavity"]);
    const low = regionsOf({ name: "jaw", kind: "jaw" }, layer(40, 20, (x, y) => mouth(x, y - 10)));
    expect(low?.regions.slots.map((s) => s.id)).toEqual(["r1", "r2"]);
    const head = regionsOf({ name: "head", kind: "head" }, layer(40, 20, mouth));
    expect(head?.regions.slots.map((s) => s.id)).toEqual(["r1", "r2"]);
  });

  it("property: any layer gives no regions or 1..4 slots with unique ids, a map within them, and the same bytes twice", () => {
    const arb = fc.record({
      w: fc.integer({ min: 1, max: 12 }),
      h: fc.integer({ min: 1, max: 12 }),
      seed: fc.uint8Array({ minLength: 12 * 12 * 4, maxLength: 12 * 12 * 4 }),
    });
    fc.assert(
      fc.property(arb, ({ w, h, seed }) => {
        const image: Rgba = { width: w, height: h, data: new Uint8ClampedArray(seed.subarray(0, w * h * 4)) };
        const a = regionsOf({ name: "p", kind: "accessory" }, image);
        const b = regionsOf({ name: "p", kind: "accessory" }, { ...image, data: image.data.slice() });
        expect(b).toEqual(a);
        if (a === undefined) return;
        const n = a.regions.slots.length;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(MAX_REGION_SLOTS);
        expect(new Set(a.regions.slots.map((s) => s.id)).size).toBe(n);
        for (const s of a.regions.slots) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
        for (let i = 0; i < w * h; i++) expect(a.map.data[i * 4] ?? 99).toBeLessThanOrEqual(n);
      }),
      { numRuns: 200, seed: 7 },
    );
  });
});

describe("regionsForRig", () => {
  it("puts the canvas cavity on the layer that holds it (the head under the jaw), writes every map, skips the background", () => {
    const head = layer(40, 40, (x, y) => (x >= 15 && x < 25 && y >= 25 && y < 30 ? BLACK : y < 20 ? RED : GREY));
    const jaw = layer(20, 10, (x) => (x < 10 ? RED : BLUE));
    const background = layer(60, 60, (x) => (x < 30 ? RED : BLUE));
    const rig: Rig = {
      version: 1,
      id: "t",
      name: "T",
      width: 60,
      height: 60,
      source: "forge",
      palette: { glow: "#ffffff", eye: "#ffffff", rim: "#ffffff", mouth: "#000000" },
      layers: [
        { name: "background", z: 1, kind: "static", file: "background.png", bbox: [0, 0, 60, 60], anchor: [30, 30] },
        { name: "head", z: 2, kind: "head", file: "head.png", bbox: [10, 10, 40, 40], anchor: [30, 50] },
        { name: "jaw", z: 3, kind: "jaw", file: "jaw.png", bbox: [20, 33, 20, 10], anchor: [30, 33] },
      ],
    };
    const cavity = emptyMask(60, 60);
    for (let y = 35; y < 40; y++) for (let x = 25; x < 35; x++) cavity.data[y * 60 + x] = 255;
    const images = new Map([["background", background], ["head", head], ["jaw", jaw]]);
    expect(cavityHolder(rig, images, cavity)).toBe("head");
    const out = regionsForRig(rig, images, cavity);
    expect(out.rig.layers[0]?.regions).toBeUndefined();
    expect(out.rig.layers[1]?.regions?.slots.some((s) => s.id === CAVITY_SLOT)).toBe(true);
    expect(out.rig.layers[2]?.regions?.map).toBe("jaw.regions.png");
    expect(Object.keys(out.files).sort()).toEqual(["head.regions.png", "jaw.regions.png"]);
    const map = decodeImage(out.files["head.regions.png"] ?? new Uint8Array());
    expect(map.ok && [map.value.width, map.value.height]).toEqual([40, 40]);
  });
});
