// cast-forge task 3: the mouth cavity (mouth.ts) and the jaw's lip-line top edge in cutNamed.
// Properties over random jaw polygons and portraits: the cavity hangs from the lip line, no deeper
// than the drop, inside the region the jaw covers at rest; every cavity pixel is one of its tones
// exactly (hard edges, no blend) and every other pixel is untouched; the jaw's lifted region and its
// cut layer have nothing above the lip line; at rest the jaw layer is opaque over the whole cavity.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cutNamed, liftedNamed } from "./cutNamed.js";
import { type Mask, rasterizeMask } from "./mask.js";
import { CAVITY_DEEP, liftedJaw, lipLine, paintCavity } from "./mouth.js";
import { toCanvas } from "./parts.js";
import { composePlate, fallbackFill } from "./plate.js";
import type { NamedPart, Rgba } from "./types.js";

const SIZE = 48;
const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: 3, maxLength: 8 });
const arbImage: fc.Arbitrary<Rgba> = fc.uint8Array({ minLength: SIZE * SIZE * 3, maxLength: SIZE * SIZE * 3 }).map((bytes) => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data.set([bytes[i * 3] ?? 0, bytes[i * 3 + 1] ?? 0, bytes[i * 3 + 2] ?? 0, 255], i * 4);
  return { width: SIZE, height: SIZE, data };
});
const arbOptions = fc.record({ glow: fc.constantFrom("#ffd60a", "#ff2020"), cell: fc.integer({ min: 1, max: 6 }) }, { requiredKeys: [] });
const hardOf = (poly: [number, number][]): Mask => rasterizeMask(toCanvas(poly, SIZE, SIZE), SIZE, SIZE, 0);
const copy = (img: Rgba): Rgba => ({ width: img.width, height: img.height, data: img.data.slice() });

describe("paintCavity", () => {
  it("property: hangs from the lip line, at most dropPx deep, inside the lifted region, in its own tones only", () => {
    fc.assert(
      fc.property(arbPoly, arbImage, fc.integer({ min: 0, max: 20 }), arbOptions, (poly, portrait, drop, options) => {
        const hard = hardOf(poly);
        const lifted = liftedJaw(hard);
        const surface = copy(portrait);
        const { mask, tones } = paintCavity(surface, portrait, hard, lifted, drop, options);
        const top = lipLine(hard);
        const palette = [tones.shadow, tones.deep, ...(tones.glow === undefined ? [] : [tones.glow])].map((t) => t.join(","));
        const wrong: string[] = [];
        for (let i = 0; i < SIZE * SIZE && wrong.length < 5; i++) {
          const pixel = Array.from(surface.data.subarray(i * 4, i * 4 + 4));
          const x = i % SIZE;
          const y = (i - x) / SIZE;
          if (mask.data[i] === 0) {
            if (pixel.join() !== Array.from(portrait.data.subarray(i * 4, i * 4 + 4)).join()) wrong.push(`(${x}, ${y}) changed outside the cavity`);
            continue;
          }
          const lip = top[x] ?? -1;
          if (lifted.data[i] === 0) wrong.push(`(${x}, ${y}) outside the lifted region`);
          if (lip < 0 || y < lip || y >= lip + drop) wrong.push(`(${x}, ${y}) not within ${drop} px under the lip line ${lip}`);
          if (pixel[3] !== 255 || !palette.includes(pixel.slice(0, 3).join(","))) wrong.push(`(${x}, ${y}) is ${pixel.join()}, not a cavity tone`);
        }
        expect(wrong).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("property: the deepest column is the drop (within one px, or one cell when stepped) when nothing clips it and the jaw is wide", () => {
    fc.assert(
      fc.property(fc.integer({ min: 6, max: 14 }), fc.integer({ min: 1, max: 3 }), fc.integer({ min: 3, max: 12 }), (halfWidth, cell, drop) => {
        // A flat lip line across a wide box, the whole canvas lifted.
        const hard = hardOf([[400, 500 - halfWidth * 20], [400, 500 + halfWidth * 20], [600, 500 + halfWidth * 20], [600, 500 - halfWidth * 20]]);
        const all: Mask = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE).fill(255) };
        const grey: Rgba = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(200) };
        const { mask } = paintCavity(copy(grey), grey, hard, all, drop, { cell });
        const depth = new Map<number, number>();
        mask.data.forEach((a, i) => a !== 0 && depth.set(i % SIZE, (depth.get(i % SIZE) ?? 0) + 1));
        const deepest = Math.max(0, ...depth.values());
        expect(deepest).toBeLessThanOrEqual(drop);
        expect(deepest).toBeGreaterThanOrEqual(drop - Math.max(1, cell));
      }),
    );
  });

  it("takes its deep tone from the lip's own colour (hue kept), not a fixed grey", () => {
    const red: Rgba = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4) };
    for (let i = 0; i < SIZE * SIZE; i++) red.data.set([200, 100, 50, 255], i * 4);
    const hard = hardOf([[400, 300], [400, 700], [600, 700], [600, 300]]);
    const { tones } = paintCavity(copy(red), red, hard, liftedJaw(hard), 6);
    expect(tones.deep).toEqual([200, 100, 50].map((v) => Math.round(v * CAVITY_DEEP)));
  });
});

describe("the jaw's lip line in cutNamed", () => {
  it("property: on a plate, the jaw's lifted region and layer have nothing above the lip line, and cover the cavity opaque at rest", () => {
    fc.assert(
      fc.property(arbPoly, arbPoly, arbImage, fc.integer({ min: 5, max: 100 }), (headPoly, jawPoly, portrait, dropK) => {
        const drop = dropK / 1000;
        const parts: NamedPart[] = [
          { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: headPoly },
          { name: "lips", role: "jaw", box_2d: [0, 0, 1000, 1000], poly: jawPoly, drop },
        ];
        const lifted = liftedNamed(parts, SIZE, SIZE);
        const result = cutNamed(portrait, parts, { plate: composePlate(portrait, fallbackFill(portrait, lifted), lifted), feather: 2 });
        const hard = hardOf(jawPoly);
        const top = lipLine(hard);
        const jawLifted = liftedJaw(hard);
        const { mask } = paintCavity(copy(portrait), portrait, hard, jawLifted, Math.round(drop * SIZE));
        const lips = result.layers.find((l) => l.name === "lips");
        const alphaAt = (i: number): number => {
          if (lips === undefined) return 0;
          const [bx, by, bw, bh] = lips.bbox;
          const x = (i % SIZE) - bx;
          const y = Math.floor(i / SIZE) - by;
          return x < 0 || y < 0 || x >= bw || y >= bh ? 0 : (lips.image.data[(y * bw + x) * 4 + 3] ?? 0);
        };
        const xs = [...top.keys()].filter((x) => (top[x] ?? -1) >= 0);
        const wrong: string[] = [];
        for (let i = 0; i < SIZE * SIZE && wrong.length < 5; i++) {
          const x = i % SIZE;
          const y = (i - x) / SIZE;
          const lip = xs.length === 0 ? Infinity : (top[Math.min(Math.max(x, xs[0] ?? x), xs[xs.length - 1] ?? x)] ?? 0);
          if (y < lip && jawLifted.data[i] !== 0) wrong.push(`lifted above the lip at (${x}, ${y})`);
          if (y < lip && alphaAt(i) !== 0) wrong.push(`jaw alpha above the lip at (${x}, ${y})`);
          if (mask.data[i] !== 0 && alphaAt(i) !== 255) wrong.push(`cavity at (${x}, ${y}) shows at rest`);
        }
        expect(wrong).toEqual([]);
      }),
      { numRuns: 120 },
    );
  });
});
