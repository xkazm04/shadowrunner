import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clipPolygon, GLASS, PLATE, superellipse, svgPath, type Box, type Superellipse } from "./superellipse";

const TOL = 1e-6;

/** |x/a|^n + |y/b|^n for a point in the shape's own space (relative to the centre). */
function level(shape: Superellipse, [x, y]: readonly [number, number]): number {
  return Math.abs((x - shape.cx) / shape.a) ** shape.n + Math.abs((y - shape.cy) / shape.b) ** shape.n;
}

/** A box and a superellipse that fits inside it (design.md: the glass sits inside the plate). */
const fitted: fc.Arbitrary<{ box: Box; shape: Superellipse }> = fc
  .record({
    width: fc.double({ min: 10, max: 4000, noNaN: true }),
    height: fc.double({ min: 10, max: 4000, noNaN: true }),
    // Centre and half-axes as fractions, so a and b always fit the distance to the nearer edge.
    fx: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
    fy: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
    // Up to 0.999 of the room: a = width - cx exactly can round one ulp past the edge.
    fa: fc.double({ min: 0.01, max: 0.999, noNaN: true }),
    fb: fc.double({ min: 0.01, max: 0.999, noNaN: true }),
    n: fc.double({ min: 1, max: 12, noNaN: true }),
  })
  .map(({ width, height, fx, fy, fa, fb, n }) => {
    const cx = width * fx;
    const cy = height * fy;
    return {
      box: { width, height },
      shape: { cx, cy, a: fa * Math.min(cx, width - cx), b: fb * Math.min(cy, height - cy), n },
    };
  });

const steps = fc.integer({ min: 4, max: 512 });

/** Reads `polygon(x% y%, ...)` back to box px. */
function parsePolygon(css: string, box: Box): [number, number][] {
  const body = /^polygon\((.*)\)$/.exec(css)?.[1];
  expect(body, css.slice(0, 40)).toBeDefined();
  return (body ?? "").split(", ").map((pair) => {
    const m = /^(-?\d+(?:\.\d+)?)% (-?\d+(?:\.\d+)?)%$/.exec(pair);
    expect(m, pair).not.toBeNull();
    return [(Number(m?.[1]) / 100) * box.width, (Number(m?.[2]) / 100) * box.height];
  });
}

describe("superellipse", () => {
  it("puts every point on the curve |x/a|^n + |y/b|^n = 1, within 1e-6", () => {
    fc.assert(
      fc.property(fitted, steps, ({ shape }, count) => {
        const points = superellipse(shape, count);
        expect(points).toHaveLength(count);
        for (const p of points) expect(Math.abs(level(shape, p) - 1)).toBeLessThanOrEqual(TOL);
      }),
    );
  });

  it("stays inside the box it was fitted to", () => {
    fc.assert(
      fc.property(fitted, steps, ({ box, shape }, count) => {
        for (const [x, y] of superellipse(shape, count)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(box.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(box.height);
        }
      }),
    );
  });

  it("walks once around the centre in one direction, so the clip never crosses itself", () => {
    fc.assert(
      fc.property(fitted, steps, ({ shape }, count) => {
        const angles = superellipse(shape, count).map(([x, y]) => Math.atan2(y - shape.cy, x - shape.cx));
        // Unwrapped angle grows strictly and covers less than one full turn.
        let total = 0;
        for (let i = 1; i < angles.length; i++) {
          let d = (angles[i] ?? 0) - (angles[i - 1] ?? 0);
          if (d <= -Math.PI) d += 2 * Math.PI;
          expect(d).toBeGreaterThan(0);
          total += d;
        }
        expect(total).toBeLessThan(2 * Math.PI);
      }),
    );
  });

  it("rejects shapes and step counts that cannot make a closed clip", () => {
    const ok = GLASS;
    for (const bad of [{ a: 0 }, { b: -1 }, { n: 0 }, { n: Number.NaN }, { cx: Number.POSITIVE_INFINITY }]) {
      expect(() => superellipse({ ...ok, ...bad }, 64)).toThrow(RangeError);
    }
    for (const count of [0, 3, 2.5, Number.NaN]) expect(() => superellipse(ok, count)).toThrow(RangeError);
  });
});

describe("clipPolygon", () => {
  it("writes the points as percentages of the box that read back onto the curve within 1e-6", () => {
    // Ten decimals: the generator's worst box-to-axis ratio (2000:1, n = 12) needs about nine.
    fc.assert(
      fc.property(fitted, steps, ({ box, shape }, count) => {
        const css = clipPolygon(superellipse(shape, count), box, 10);
        const back = parsePolygon(css, box);
        expect(back).toHaveLength(count);
        for (const p of back) {
          expect(Math.abs(level(shape, p) - 1)).toBeLessThanOrEqual(TOL);
          expect(p[0]).toBeGreaterThanOrEqual(0);
          expect(p[0]).toBeLessThanOrEqual(box.width);
          expect(p[1]).toBeGreaterThanOrEqual(0);
          expect(p[1]).toBeLessThanOrEqual(box.height);
        }
      }),
    );
  });
});

describe("svgPath", () => {
  it("moves to the first point, lines through the rest and closes", () => {
    const points = superellipse(GLASS, 8);
    const d = svgPath(points, 6);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/L/g)).toHaveLength(7);
    const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(nums).toHaveLength(16);
    nums.forEach((v, i) => expect(v).toBeCloseTo(points[Math.floor(i / 2)]?.[i % 2] ?? Number.NaN, 5));
    expect(svgPath([])).toBe("");
  });
});

describe("the glass (design.md 'Glass geometry')", () => {
  it("is |x/253|^3 + |y/204|^3 = 1 about (597, 427) in the 1200x896 plate", () => {
    expect(PLATE).toEqual({ width: 1200, height: 896 });
    expect(GLASS).toEqual({ cx: 597, cy: 427, a: 253, b: 204, n: 3 });
    const points = superellipse(GLASS, 256);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(597 - 253, 6);
    expect(Math.max(...xs)).toBeCloseTo(597 + 253, 6);
    expect(Math.min(...ys)).toBeCloseTo(427 - 204, 6);
    expect(Math.max(...ys)).toBeCloseTo(427 + 204, 6);
    // The default four decimals keep the rendered clip on the curve to well under a pixel.
    const back = parsePolygon(clipPolygon(points, PLATE), PLATE);
    expect(back).toHaveLength(256);
    for (const p of back) expect(Math.abs(level(GLASS, p) - 1)).toBeLessThanOrEqual(1e-4);
  });
});
