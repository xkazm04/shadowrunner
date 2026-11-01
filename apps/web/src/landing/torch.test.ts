import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gazeAt, SLIDE_REACH, slideLight, type GazeAnchor } from "./torch";

const coord = fc.double({ min: -5000, max: 5000, noNaN: true });
const reach = fc.double({ min: 1, max: 4000, noNaN: true });
const anchor: fc.Arbitrary<GazeAnchor> = fc.record({ x: coord, y: coord, reachX: reach, reachY: reach });

describe("gazeAt", () => {
  it("stays inside normalised view space for any torch, finite or not", () => {
    const any = fc.oneof(coord, fc.constantFrom(Number.NaN, Infinity, -Infinity));
    fc.assert(
      fc.property(any, any, anchor, (x, y, a) => {
        const g = gazeAt({ x, y }, a);
        expect(Math.abs(g.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.y)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("looks straight ahead with the torch on the anchor", () => {
    fc.assert(
      fc.property(anchor, (a) => {
        expect(gazeAt({ x: a.x, y: a.y }, a)).toEqual({ x: 0, y: 0 });
      }),
    );
  });

  it("turns toward the torch: same sign as the offset, more with more offset, each axis alone", () => {
    fc.assert(
      fc.property(anchor, coord, coord, coord, (a, dx, dx2, dy) => {
        const near = Math.min(Math.abs(dx), Math.abs(dx2));
        const far = Math.max(Math.abs(dx), Math.abs(dx2));
        const g1 = gazeAt({ x: a.x + near, y: a.y + dy }, a);
        const g2 = gazeAt({ x: a.x + far, y: a.y }, a);
        expect(g1.x).toBeGreaterThanOrEqual(0);
        expect(g2.x).toBeGreaterThanOrEqual(g1.x - 1e-12);
        // x does not depend on y.
        expect(gazeAt({ x: a.x + near, y: a.y }, a).x).toBeCloseTo(g1.x, 12);
        const left = gazeAt({ x: a.x - far, y: a.y }, a);
        expect(left.x).toBeLessThanOrEqual(0);
        // Past the reach the turn is full (a margin over float rounding of a.x - far - a.x).
        if (far >= a.reachX * 1.01) expect(left.x).toBe(-1);
      }),
    );
  });

  it("follows the torch down as client y does", () => {
    fc.assert(
      fc.property(anchor, fc.double({ min: 0.01, max: 0.99, noNaN: true }), (a, f) => {
        expect(gazeAt({ x: a.x, y: a.y + f * a.reachY }, a).y).toBeCloseTo(f, 9);
        expect(gazeAt({ x: a.x, y: a.y - f * a.reachY }, a).y).toBeCloseTo(-f, 9);
      }),
    );
  });
});

describe("slideLight", () => {
  it("is within [0, 1] for any distance and reach", () => {
    const any = fc.oneof(fc.double(), fc.constantFrom(Number.NaN, Infinity));
    fc.assert(
      fc.property(any, any, (d, r) => {
        const v = slideLight(d, r);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("is full on the slide, dark from the reach on, and never brighter further away", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2000, noNaN: true }), fc.double({ min: 0, max: 2000, noNaN: true }), reach, (a, b, r) => {
        const [near, far] = a <= b ? [a, b] : [b, a];
        expect(slideLight(near, r)).toBeGreaterThanOrEqual(slideLight(far, r));
        expect(slideLight(0, r)).toBe(1);
        expect(slideLight(r + far, r)).toBe(0);
      }),
    );
    expect(slideLight(SLIDE_REACH / 2)).toBeCloseTo(0.5, 12);
  });
});
