import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pupilCentre, PUPIL_REST, REST_LOOK } from "./Eye";

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
