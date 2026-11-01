// forge-pipeline task 9 (director rulings on the 1.2 composites, 2026-11-01): the plate is the
// portrait outside the lifted parts grown by PLATE_DILATE; the background is that whole plate; at
// rest the rig gives back the portrait, and an open jaw shows no black gap. No network: synthetic
// images, plus the committed Malakor portrait with the recorded m8 parts (fill fallback).
import fc from "fast-check";
import { JAW_DROP } from "@sr/rig";
import { describe, expect, it } from "vitest";
import m8 from "../test/fixtures/m8-parts.json";
import { assembleRig } from "./assemble.js";
import { compositeRig } from "./composite.js";
import { PLATE_DILATE, cutAll, liftedRegion } from "./cut.js";
import { decodeImage } from "./image.js";
import { malakorPortrait, partsOf } from "./malakor.fixture.js";
import { type Mask, dilateMask, luma } from "./mask.js";
import { PLATE_FEATHER, composePlate, fallbackFill, plateWeight } from "./plate.js";
import { PART_NAMES, type Part, type Rgba } from "./types.js";

const SIZE = 48;
const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: 3, maxLength: 12 });
const arbParts: fc.Arbitrary<Part[]> = fc
  .subarray(PART_NAMES.filter((n) => n !== "head"))
  .chain((others) =>
    fc.tuple(...["head" as const, ...others].map((name) => arbPoly.map((poly): Part => ({ name, box_2d: [0, 0, 1000, 1000], poly })))),
  );
const arbImage: fc.Arbitrary<Rgba> = fc.uint8Array({ minLength: SIZE * SIZE * 3, maxLength: SIZE * SIZE * 3 }).map((bytes) => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data.set([bytes[i * 3] ?? 0, bytes[i * 3 + 1] ?? 0, bytes[i * 3 + 2] ?? 0, 255], i * 4);
  return { width: SIZE, height: SIZE, data };
});

const lumaAt = (image: Rgba, i: number): number => luma(image.data[i * 4] ?? 0, image.data[i * 4 + 1] ?? 0, image.data[i * 4 + 2] ?? 0);

/** Cut, assemble, decode every file, composite in a pose: what a viewer of the rig sees. */
function forged(portrait: Rgba, parts: readonly Part[], plate: Rgba): { rest: Rgba; open: (jaw: number) => Rgba } {
  const assembled = assembleRig(parts, cutAll(portrait, parts, { plate }).layers, { id: "t", name: "T", portrait, plate });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.errors));
  const images: Record<string, Rgba> = {};
  for (const [file, bytes] of Object.entries(assembled.value.files)) {
    const decoded = decodeImage(bytes);
    if (!decoded.ok) throw new Error(decoded.errors.message);
    images[file] = decoded.value;
  }
  const { rig } = assembled.value;
  return { rest: compositeRig(rig, images), open: (jaw) => compositeRig(rig, images, { jaw }) };
}

/** Pixels whose luma differs between the two images by more than `tolerance`. */
function lumaDiffs(a: Rgba, b: Rgba, tolerance: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < a.width * a.height; i++) {
    const d = Math.abs(lumaAt(a, i) - lumaAt(b, i));
    if (d > tolerance) out.push(`(${i % a.width}, ${Math.floor(i / a.width)}): ${d.toFixed(1)}`);
  }
  return out;
}

describe("composePlate", () => {
  it("property: outside the lifted region grown by PLATE_DILATE the plate is the portrait, bit for bit", () => {
    fc.assert(
      fc.property(arbParts, arbImage, arbImage, (parts, portrait, fill) => {
        const lifted = liftedRegion(parts, SIZE, SIZE);
        const plate = composePlate(portrait, fill, lifted);
        const grown = dilateMask(lifted, PLATE_DILATE).data;
        const weight = plateWeight(lifted).data;
        const wrong: number[] = [];
        for (let i = 0; i < SIZE * SIZE; i++) {
          const source = grown[i] === 0 ? portrait : weight[i] === 255 ? fill : undefined;
          if (source === undefined) continue;
          for (let c = i * 4; c < i * 4 + 4; c++) if (plate.data[c] !== source.data[c]) wrong.push(i);
        }
        expect(wrong).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("takes the fill whole from PLATE_FEATHER px inside the grown edge, and blends between", () => {
    const lifted: Mask = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64) };
    lifted.data[32 * 64 + 32] = 255;
    const black: Rgba = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
    black.data.forEach((_, c) => {
      if (c % 4 !== 3) black.data[c] = 0;
    });
    const white: Rgba = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
    const plate = composePlate(black, white, lifted);
    const at = (x: number): number => plate.data[(32 * 64 + x) * 4] ?? -1;
    expect(at(32)).toBe(255);
    expect(at(32 + PLATE_DILATE - PLATE_FEATHER)).toBe(255);
    expect(at(32 + PLATE_DILATE - 2)).toBeGreaterThan(0);
    expect(at(32 + PLATE_DILATE - 2)).toBeLessThan(255);
    expect(at(32 + PLATE_DILATE + 1)).toBe(0);
    expect(() => composePlate(black, { ...white, width: 32 }, lifted)).toThrow(RangeError);
  });
});

describe("the forged rig at rest and with the jaw open", () => {
  it("property: at rest the layers over the plate give back the portrait (luma within 8) at every pixel", () => {
    fc.assert(
      fc.property(arbParts, arbImage, arbImage, (parts, portrait, fill) => {
        const plate = composePlate(portrait, fill, liftedRegion(parts, SIZE, SIZE));
        expect(lumaDiffs(forged(portrait, parts, plate).rest, portrait, 8)).toEqual([]);
      }),
      { numRuns: 120 },
    );
  });

  const portrait = malakorPortrait();
  const parts = partsOf(m8);
  const { width, height } = portrait;
  const lifted = liftedRegion(parts, width, height);
  const plate = composePlate(portrait, fallbackFill(portrait, lifted), lifted);
  const rig = forged(portrait, parts, plate);

  it("golden (m8): the composite at rest equals the portrait within luma 8 everywhere", () => {
    expect(lumaDiffs(rig.rest, portrait, 8).slice(0, 10)).toEqual([]);
  });

  it(`golden (m8): an open jaw (${JAW_DROP} x height) shows no near-black pixel the plate did not paint`, () => {
    const NEAR_BLACK = 20;
    const drop = Math.round(JAW_DROP * height);
    const open = rig.open(drop);
    const mouth = liftedRegion(parts, width, height, ["jaw"]).data;
    const jaw = parts.find((p) => p.name === "jaw");
    expect(jaw).toBeDefined();
    const holes: string[] = [];
    let changed = 0;
    for (let i = 0; i < width * height; i++) {
      if (lumaAt(open, i) !== lumaAt(rig.rest, i)) changed++;
      if (lumaAt(open, i) >= NEAR_BLACK) continue;
      // Allowed: the mouth the plate paints under the jaw, dark pixels the plate or the portrait
      // already has there (ground, eye sockets), and the jaw's own dark pixels where it now lies.
      if (mouth[i] !== 0 || lumaAt(plate, i) < NEAR_BLACK || lumaAt(portrait, i) < NEAR_BLACK) continue;
      const from = i - drop * width;
      if (from >= 0 && lumaAt(portrait, from) < NEAR_BLACK) continue;
      holes.push(`(${i % width}, ${Math.floor(i / width)})`);
    }
    expect(changed).toBeGreaterThan(10_000);
    expect(holes.slice(0, 10)).toEqual([]);
  });
});
