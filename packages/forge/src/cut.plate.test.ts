// forge-pipeline task 5 ruling (a): an open jaw must not show a hole. With a filled plate, head
// and torso are not reduced by the cores of FILL_PARTS, and the head covers their polygons.
// No network; the golden uses the committed Malakor portrait and the recorded m8 parts.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import m8 from "../test/fixtures/m8-parts.json";
import { CUT_FEATHER, type CutPart, FILL_PARTS, PLATE_PARTS, cutAll } from "./cut.js";
import { blurExtend } from "./fill.js";
import { malakorPortrait, partsOf } from "./malakor.fixture.js";
import { type Mask, featherMask, rasterizeMask } from "./mask.js";
import { toCanvas } from "./parts.js";
import { PART_NAMES, type Part, type PartName, type Rgba } from "./types.js";

function alphaAt(layer: CutPart | undefined, x: number, y: number): number {
  if (layer === undefined) return 0;
  const [bx, by, bw, bh] = layer.bbox;
  if (x < bx || y < by || x >= bx + bw || y >= by + bh) return 0;
  return layer.image.data[((y - by) * bw + (x - bx)) * 4 + 3] ?? 0;
}

/** Hard union of the named parts' polygons. */
function union(parts: readonly Part[], names: readonly PartName[], width: number, height: number): Mask {
  const out: Mask = { width, height, data: new Uint8ClampedArray(width * height) };
  for (const part of parts) {
    if (!names.includes(part.name)) continue;
    rasterizeMask(toCanvas(part.poly, width, height), width, height, 0).data.forEach((a, i) => {
      if (a !== 0) out.data[i] = 255;
    });
  }
  return out;
}

const SIZE = 48;
const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: 3, maxLength: 12 });
const arbParts: fc.Arbitrary<Part[]> = fc
  .subarray(PART_NAMES.filter((n) => n !== "head"))
  .chain((others) =>
    fc.tuple(...["head" as const, ...others].map((name) => arbPoly.map((poly): Part => ({ name, box_2d: [0, 0, 1000, 1000], poly })))),
  );
const arbGrey: fc.Arbitrary<Rgba> = fc.uint8Array({ minLength: SIZE * SIZE, maxLength: SIZE * SIZE }).map((greys) => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  greys.forEach((g, i) => data.set([g, g, g, 255], i * 4));
  return { width: SIZE, height: SIZE, data };
});

const KEPT = PART_NAMES.filter((n) => !FILL_PARTS.includes(n) && !PLATE_PARTS.includes(n));

describe("cutAll with a filled plate (ruling (a))", () => {
  it("property: the head is opaque wherever the lifted parts' union is, unless a hat, crown or hair core is in front", () => {
    fc.assert(
      fc.property(arbParts, arbGrey, arbGrey, (parts, portrait, plate) => {
        const { layers } = cutAll(portrait, parts, { plate });
        const head = layers.find((l) => l.name === "head");
        const inner = featherMask(union(parts, FILL_PARTS, SIZE, SIZE), CUT_FEATHER).data;
        const kept = layers.filter((l) => KEPT.includes(l.name));
        const holes: string[] = [];
        for (let i = 0; i < SIZE * SIZE; i++) {
          const x = i % SIZE;
          const y = Math.floor(i / SIZE);
          if (inner[i] !== 255 || kept.some((l) => alphaAt(l, x, y) === 255)) continue;
          if (alphaAt(head, x, y) !== 255) holes.push(`(${x}, ${y})`);
        }
        expect(holes).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("property: only a lifted part's core may overlap a head or torso core; all other cores stay disjoint", () => {
    fc.assert(
      fc.property(arbParts, arbGrey, arbGrey, (parts, portrait, plate) => {
        const { layers } = cutAll(portrait, parts, { plate });
        const shared: string[] = [];
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            layers.forEach((front, k) => {
              if (alphaAt(front, x, y) !== 255) return;
              for (const back of layers.slice(k + 1)) {
                const allowed = FILL_PARTS.includes(front.name) && PLATE_PARTS.includes(back.name);
                if (!allowed && alphaAt(back, x, y) > 0) shared.push(`(${x}, ${y}): ${front.name} over ${back.name}`);
              }
            });
          }
        }
        expect(shared).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("golden: on the Malakor portrait the head layer is opaque under the jaw, eyes and monocle", () => {
    const portrait = malakorPortrait();
    const parts = partsOf(m8);
    const { width, height } = portrait;
    const plate = blurExtend(portrait, union(parts, FILL_PARTS, width, height));
    const filled = cutAll(portrait, parts, { plate });
    const bare = cutAll(portrait, parts);
    const headOf = (layers: CutPart[]): CutPart | undefined => layers.find((l) => l.name === "head");
    const crown = filled.layers.find((l) => l.name === "crown");
    for (const name of ["jaw", "eye_l", "eye_r", "monocle"] as const) {
      const core = rasterizeMask(toCanvas(parts.find((p) => p.name === name)?.poly ?? [], width, height), width, height, CUT_FEATHER).data;
      let area = 0;
      let holes = 0;
      let bareCovered = 0;
      core.forEach((a, i) => {
        const x = i % width;
        const y = Math.floor(i / width);
        if (a !== 255 || alphaAt(crown, x, y) === 255) return;
        area++;
        if (alphaAt(headOf(filled.layers), x, y) !== 255) holes++;
        if (alphaAt(headOf(bare.layers), x, y) > 0) bareCovered++;
      });
      expect(area, name).toBeGreaterThan(1000);
      expect(holes, `${name}: head pixels missing on the plate`).toBe(0);
      expect(bareCovered, `${name}: without a plate the head gives way`).toBe(0);
    }
  });
});
