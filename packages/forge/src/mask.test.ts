// forge-pipeline task 3.1: rasterizeMask (requirement 4.1, ruling 3) and lumaKey (4.2, ruling 2).
// Synthetic polygons and images only; no network. The oracles below are per-pixel definitions,
// independent of the scanline sweep and distance transform under test.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  KEY_CORNER_PATCH,
  KEY_LO_MIN,
  type Mask,
  cornerKeyLo,
  dilateMask,
  featherMask,
  luma,
  lumaKey,
  rasterizeMask,
} from "./mask.js";
import type { Polygon, Rgba } from "./types.js";

/** Winding number at (px, py): signed crossings strictly right of the point, edges half-open in y. */
function winding(poly: Polygon, px: number, py: number): number {
  let w = 0;
  poly.forEach(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % poly.length] ?? [0, 0];
    const dir = y0 <= py && py < y1 ? 1 : y1 <= py && py < y0 ? -1 : 0;
    if (dir !== 0 && x0 + ((py - y0) * (x1 - x0)) / (y1 - y0) > px) w += dir;
  });
  return w;
}

/** Distance from (px, py) to the nearest polygon edge (every edge, crossing ones included). */
function edgeDistance(poly: Polygon, px: number, py: number): number {
  let best = Infinity;
  poly.forEach(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % poly.length] ?? [0, 0];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)));
  });
  return best;
}

const arbCanvas = fc.record({ width: fc.integer({ min: 4, max: 40 }), height: fc.integer({ min: 4, max: 40 }) });
/** Points on a quarter-pixel grid, reaching a little past the canvas; polygons may cross themselves. */
const arbPoly = (width: number, height: number): fc.Arbitrary<Polygon> =>
  fc.array(
    fc.tuple(fc.integer({ min: -20, max: width * 4 + 20 }), fc.integer({ min: -20, max: height * 4 + 20 })).map(
      ([x, y]): [number, number] => [x / 4, y / 4],
    ),
    { minLength: 3, maxLength: 12 },
  );
const arbFeather = fc.constantFrom(0, 0.5, 1, 1.5, 2, 3, 4.5);
const arbCase = arbCanvas.chain(({ width, height }) =>
  fc.record({ width: fc.constant(width), height: fc.constant(height), poly: arbPoly(width, height), feather: arbFeather }),
);

function eachPixel(width: number, height: number, visit: (x: number, y: number, i: number) => void): void {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) visit(x, y, y * width + x);
}

describe("rasterizeMask", () => {
  it("property: the opaque core lies inside the polygon, and any alpha means inside (non-zero rule)", () => {
    fc.assert(
      fc.property(arbCase, ({ width, height, poly, feather }) => {
        const mask = rasterizeMask(poly, width, height, feather);
        expect(mask.data).toHaveLength(width * height);
        eachPixel(width, height, (x, y, i) => {
          const inside = winding(poly, x + 0.5, y + 0.5) !== 0;
          expect((mask.data[i] ?? 0) > 0).toBe(inside);
        });
      }),
      { numRuns: 300 },
    );
  });

  it("property: the feather band is under `feather` px wide, and deeper pixels are opaque", () => {
    fc.assert(
      fc.property(arbCase, ({ width, height, poly, feather }) => {
        const mask = rasterizeMask(poly, width, height, feather);
        eachPixel(width, height, (x, y, i) => {
          const a = mask.data[i] ?? 0;
          const d = edgeDistance(poly, x + 0.5, y + 0.5);
          if (a > 0 && a < 255) expect(d).toBeLessThan(feather);
          if (a > 0 && d >= feather) expect(a).toBe(255);
        });
      }),
      { numRuns: 300 },
    );
  });

  it("property: winding twice or the other way round gives the same mask (non-zero, not even-odd)", () => {
    fc.assert(
      fc.property(arbCase, ({ width, height, poly, feather }) => {
        const once = rasterizeMask(poly, width, height, feather);
        expect(rasterizeMask([...poly, ...poly], width, height, feather)).toEqual(once);
        expect(rasterizeMask([...poly].reverse(), width, height, feather)).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });

  it("fills the centre of a self-crossing pentagram (ruling 3)", () => {
    const star: Polygon = [0, 2, 4, 1, 3].map((k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      return [20 + 18 * Math.cos(a), 20 + 18 * Math.sin(a)];
    });
    const mask = rasterizeMask(star, 40, 40, 0);
    expect(mask.data[20 * 40 + 20]).toBe(255); // winding 2 at the centre; even-odd would leave a hole
    expect(mask.data[0]).toBe(0);
  });

  it("feathers a square inward only, by distance", () => {
    const square: Polygon = [[2, 2], [18, 2], [18, 18], [2, 18]];
    const mask = rasterizeMask(square, 20, 20, 3);
    const row = Array.from(mask.data.subarray(10 * 20, 11 * 20));
    expect(row).toEqual([0, 0, 85, 170, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 170, 85, 0, 0]);
  });

  it("stays opaque where the polygon runs off the canvas", () => {
    const mask = rasterizeMask([[-5, -5], [15, -5], [15, 15], [-5, 15]], 10, 10, 3);
    expect(Array.from(mask.data).every((a) => a === 255)).toBe(true);
  });

  it("is empty for a polygon off the canvas or with no area, and rejects bad arguments", () => {
    expect(Array.from(rasterizeMask([[20, 20], [30, 20], [30, 30]], 10, 10, 3).data).every((a) => a === 0)).toBe(true);
    expect(Array.from(rasterizeMask([[1, 1], [5, 5], [9, 9]], 10, 10, 3).data).every((a) => a === 0)).toBe(true);
    expect(() => rasterizeMask([], 0, 10, 3)).toThrow(RangeError);
    expect(() => rasterizeMask([], 10, 10, -1)).toThrow(RangeError);
    expect(() => rasterizeMask([], 10, 10, Number.NaN)).toThrow(RangeError);
  });
});

const pixels = (rgbs: [number, number, number][]): Rgba => ({
  width: rgbs.length,
  height: 1,
  data: new Uint8ClampedArray(rgbs.flatMap((rgb) => [...rgb, 255])),
});
const arbRgb = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }));
const arbRange = fc
  .tuple(fc.double({ min: 0, max: 254, noNaN: true }), fc.double({ min: 0.01, max: 255, noNaN: true }))
  .map(([lo, span]) => [lo, Math.min(255, lo + span)] as const)
  .filter(([lo, hi]) => lo < hi);

describe("lumaKey", () => {
  it("property: monotonic in luma, 0 at or below lo, 255 at or above hi", () => {
    fc.assert(
      fc.property(fc.array(arbRgb, { minLength: 1, maxLength: 32 }), arbRange, (rgbs, [lo, hi]) => {
        const key = lumaKey(pixels(rgbs), lo, hi);
        const ls = rgbs.map(([r, g, b]) => luma(r, g, b));
        ls.forEach((l, i) => {
          const a = key.data[i] ?? 0;
          if (l <= lo) expect(a).toBe(0);
          if (l >= hi) expect(a).toBe(255);
          ls.forEach((m, j) => {
            if (l <= m) expect(a).toBeLessThanOrEqual(key.data[j] ?? 0);
          });
        });
      }),
      { numRuns: 300 },
    );
  });

  it("ramps linearly between lo and hi", () => {
    const key = lumaKey(pixels([[10, 10, 10], [20, 20, 20], [28, 28, 28], [14, 14, 14], [0, 0, 0], [255, 255, 255]]), 10, 28);
    expect(Array.from(key.data)).toEqual([0, 142, 255, 57, 0, 255]);
  });

  it("rejects lo >= hi", () => {
    expect(() => lumaKey(pixels([[0, 0, 0]]), 28, 28)).toThrow(RangeError);
    expect(() => lumaKey(pixels([[0, 0, 0]]), 30, 10)).toThrow(RangeError);
  });
});

function ground(width: number, height: number, grey: number): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([grey, grey, grey, 255], i);
  return { width, height, data };
}
const paint = (image: Rgba, x: number, y: number, grey: number): void =>
  image.data.set([grey, grey, grey, 255], (y * image.width + x) * 4);

describe("cornerKeyLo (ruling 2)", () => {
  it("is the brightest corner-patch luma plus 4", () => {
    const image = ground(200, 200, 6);
    paint(image, 199 - 39, 199, 14); // inside the bottom-right patch
    expect(cornerKeyLo(image)).toBeCloseTo(18, 9);
  });

  it("ignores pixels outside the four patches", () => {
    const image = ground(200, 200, 8);
    paint(image, KEY_CORNER_PATCH, 0, 250);
    paint(image, 100, 100, 250);
    paint(image, 0, 199 - KEY_CORNER_PATCH, 250);
    expect(cornerKeyLo(image)).toBeCloseTo(12, 9);
  });

  it("is at least KEY_LO_MIN, and clips the patches to a small image", () => {
    expect(cornerKeyLo(ground(200, 200, 0))).toBe(KEY_LO_MIN);
    const small = ground(20, 12, 3);
    paint(small, 10, 6, 20); // centre pixel, inside every clipped patch
    expect(cornerKeyLo(small)).toBeCloseTo(24, 9);
  });
});

// Task 4 (seams): the shape helpers cutAll uses to reach under the parts in front.
const arbShape: fc.Arbitrary<Mask> = arbCanvas.chain(({ width, height }) =>
  fc
    .array(fc.integer({ min: 0, max: 6 }), { minLength: width * height, maxLength: width * height })
    .map((draws) => ({ width, height, data: Uint8ClampedArray.from(draws, (n) => (n === 0 ? 200 : 0)) })),
);

/** Brute force: distance from pixel i to the nearest non-zero pixel centre of the shape. */
function nearest(shape: Mask, i: number): number {
  const x = i % shape.width;
  const y = Math.floor(i / shape.width);
  let best = Infinity;
  shape.data.forEach((a, j) => {
    if (a !== 0) best = Math.min(best, Math.hypot((j % shape.width) - x, Math.floor(j / shape.width) - y));
  });
  return best;
}

describe("featherMask, dilateMask", () => {
  it("property: featherMask of a hard polygon raster is rasterizeMask", () => {
    fc.assert(
      fc.property(arbCase, ({ width, height, poly, feather }) => {
        expect(featherMask(rasterizeMask(poly, width, height, 0), feather)).toEqual(rasterizeMask(poly, width, height, feather));
      }),
      { numRuns: 200 },
    );
  });

  it("property: dilateMask is 255 exactly within `radius` of the shape", () => {
    fc.assert(
      fc.property(arbShape, arbFeather, (shape, radius) => {
        const grown = dilateMask(shape, radius);
        grown.data.forEach((a, i) => expect(a).toBe(nearest(shape, i) <= radius ? 255 : 0));
      }),
      { numRuns: 150 },
    );
  });

  it("are empty for an empty shape and reject bad arguments", () => {
    const empty: Mask = { width: 5, height: 4, data: new Uint8ClampedArray(20) };
    expect(Array.from(dilateMask(empty, 3).data).every((a) => a === 0)).toBe(true);
    expect(Array.from(featherMask(empty, 3).data).every((a) => a === 0)).toBe(true);
    expect(() => featherMask(empty, -1)).toThrow(RangeError);
    expect(() => dilateMask(empty, Number.NaN)).toThrow(RangeError);
    expect(() => dilateMask({ width: 0, height: 4, data: new Uint8ClampedArray(0) }, 1)).toThrow(RangeError);
  });
});
