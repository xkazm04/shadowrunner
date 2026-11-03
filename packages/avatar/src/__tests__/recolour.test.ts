// The recolour rule (character-control design.md "Recolour"): the TS rule, its selection per layer,
// and the GLSL twin. There is no GPU under vitest (the GL tests use a counting stub), so the shader
// is checked by a line-for-line JS port of RECOLOUR_GLSL against recolour.ts, within 3/255.
import { defaultLook, regionKey, type Look } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RECOLOUR_GLSL } from "../gl/programs.js";
import type { Rgb } from "../render/frame.js";
import { hexToHsl, layerRecolour, recolourRgb, rgbToHsl, rigRecolours, S_FLOOR, S_KEEP, type Hsl } from "../render/recolour.js";
import { malakorRig } from "./malakor.js";
import { pixelRig } from "./pixels.js";

const hueDistanceDeg = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d) * 360;
};

const channel = fc.double({ min: 0, max: 1, noNaN: true });
const rgbArb = fc.tuple(channel, channel, channel);
const hexArb = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })).map((c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`);

describe("recolourRgb", () => {
  it("turns teal red: lightness kept, hue within 10 degrees of red", () => {
    const teal: Rgb = [32 / 255, 178 / 255, 170 / 255];
    const out = recolourRgb(teal, "#ff0000");
    const [h, s, l] = rgbToHsl(out);
    expect(l).toBeCloseTo(rgbToHsl(teal)[2], 6);
    expect(hueDistanceDeg(h, 0)).toBeLessThan(10);
    expect(s).toBeGreaterThan(0.8);
    expect(out[0]).toBeGreaterThan(out[1] + 0.3);
  });

  it("gives a grey source the saturation floor, so the colour shows", () => {
    const out = recolourRgb([0.5, 0.5, 0.5], "#ff0000");
    const [h, s, l] = rgbToHsl(out);
    expect(l).toBeCloseTo(0.5, 6);
    expect(hueDistanceDeg(h, 0)).toBeLessThan(1);
    expect(s).toBeCloseTo(Math.max(1 * S_KEEP, S_FLOOR), 6);
  });

  it("keeps every pixel's lightness and takes the target's hue (property)", () => {
    fc.assert(
      fc.property(rgbArb, hexArb, (src, hex) => {
        const target = hexToHsl(hex);
        const [h, s, l] = rgbToHsl(recolourRgb(src, hex));
        const src3 = rgbToHsl(src);
        expect(l).toBeCloseTo(src3[2], 6);
        const want = Math.max(target[1] * S_KEEP + src3[1] * (1 - S_KEEP), S_FLOOR * target[1]);
        // Hue and saturation are only defined where the result is not grey (l at 0 or 1, or s 0).
        if (l > 0.02 && l < 0.98 && want > 0.02) {
          expect(s).toBeCloseTo(want, 4);
          expect(hueDistanceDeg(h, target[0])).toBeLessThan(1);
        }
      }),
    );
  });
});

/** A JS port of RECOLOUR_GLSL, expression for expression (GLSL `mod` is x - y * floor(x / y)). */
function glslRecolour(src: Rgb, target: Hsl): Rgb {
  const mod = (x: number, y: number): number => x - y * Math.floor(x / y);
  const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
  const rgb2hsl = ([r, g, b]: Rgb): Hsl => {
    const mx = Math.max(r, Math.max(g, b));
    const mn = Math.min(r, Math.min(g, b));
    const l = (mx + mn) * 0.5;
    const d = mx - mn;
    if (d <= 0) return [0, 0, l];
    const s = Math.min(1, d / (1 - Math.abs(2 * l - 1)));
    let h: number;
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
  };
  const hsl2rgb = ([h, s, l]: Hsl): Rgb => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const k = (o: number): number => l + c * (clamp(Math.abs(mod(h * 6 + o, 6) - 3) - 1, 0, 1) - 0.5);
    return [k(0), k(4), k(2)];
  };
  const hsl = rgb2hsl(src);
  const s = Math.max(target[1] * S_KEEP + hsl[1] * (1 - S_KEEP), S_FLOOR * target[1]);
  return hsl2rgb([target[0], s, hsl[2]]);
}

describe("the GLSL recolour", () => {
  it("is the ported expressions (the port tracks the shader source)", () => {
    for (const line of ["float s = min(1.0, d / (1.0 - abs(2.0 * l - 1.0)));", "vec3 x = mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0);", "return hsl.z + c * (clamp(abs(x - 3.0) - 1.0, 0.0, 1.0) - 0.5);", "float s = max(target.y * S_KEEP + src.y * (1.0 - S_KEEP), S_FLOOR * target.y);", "return hsl2rgb(vec3(target.x, s, src.z));"]) {
      expect(RECOLOUR_GLSL).toContain(line);
    }
  });

  it("agrees with recolour.ts within 3/255 per channel, red on teal included", () => {
    const check = (src: Rgb, hex: string): void => {
      const a = glslRecolour(src, hexToHsl(hex));
      const b = recolourRgb(src, hex);
      a.forEach((v, i) => expect(Math.abs(v - (b[i] ?? NaN)) * 255).toBeLessThanOrEqual(3));
    };
    check([32 / 255, 178 / 255, 170 / 255], "#ff0000");
    fc.assert(fc.property(rgbArb, hexArb, (src, hex) => check(src, hex)));
  });
});

describe("layerRecolour (which light or region a layer takes)", () => {
  it("a look equal to the rig recolours nothing (the old path for every layer)", () => {
    for (const rig of [malakorRig(), pixelRig()]) {
      expect(rigRecolours(rig, defaultLook(rig)).size).toBe(0);
      const shouting: Look = { ...defaultLook(rig), palette: { ...rig.palette, eye: rig.palette.eye.toUpperCase() } };
      expect(rigRecolours(rig, shouting).size).toBe(0);
    }
  });

  it("eye light on every eye layer (emissive or not); glow on other emissive layers only; mouth on the cavity slot", () => {
    const rig = malakorRig();
    const look: Look = { ...defaultLook(rig), palette: { ...rig.palette, eye: "#ff0000", glow: "#00ff00" } };
    for (const layer of rig.layers) {
      const plan = layerRecolour(rig, layer, look);
      if (layer.kind === "eye") expect(plan?.light).toMatchObject({ name: "eye", mode: "all" });
      else if (layer.kind === "crown" || layer.kind === "accessory") expect(plan?.light).toMatchObject({ name: "glow", mode: "saturated" });
      else expect(plan, layer.name).toBeUndefined();
    }
    const pixel = pixelRig();
    const eye = pixel.layers.find((l) => l.name === "eye_l");
    const jaw = pixel.layers.find((l) => l.name === "jaw");
    if (eye === undefined || jaw === undefined) throw new Error("fixture");
    expect(eye.emissive).toBe(false);
    expect(layerRecolour(pixel, eye, { ...defaultLook(pixel), palette: { ...pixel.palette, eye: "#ff0000" } })?.light?.name).toBe("eye");
    const mouth = layerRecolour(pixel, jaw, { ...defaultLook(pixel), palette: { ...pixel.palette, mouth: "#00ff00" } });
    expect(mouth?.slots.map((s) => s !== undefined)).toEqual([false, true, false, false]);
    const own = layerRecolour(pixel, jaw, { ...defaultLook(pixel), palette: { ...pixel.palette, mouth: "#00ff00" }, regions: { [regionKey("jaw", "cavity")]: "#0000ff" } });
    expect(own?.slots[1]).toEqual(hexToHsl("#0000ff"));
  });
});
