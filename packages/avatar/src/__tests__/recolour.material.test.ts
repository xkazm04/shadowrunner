// companion-lanes round 7: the moved slot's lightness map is slope-bounded at the reference (no
// satin stretch), and its saturation carry fades on a grey, near-black or near-white target (no
// brown-black). The lights and unflagged slots keep the old rule exactly. And the morph twin reads
// the region map where the keys' art is (x), not only at the moved point p.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MORPH_LAYER_SAMPLE } from "../gl/morph.js";
import { baseFs } from "../gl/programs.js";
import { carryOf, hexToHsl, hslToRgb, KEEP_L, L_EPS, L_SLOPE, mapLightness, recolourHsl, rgbToHsl, S_FLOOR, S_KEEP, type Hsl } from "../render/recolour.js";

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const inner = fc.double({ min: 0.02, max: 0.98, noNaN: true });

/** The round-4 piecewise-linear map (the line both sides used to be). */
const linear = (l: number, lr: number, lt: number): number => {
  const r = Math.min(1 - L_EPS, Math.max(L_EPS, lr));
  const t = Math.min(1 - L_EPS, Math.max(L_EPS, lt));
  return l <= r ? (l * t) / r : t + ((l - r) * (1 - t)) / (1 - r);
};

describe("mapLightness, round 7 (slope-bounded at the reference)", () => {
  it("is the round-4 line wherever that line's slope is within L_SLOPE", () => {
    fc.assert(
      fc.property(unit, inner, inner, (l, lr, lt) => {
        const below = lt / lr <= L_SLOPE;
        const above = (1 - lt) / (1 - lr) <= L_SLOPE;
        if ((l <= lr && below) || (l > lr && above)) expect(mapLightness(l, lr, lt)).toBeCloseTo(linear(l, lr, lt), 12);
      }),
    );
  });

  it("has a slope of at most L_SLOPE at the reference, on either side", () => {
    fc.assert(
      fc.property(inner, inner, (lr, lt) => {
        const h = 1e-6;
        const at = mapLightness(lr, lr, lt);
        expect((at - mapLightness(lr - h, lr, lt)) / h).toBeLessThanOrEqual(L_SLOPE + 1e-3);
        expect((mapLightness(lr + h, lr, lt) - at) / h).toBeLessThanOrEqual(L_SLOPE + 1e-3);
      }),
    );
  });

  it("black jacket to cream, cream hoodie to black: the satin stretch about the reference is gone, order kept", () => {
    for (const [ref, hex] of [["#1a1c22", "#e8e2d0"], ["#efe4d6", "#101010"]] as const) {
      const lr = hexToHsl(ref)[2];
      const lt = hexToHsl(hex)[2];
      const lo = mapLightness(lr - 0.02, lr, lt);
      const hi = mapLightness(Math.min(1, lr + 0.02), lr, lt);
      expect(mapLightness(lr, lr, lt)).toBeCloseTo(Math.min(1 - L_EPS, Math.max(L_EPS, lt)), 12);
      expect(lo).toBeLessThan(hi);
      expect(Math.abs(hi - lo)).toBeLessThan(Math.abs(linear(Math.min(1, lr + 0.02), lr, lt) - linear(lr - 0.02, lr, lt)));
    }
  });
});

describe("the morph layer's region map read, round 7", () => {
  it("reads the map at kuv (p moved toward x by the keys' painted share) on the morph twin only", () => {
    const morph = baseFs(false, false, MORPH_LAYER_SAMPLE);
    expect(morph).toContain("vec2 muv = u_mapRect.xy + kuv * u_mapRect.zw;");
    expect(morph).toContain("keyed = keyed + min(1.0, s) * (1.0 - keyed);");
    expect(morph).toContain("vec2 kuv = mix(uv, (x - u_rect.xy) / u_rect.zw, keyed);");
    for (const fs of [baseFs(false), baseFs(true), baseFs(false, true)]) {
      expect(fs).toContain("vec2 muv = u_mapRect.xy + uv * u_mapRect.zw;");
      expect(fs).not.toContain("kuv");
    }
  });
});

describe("the saturation carry, round 7", () => {
  it("is exactly the old rule for a light or an unflagged slot (ref < 0)", () => {
    fc.assert(
      fc.property(unit, unit, unit, unit, unit, unit, (sh, ss, sl, th, ts, tl) => {
        const src: Hsl = [sh, ss, sl];
        const target: Hsl = [th, ts, tl];
        const old = hslToRgb([th, Math.max(ts * S_KEEP + ss * (1 - S_KEEP), S_FLOOR * ts), sl]);
        expect(carryOf(target, KEEP_L)).toBe(1);
        expect(recolourHsl(src, target, KEEP_L)).toEqual(old);
      }),
    );
  });

  it("fades to 0 on a moved slot as the target goes grey, black or white, and is 1 on a coloured mid target", () => {
    expect(carryOf(hexToHsl("#101010"), 0.1)).toBe(0);
    expect(carryOf(hexToHsl("#f4f4f4"), 0.5)).toBe(0);
    expect(carryOf([0.6, 0.5, 0.4], 0.5)).toBe(1);
    fc.assert(
      fc.property(unit, unit, unit, unit, (h, s, l, ref) => {
        const c = carryOf([h, s, l], ref);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("a #101010 target on a saturated moved slot comes out neutral (no brown-black)", () => {
    const target = hexToHsl("#101010");
    for (const l of [0.05, 0.3, 0.6, 0.9]) {
      const out = recolourHsl([0.08, 0.6, l], target, 0.8);
      expect(rgbToHsl(out)[1]).toBeLessThan(1e-9);
    }
  });
});
