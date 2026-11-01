import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { easeLook, EYE_WORLD, GAZE_EASE, GAZE_REACH, gazeToward, pupilCentre, PUPIL_REST, REST_LOOK } from "./Eye";

const anyNumber = fc.oneof(fc.double(), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY));
const clamp = (n: number) => (Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0);

/** The slit's bounding box in the overlay's 1024 space (see SLIT in Eye.tsx). */
const SLIT_BOX = { left: 410, right: 664, top: 382, bottom: 642 };

describe("pupilCentre", () => {
  it("only sees the gaze clamped to [-1, 1] (non-finite reads as straight ahead)", () => {
    fc.assert(
      fc.property(anyNumber, anyNumber, (x, y) => {
        expect(pupilCentre({ x, y })).toEqual(pupilCentre({ x: clamp(x), y: clamp(y) }));
      }),
    );
  });

  it("keeps the pupil centre inside the slit's bounds for every gaze", () => {
    fc.assert(
      fc.property(anyNumber, anyNumber, (x, y) => {
        const p = pupilCentre({ x, y });
        expect(p.x).toBeGreaterThanOrEqual(SLIT_BOX.left);
        expect(p.x).toBeLessThanOrEqual(SLIT_BOX.right);
        expect(p.y).toBeGreaterThanOrEqual(SLIT_BOX.top);
        expect(p.y).toBeLessThanOrEqual(SLIT_BOX.bottom);
      }),
    );
  });

  it("rests at the centre for a straight gaze, and up-left toward the set by default", () => {
    expect(pupilCentre({ x: 0, y: 0 })).toEqual(PUPIL_REST);
    const rest = pupilCentre(REST_LOOK);
    expect(rest.x).toBeLessThan(PUPIL_REST.x);
  });
});

describe("gazeToward and easeLook", () => {
  const coord = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e5, max: 1e5 });
  const scale = fc.double({ noNaN: true, min: 0.2, max: 3 });
  const layout = fc.constantFrom("landscape" as const, "portrait" as const);

  it("is clamped, centred on the eye and turned by the pointer's side, at any world scale", () => {
    fc.assert(
      fc.property(coord, coord, scale, layout, (px, py, k, lay) => {
        const size = EYE_WORLD[lay] * k;
        const eye = { left: 1000, top: 500, width: size, height: size };
        const look = gazeToward({ x: px, y: py }, eye, lay);
        expect(Math.abs(look.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(look.y)).toBeLessThanOrEqual(1);
        const dx = px - (1000 + size / 2);
        const dy = py - (500 + size / 2);
        // `+ 0` folds -0 into 0.
        expect(Math.sign(look.x) + 0).toBe(Math.sign(dx) + 0);
        expect(Math.sign(look.y) + 0).toBe(Math.sign(dy) + 0);
        // GAZE_REACH world px away, in either direction, is fully turned.
        if (Math.abs(dx) >= GAZE_REACH.x * k) expect(Math.abs(look.x)).toBe(1);
      }),
    );
  });

  it("an eased step moves a share of the way and never overshoots; instant lands on the target", () => {
    const unitArb = fc.double({ noNaN: true, min: -1, max: 1 });
    fc.assert(
      fc.property(unitArb, unitArb, unitArb, unitArb, fc.double({ noNaN: true, min: 0, max: 6 }), (lx, ly, tx, ty, frames) => {
        const from = { x: lx, y: ly };
        const to = { x: tx, y: ty };
        const next = easeLook(from, to, frames, false);
        const share = Math.min(1, frames * GAZE_EASE);
        expect(next.x).toBeCloseTo(lx + (tx - lx) * share, 9);
        expect(Math.abs(next.x - tx)).toBeLessThanOrEqual(Math.abs(lx - tx) + 1e-12);
        expect(Math.abs(next.y - ty)).toBeLessThanOrEqual(Math.abs(ly - ty) + 1e-12);
        const landed = easeLook(from, to, frames, true);
        expect(landed.x).toBeCloseTo(tx, 12);
        expect(landed.y).toBeCloseTo(ty, 12);
      }),
    );
  });

  it("falls back to the resting gaze for an eye with no size", () => {
    expect(gazeToward({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 }, "landscape")).toEqual(REST_LOOK);
  });
});
