// forge-pipeline task 4: blurExtend, the pure fill fallback (requirement 5.3).
// Synthetic images only; no network.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blurExtend } from "./fill.js";
import type { Mask } from "./mask.js";
import type { Rgba } from "./types.js";

interface Case {
  plate: Rgba;
  hole: Mask;
}

const arbCase: fc.Arbitrary<Case> = fc
  .record({ width: fc.integer({ min: 1, max: 20 }), height: fc.integer({ min: 1, max: 20 }) })
  .chain(({ width, height }) =>
    fc.record({
      plate: fc
        .uint8Array({ minLength: width * height * 4, maxLength: width * height * 4 })
        .map((bytes) => ({ width, height, data: new Uint8ClampedArray(bytes) })),
      hole: fc
        .array(fc.integer({ min: 0, max: 255 }), { minLength: width * height, maxLength: width * height })
        // About half the pixels are hole, with partial values: any non-zero value is hole.
        .map((alphas) => ({ width, height, data: Uint8ClampedArray.from(alphas, (a) => (a < 128 ? 0 : a)) })),
    }),
  );

/** Known pixels 8-adjacent to the hole: the only colours the fill may draw on. */
function border({ plate, hole }: Case): number[] {
  const { width, height } = plate;
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (hole.data[y * width + x] !== 0) continue;
      let touches = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && hole.data[ny * width + nx] !== 0) touches = true;
        }
      }
      if (touches) out.push(y * width + x);
    }
  }
  return out;
}

/** The image (or mask, channels = 1) mirrored left to right. */
function mirror<T extends { width: number; height: number; data: Uint8ClampedArray }>(image: T, channels: number): T {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * channels;
      out.set(data.subarray(from, from + channels), (y * width + (width - 1 - x)) * channels);
    }
  }
  return { ...image, data: out };
}

/** The image (or mask) with rows and columns swapped. */
function transpose<T extends { width: number; height: number; data: Uint8ClampedArray }>(image: T, channels: number): T {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * channels;
      out.set(data.subarray(from, from + channels), (x * height + y) * channels);
    }
  }
  return { ...image, width: height, height: width, data: out };
}

function flat(width: number, height: number, rgba: [number, number, number, number]): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

function rectHole(width: number, height: number, x0: number, y0: number, x1: number, y1: number): Mask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = y0; y < y1; y++) data.fill(255, y * width + x0, y * width + x1);
  return { width, height, data };
}

describe("blurExtend", () => {
  it("property: pixels outside the hole are unchanged, and the inputs are not modified", () => {
    fc.assert(
      fc.property(arbCase, ({ plate, hole }) => {
        const before = [plate.data.join(","), hole.data.join(",")];
        const out = blurExtend(plate, hole);
        expect([out.width, out.height, out.data.length]).toEqual([plate.width, plate.height, plate.data.length]);
        for (let i = 0; i < hole.data.length; i++) {
          if (hole.data[i] === 0) expect(Array.from(out.data.subarray(i * 4, i * 4 + 4))).toEqual(Array.from(plate.data.subarray(i * 4, i * 4 + 4)));
        }
        expect([plate.data.join(","), hole.data.join(",")]).toEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it("property: every filled channel lies within the range of the hole's border pixels", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const ring = border(c);
        fc.pre(ring.length > 0);
        const out = blurExtend(c.plate, c.hole);
        for (let ch = 0; ch < 4; ch++) {
          const values = ring.map((i) => c.plate.data[i * 4 + ch] ?? 0);
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          c.hole.data.forEach((a, i) => {
            if (a === 0) return;
            const v = out.data[i * 4 + ch] ?? 0;
            expect(v).toBeGreaterThanOrEqual(lo);
            expect(v).toBeLessThanOrEqual(hi);
          });
        }
      }),
      { numRuns: 300 },
    );
  });

  it("property: mirroring or transposing the input does the same to the fill (no scan-order bias)", () => {
    fc.assert(
      fc.property(arbCase, ({ plate, hole }) => {
        const out = blurExtend(plate, hole);
        expect(blurExtend(mirror(plate, 4), mirror(hole, 1)).data.join(",")).toBe(mirror(out, 4).data.join(","));
        expect(blurExtend(transpose(plate, 4), transpose(hole, 1)).data.join(",")).toBe(transpose(out, 4).data.join(","));
      }),
      { numRuns: 200 },
    );
  });

  it("fills a hole in a flat surface with that surface exactly", () => {
    const plate = flat(30, 20, [90, 40, 120, 255]);
    plate.data.fill(0, (10 * 30 + 5) * 4, (10 * 30 + 25) * 4); // a black slot where the jaw was
    const out = blurExtend(plate, rectHole(30, 20, 5, 8, 25, 13));
    expect(out.data.join(",")).toBe(flat(30, 20, [90, 40, 120, 255]).data.join(","));
  });

  it("extends from the hole edge inward: each side of the hole takes the colour next to it", () => {
    // Left half grey 40, right half grey 200; the hole straddles the split.
    const plate = flat(40, 21, [0, 0, 0, 255]);
    for (let y = 0; y < 21; y++) for (let x = 0; x < 40; x++) plate.data.fill(x < 20 ? 40 : 200, (y * 40 + x) * 4, (y * 40 + x) * 4 + 3);
    const out = blurExtend(plate, rectHole(40, 21, 8, 4, 32, 17));
    const row = Array.from({ length: 24 }, (_, k) => out.data[(10 * 40 + 8 + k) * 4] ?? 0);
    expect(row[0]).toBeLessThan(70);
    expect(row[23]).toBeGreaterThan(170);
    for (let k = 1; k < row.length; k++) expect(row[k]).toBeGreaterThanOrEqual(row[k - 1] ?? 0);
  });

  it("returns an unchanged copy when there is no hole or nothing outside it", () => {
    const plate = flat(6, 4, [9, 8, 7, 255]);
    plate.data[0] = 200;
    const none = blurExtend(plate, rectHole(6, 4, 0, 0, 0, 0));
    expect(none.data).not.toBe(plate.data);
    expect(none.data.join(",")).toBe(plate.data.join(","));
    expect(blurExtend(plate, rectHole(6, 4, 0, 0, 6, 4)).data.join(",")).toBe(plate.data.join(","));
  });

  it("rejects a hole of another size and a bad pass count", () => {
    expect(() => blurExtend(flat(6, 4, [0, 0, 0, 255]), rectHole(4, 6, 0, 0, 1, 1))).toThrow(RangeError);
    expect(() => blurExtend(flat(6, 4, [0, 0, 0, 255]), rectHole(6, 4, 0, 0, 1, 1), { passes: -1 })).toThrow(RangeError);
    expect(() => blurExtend(flat(6, 4, [0, 0, 0, 255]), rectHole(6, 4, 0, 0, 1, 1), { passes: 1.5 })).toThrow(RangeError);
  });
});
