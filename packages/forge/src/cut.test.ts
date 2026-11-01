// forge-pipeline task 3.2: cutLayer, cutAll (requirements 4.3, 4.4; rulings 2 and 4); the reach under\n// parts in front comes from task 4 (seams, checked in seams.test.ts).
// Synthetic images only; no network. The hood golden uses the polygons the 2026-11-01 spike
// recorded for the Announcer of Dead Air, whose hood came back as `hat` and contains the face.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import announcer from "../test/fixtures/spike-announcer-of-dead-air-parts.json";
import { CUT_FEATHER, CUT_ORDER, type CutPart, HOOD_SHARE, bboxOfMask, cutAll, cutLayer, hoodShare, seamReach } from "./cut.js";
import { type Mask, dilateMask, rasterizeMask } from "./mask.js";
import { parseParts, toCanvas } from "./parts.js";
import { PART_NAMES, type Part, type PartName, type Polygon, type Rgba } from "./types.js";

function image(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
/** Colour encodes position, so a cut pixel shows where on the canvas it came from. Luma >= 29. */
const positional = (width: number, height: number): Rgba => image(width, height, (x, y) => [x & 255, y & 255, 255, 255]);
const flat = (width: number, height: number, grey: number): Rgba => image(width, height, () => [grey, grey, grey, 255]);

/** A part from a canvas-px rectangle on a size x size canvas (model coords are 0..1000). */
function rect(name: PartName, size: number, x0: number, y0: number, x1: number, y1: number): Part {
  const s = (v: number): number => Math.round((v * 1000) / size);
  return { name, box_2d: [s(y0), s(x0), s(y1), s(x1)], poly: [[s(y0), s(x0)], [s(y0), s(x1)], [s(y1), s(x1)], [s(y1), s(x0)]] };
}

/** The named layer; fails the test when it is missing. */
function must(layers: CutPart[], name: PartName): CutPart {
  const layer = layers.find((l) => l.name === name);
  if (layer === undefined) throw new Error(`no ${name} layer`);
  return layer;
}

/** A layer's alpha at canvas (x, y), 0 outside its bbox. */
function alphaAt(layer: CutPart, x: number, y: number): number {
  const [bx, by, bw, bh] = layer.bbox;
  if (x < bx || y < by || x >= bx + bw || y >= by + bh) return 0;
  return layer.image.data[((y - by) * bw + (x - bx)) * 4 + 3] ?? 0;
}
const alphas = (layer: CutPart): number[] => Array.from(layer.image.data).filter((_, i) => i % 4 === 3);
/** A layer as plain values, cheap to compare (vitest's deep equality is slow on typed arrays). */
const digest = (layer: CutPart): { name: PartName; bbox: number[]; size: number[]; data: string } => ({
  name: layer.name,
  bbox: layer.bbox,
  size: [layer.image.width, layer.image.height],
  data: layer.image.data.join(","),
});

describe("bboxOfMask and cutLayer", () => {
  it("crops to the mask's bbox and multiplies alpha", () => {
    const portrait = image(8, 6, (x, y) => [x, y, 7, 200]);
    const mask: Mask = { width: 8, height: 6, data: new Uint8ClampedArray(48) };
    mask.data[1 * 8 + 2] = 255;
    mask.data[4 * 8 + 5] = 128;
    expect(bboxOfMask(mask)).toEqual([2, 1, 4, 4]);
    const cut = cutLayer(portrait, mask);
    expect(cut?.bbox).toEqual([2, 1, 4, 4]);
    expect(cut?.image.width).toBe(4);
    expect(cut?.image.height).toBe(4);
    expect(Array.from(cut?.image.data.subarray(0, 4) ?? [])).toEqual([2, 1, 7, 200]);
    expect(Array.from(cut?.image.data.subarray((3 * 4 + 3) * 4, (3 * 4 + 3) * 4 + 4) ?? [])).toEqual([5, 4, 7, 100]);
    expect(cut?.image.data[(0 * 4 + 1) * 4 + 3]).toBe(0); // outside the mask, inside the bbox
  });

  it("returns undefined for an empty mask and rejects a size mismatch", () => {
    const empty: Mask = { width: 4, height: 4, data: new Uint8ClampedArray(16) };
    expect(bboxOfMask(empty)).toBeUndefined();
    expect(cutLayer(flat(4, 4, 9), empty)).toBeUndefined();
    expect(() => cutLayer(flat(5, 4, 9), empty)).toThrow(RangeError);
  });
});

const SIZE = 48;
const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: 3, maxLength: 12 });
const arbParts: fc.Arbitrary<Part[]> = fc
  .subarray(PART_NAMES.filter((n) => n !== "head"))
  .chain((others) =>
    fc.tuple(...["head" as const, ...others].map((name) => arbPoly.map((poly): Part => ({ name, box_2d: [0, 0, 1000, 1000], poly })))),
  )
  .chain((parts) => fc.shuffledSubarray(parts, { minLength: parts.length }));
const arbPortrait: fc.Arbitrary<Rgba> = fc.uint8Array({ minLength: SIZE * SIZE, maxLength: SIZE * SIZE }).map((greys) =>
  image(SIZE, SIZE, (x, y) => {
    const g = greys[y * SIZE + x] ?? 0;
    return [g, g, g, 255];
  }),
);

describe("cutAll", () => {
  it("property: cores are disjoint; behind a fully opaque pixel no layer keeps any alpha", () => {
    fc.assert(
      fc.property(arbParts, arbPortrait, (parts, portrait) => {
        const { layers } = cutAll(portrait, parts);
        const shared: string[] = [];
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            const at = layers.map((l) => alphaAt(l, x, y));
            const first = at.indexOf(255);
            if (first >= 0 && at.some((a, k) => k > first && a > 0)) shared.push(`(${x}, ${y}): ${at.join(" ")}`);
          }
        }
        expect(shared).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("property: layers come out front to back, reach past their own polygon only under parts in front, and ignore input order", () => {
    fc.assert(
      fc.property(arbParts, (parts) => {
        const portrait = positional(SIZE, SIZE);
        const result = cutAll(portrait, parts);
        const names = [...result.layers.map((l) => l.name), ...result.empty];
        expect(names.sort()).toEqual(parts.map((p) => p.name).sort());
        const order = result.layers.map((l) => CUT_ORDER.indexOf(l.name));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        const raster = (part: Part | undefined, feather: number): Mask =>
          rasterizeMask(toCanvas(part?.poly ?? [], SIZE, SIZE), SIZE, SIZE, feather);
        const hard = (part: Part): Mask => raster(part, 0);
        for (const layer of result.layers) {
          const part = parts.find((p) => p.name === layer.name);
          const own = raster(part, 0);
          const feathered = raster(part, CUT_FEATHER);
          const near = dilateMask(own, seamReach(CUT_FEATHER));
          const front = parts.filter((p) => CUT_ORDER.indexOf(p.name) < CUT_ORDER.indexOf(layer.name)).map(hard);
          let stray = 0;
          for (let i = 0; i < SIZE * SIZE; i++) {
            if (alphaAt(layer, i % SIZE, Math.floor(i / SIZE)) <= (feathered.data[i] ?? 0)) continue;
            // Extra alpha inside its own polygon comes from a band pushed under a neighbour.
            if (own.data[i] !== 0) continue;
            if (near.data[i] !== 255 || !front.some((m) => m.data[i] !== 0)) stray++;
          }
          expect(stray, layer.name).toBe(0);
        }
        const reversed = cutAll(portrait, [...parts].reverse());
        expect({ ...reversed, layers: reversed.layers.map(digest) }).toEqual({ ...result, layers: result.layers.map(digest) });
      }),
      { numRuns: 100 },
    );
  });

  it("cuts the front part whole and takes it out of the parts behind (requirement 4.4)", () => {
    const parts = [rect("head", 40, 4, 4, 36, 36), rect("eye_l", 40, 10, 10, 20, 20)];
    const { layers } = cutAll(positional(40, 40), parts);
    const own = rasterizeMask(toCanvas(parts[1]?.poly ?? [], 40, 40), 40, 40, 3);
    expect(must(layers, "eye_l").bbox).toEqual(bboxOfMask(own));
    expect(alphaAt(must(layers, "eye_l"), 15, 15)).toBe(255);
    expect(alphaAt(must(layers, "head"), 15, 15)).toBe(0);
    expect(alphaAt(must(layers, "head"), 30, 30)).toBe(255);
    expect(Array.from(must(layers, "head").image.data.subarray(0, 3))).toEqual([4, 4, 255]); // canvas (4, 4)
  });

  it("keys the ground out of crown, hair and accessory only, with lo measured from the corners (ruling 2)", () => {
    // Ground luma 14 (above the old constant lo = 10), a bright band clear of the corner patches.
    const portrait = image(128, 128, (_, y) => (y >= 56 && y < 72 ? [200, 200, 200, 255] : [14, 14, 14, 255]));
    const whole = (name: PartName): Part => rect(name, 128, 0, 0, 128, 128);
    const head = rect("head", 128, 0, 0, 2, 2);
    for (const name of ["crown", "hair", "accessory"] as const) {
      const result = cutAll(portrait, [head, whole(name)]);
      expect(result.keyLo).toBeCloseTo(18, 9);
      expect(alphaAt(must(result.layers, name), 64, 20)).toBe(0); // ground keyed out fully
      expect(alphaAt(must(result.layers, name), 64, 64)).toBe(255);
    }
    for (const name of ["hat", "monocle", "torso"] as const) {
      const { layers } = cutAll(portrait, [head, whole(name)]);
      expect(alphaAt(must(layers, name), 64, 20)).toBe(255);
    }
  });

  it("caps lo below KEY_HI when a corner is bright", () => {
    expect(cutAll(flat(16, 16, 200), [rect("head", 16, 2, 2, 8, 8)]).keyLo).toBe(27);
  });

  it("cuts head and torso from the plate under the lifted parts and from the portrait elsewhere (task 9)", () => {
    const parts = [rect("head", 32, 0, 0, 16, 16), rect("torso", 32, 0, 16, 32, 32), rect("eye_l", 32, 4, 4, 12, 12), rect("jaw", 32, 16, 0, 32, 16)];
    const { layers } = cutAll(flat(32, 32, 50), parts, { plate: flat(32, 32, 90) });
    const pixel = (layer: CutPart, x: number, y: number): number => layer.image.data[((y - layer.bbox[1]) * layer.bbox[2] + x - layer.bbox[0]) * 4] ?? -1;
    expect(pixel(must(layers, "head"), 8, 8)).toBe(90); // deep under the eye
    expect(pixel(must(layers, "head"), 1, 1)).toBe(50); // outside every lifted region
    expect(pixel(must(layers, "torso"), 2, 30)).toBe(50);
    expect(pixel(must(layers, "jaw"), 24, 8)).toBe(50);
    expect(alphaAt(must(layers, "eye_l"), 4, 4)).toBe(255); // opaque over its whole polygon
    expect(alphaAt(must(layers, "eye_l"), 3, 8)).toBeGreaterThan(0); // and feathered outward
    expect(() => cutAll(flat(32, 32, 50), parts, { plate: flat(16, 32, 90) })).toThrow(RangeError);
  });

  it("reports parts left with no alpha", () => {
    const parts = [rect("head", 32, 4, 4, 28, 28), rect("jaw", 32, 4, 4, 28, 28)];
    const result = cutAll(flat(32, 32, 99), parts, { feather: 0 });
    expect(result.layers.map((l) => l.name)).toEqual(["jaw"]);
    expect(result.empty).toEqual(["head"]);
  });
});

describe("hoods (ruling 4)", () => {
  // Head 20x10 at (10, 10); the hat covers its top `rows` rows and spreads well around it.
  const hooded = (rows: number): Part[] => [rect("head", 40, 10, 10, 30, 20), rect("hat", 40, 0, 0, 40, 10 + rows)];

  it("measures the share of the head inside the hat", () => {
    const [head, hat] = hooded(7).map((p) => toCanvas(p.poly, 40, 40));
    expect(hoodShare(head ?? [], hat ?? [], 40, 40)).toBeCloseTo(0.7, 9);
    expect(hoodShare([[0, 0], [0.4, 0], [0, 0.4]], hat ?? [], 40, 40)).toBe(0); // no pixel centre inside
  });

  it("over HOOD_SHARE, the hat gives the head its pixels", () => {
    const { layers, hood } = cutAll(positional(40, 40), hooded(7), { feather: 0 });
    expect(hood).toBe(true);
    expect(alphaAt(must(layers, "head"), 20, 12)).toBe(255);
    expect(alphaAt(must(layers, "hat"), 20, 12)).toBe(0);
    expect(alphaAt(must(layers, "hat"), 5, 5)).toBe(255);
  });

  it(`at or under HOOD_SHARE (${HOOD_SHARE}), the hat stays in front of the head`, () => {
    for (const rows of [5, 6]) {
      const { layers, hood } = cutAll(positional(40, 40), hooded(rows), { feather: 0 });
      expect(hood).toBe(false);
      expect(alphaAt(must(layers, "hat"), 20, 12)).toBe(255);
      expect(alphaAt(must(layers, "head"), 20, 12)).toBe(0);
    }
  });

  it("golden: the Announcer's hood gives up the face, eyes and jaw", () => {
    const parsed = parseParts(announcer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { parts } = parsed.value;
    const poly = (name: PartName): Polygon => toCanvas(parts.find((p) => p.name === name)?.poly ?? [], 1024, 1024);
    const hard = (name: PartName): Mask => rasterizeMask(poly(name), 1024, 1024, 0);
    const result = cutAll(positional(1024, 1024), parts);
    expect(result.hood).toBe(true);
    expect(result.empty).toEqual([]);

    // The hat keeps no alpha in the opaque core of the head, eyes or jaw (in their feather
    // bands it keeps only what they leave).
    const hat = must(result.layers, "hat");
    for (const name of ["head", "eye_l", "eye_r", "jaw"] as const) {
      let leaked = 0;
      rasterizeMask(poly(name), 1024, 1024, 3).data.forEach((a, i) => {
        if (a === 255 && alphaAt(hat, i % 1024, Math.floor(i / 1024)) > 0) leaked++;
      });
      expect(leaked, `hat alpha inside ${name}`).toBe(0);
    }
    // The head keeps its polygon apart from what the eyes and jaw take in front of it, less the
    // feather bands. Without ruling 4 the hat would have taken all of it.
    const front = (["eye_l", "eye_r", "jaw"] as const).map(hard);
    const headOwn = hard("head").data.reduce((s, a, i) => s + (a === 255 && front.every((m) => m.data[i] === 0) ? 1 : 0), 0);
    const headOpaque = alphas(must(result.layers, "head")).filter((a) => a === 255).length;
    expect(headOpaque / headOwn).toBeGreaterThan(0.9);

    expect({
      share: Number(hoodShare(poly("head"), poly("hat"), 1024, 1024).toFixed(4)),
      layers: result.layers.map((l) => ({
        name: l.name,
        bbox: l.bbox,
        opaque: alphas(l).filter((a) => a === 255).length,
        partial: alphas(l).filter((a) => a > 0 && a < 255).length,
      })),
    }).toMatchInlineSnapshot(`
      {
        "layers": [
          {
            "bbox": [
              563,
              420,
              80,
              85,
            ],
            "name": "eye_l",
            "opaque": 4272,
            "partial": 637,
          },
          {
            "bbox": [
              391,
              421,
              82,
              84,
            ],
            "name": "eye_r",
            "opaque": 4035,
            "partial": 642,
          },
          {
            "bbox": [
              146,
              143,
              741,
              705,
            ],
            "name": "hat",
            "opaque": 192591,
            "partial": 9497,
          },
          {
            "bbox": [
              166,
              26,
              679,
              251,
            ],
            "name": "crown",
            "opaque": 32097,
            "partial": 5255,
          },
          {
            "bbox": [
              378,
              590,
              288,
              185,
            ],
            "name": "jaw",
            "opaque": 13181,
            "partial": 725,
          },
          {
            "bbox": [
              342,
              327,
              347,
              288,
            ],
            "name": "head",
            "opaque": 69051,
            "partial": 0,
          },
          {
            "bbox": [
              35,
              678,
              978,
              338,
            ],
            "name": "torso",
            "opaque": 159144,
            "partial": 5730,
          },
        ],
        "share": 1,
      }
    `);
  });
});
