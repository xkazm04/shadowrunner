// forge-pipeline task 4: samplePalette (requirement 6.3); task 5 ruling (b): no fixed fallback.
// Synthetic images only; no network.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rasterizeMask } from "./mask.js";
import { FALLBACK_SATURATION, FALLBACK_VALUE, HUE_BINS, SATURATION_MIN, VALUE_MIN, hsv, samplePalette } from "./palette.js";
import { toCanvas } from "./parts.js";
import { PART_NAMES, type Part, type PartName, type Rgba } from "./types.js";

const SIZE = 40;
const HEX = /^#[0-9a-f]{6}$/;
type Rgb = [number, number, number];

const hex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const byte = (text: string, at: number): number => parseInt(text.slice(at, at + 2), 16);
const unhex = (text: string): Rgb => [byte(text, 1), byte(text, 3), byte(text, 5)];

function rect(name: PartName, x0: number, y0: number, x1: number, y1: number): Part {
  const s = (v: number): number => Math.round((v * 1000) / SIZE);
  return { name, box_2d: [s(y0), s(x0), s(y1), s(x1)], poly: [[s(y0), s(x0)], [s(y0), s(x1)], [s(y1), s(x1)], [s(y1), s(x0)]] };
}
const HEAD = rect("head", 4, 4, 36, 36);
const EYE_L = rect("eye_l", 22, 12, 30, 20);
const EYE_R = rect("eye_r", 10, 12, 18, 20);

/** Pixels inside any of the parts' polygons (hard raster), as the sampler sees them. */
function inside(parts: readonly Part[]): Set<number> {
  const out = new Set<number>();
  for (const part of parts) {
    rasterizeMask(toCanvas(part.poly, SIZE, SIZE), SIZE, SIZE, 0).data.forEach((a, i) => {
      if (a !== 0) out.add(i);
    });
  }
  return out;
}

function paint(pixel: (i: number) => Rgb): Rgba {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data.set([...pixel(i), 255], i * 4);
  return { width: SIZE, height: SIZE, data };
}

const arbRgb: fc.Arbitrary<Rgb> = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }));
/** A colour the sampler counts as a saturated light. */
const arbSaturated = arbRgb.filter((rgb) => {
  const { s, v } = hsv(rgb);
  return s >= SATURATION_MIN + 0.02 && v >= VALUE_MIN + 0.02;
});
const arbNoise = fc.uint8Array({ minLength: SIZE * SIZE * 3, maxLength: SIZE * SIZE * 3 });
const noiseAt = (noise: Uint8Array, i: number): Rgb => [noise[i * 3] ?? 0, noise[i * 3 + 1] ?? 0, noise[i * 3 + 2] ?? 0];
const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: 3, maxLength: 10 });
const arbParts: fc.Arbitrary<Part[]> = fc
  .subarray(PART_NAMES.filter((n) => n !== "head"))
  .chain((others) => fc.tuple(...["head" as const, ...others].map((name) => arbPoly.map((poly): Part => ({ name, box_2d: [0, 0, 1000, 1000], poly })))));

const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const lumaOf = ([r, g, b]: Rgb): number => 0.299 * r + 0.587 * g + 0.114 * b;

describe("samplePalette", () => {
  it("property: always four #rrggbb colours, and a warning exactly when the eyes hold no light", () => {
    fc.assert(
      fc.property(arbParts, arbNoise, (parts, noise) => {
        const image = paint((i) => noiseAt(noise, i));
        const { palette, warnings } = samplePalette(image, parts);
        expect(Object.keys(palette).sort()).toEqual(["eye", "glow", "mouth", "rim"]);
        for (const value of Object.values(palette)) expect(value).toMatch(HEX);
        const lit = [...inside(parts.filter((p) => p.name === "eye_l" || p.name === "eye_r"))].some((i) => {
          const { s, v } = hsv(noiseAt(noise, i));
          return s >= SATURATION_MIN && v >= VALUE_MIN;
        });
        expect(warnings.map((w) => w.code)).toEqual(lit ? [] : ["palette_fallback"]);
      }),
      { numRuns: 200 },
    );
  });

  it("property: eyes lit with one saturated colour give exactly that eye colour, whatever lies outside them", () => {
    const eyes = inside([EYE_L, EYE_R]);
    fc.assert(
      fc.property(arbSaturated, arbNoise, (light, noise) => {
        const { palette, warnings } = samplePalette(paint((i) => (eyes.has(i) ? light : noiseAt(noise, i))), [HEAD, EYE_L, EYE_R]);
        expect(palette.eye).toBe(hex(light));
        expect(palette.rim).toBe(palette.eye);
        expect(warnings).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("property: only pixels inside the eye polygons count when the eyes hold a saturated light", () => {
    const eyes = inside([EYE_L, EYE_R]);
    fc.assert(
      fc.property(arbSaturated, arbNoise, arbNoise, (light, inner, outer) => {
        // A saturated light somewhere in each eye, noise elsewhere in the eyes.
        const within = (i: number): Rgb => (i % 5 === 0 ? light : noiseAt(inner, i));
        const a = samplePalette(paint((i) => (eyes.has(i) ? within(i) : noiseAt(outer, i))), [HEAD, EYE_L, EYE_R]).palette;
        const b = samplePalette(paint((i) => (eyes.has(i) ? within(i) : [255 - (outer[i] ?? 0), 255, 0])), [HEAD, EYE_L, EYE_R]).palette;
        expect(b).toEqual(a);
      }),
      { numRuns: 150 },
    );
  });

  it("property: the brightest saturated colour wins; brighter grey and white pixels are ignored", () => {
    const eyes = [...inside([EYE_L, EYE_R])];
    fc.assert(
      fc.property(arbSaturated, arbSaturated, fc.integer({ min: 0, max: 255 }), (one, two, grey) => {
        fc.pre(hsv(one).v !== hsv(two).v);
        const [bright, dim] = hsv(one).v > hsv(two).v ? [one, two] : [two, one];
        const half = new Set(eyes.filter((_, k) => k % 3 === 0));
        const greys = new Set(eyes.filter((_, k) => k % 3 === 1));
        const image = paint((i) => (half.has(i) ? bright : greys.has(i) ? [grey, grey, grey] : eyes.includes(i) ? dim : [0, 0, 0]));
        expect(samplePalette(image, [HEAD, EYE_L, EYE_R]).palette.eye).toBe(hex(bright));
      }),
      { numRuns: 150 },
    );
  });

  it("property: glow and mouth keep the eye's hue; glow is no brighter than the eye; the mouth is dark", () => {
    const eyes = inside([EYE_L, EYE_R]);
    fc.assert(
      fc.property(arbSaturated, (light) => {
        const { palette } = samplePalette(paint((i) => (eyes.has(i) ? light : [3, 3, 3])), [HEAD, EYE_L, EYE_R]);
        const eye = hsv(unhex(palette.eye));
        const glow = hsv(unhex(palette.glow));
        const mouth = hsv(unhex(palette.mouth));
        expect(hueGap(glow.h, eye.h)).toBeLessThan(6);
        expect(hueGap(mouth.h, eye.h)).toBeLessThan(25); // 8-bit rounding of a dark colour moves its hue
        expect(glow.v).toBeLessThanOrEqual(eye.v);
        expect(glow.s).toBeGreaterThanOrEqual(eye.s - 0.05);
        expect(lumaOf(unhex(palette.mouth))).toBeLessThan(40);
      }),
      { numRuns: 200 },
    );
  });

  it("derives a Malakor-like palette from an orange eye", () => {
    const eyes = inside([EYE_L, EYE_R]);
    const { palette } = samplePalette(paint((i) => (eyes.has(i) ? [255, 158, 56] : [6, 6, 6])), [HEAD, EYE_L, EYE_R]);
    expect(palette).toEqual({ eye: "#ff9e38", rim: "#ff9e38", glow: expect.stringMatching(HEX), mouth: expect.stringMatching(HEX) });
    const [r, g, b] = unhex(palette.glow);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });
});

describe("samplePalette fallback (task 5 ruling (b))", () => {
  const head = inside([HEAD]);
  const eyes = inside([EYE_L, EYE_R]);
  const bin = (h: number): number => Math.floor((h * HUE_BINS) / 360);

  it("property: unlit eyes take the head's dominant saturated hue and warn palette_fallback", () => {
    fc.assert(
      fc.property(arbSaturated, arbSaturated, arbRgb, (major, minor, eyeGrey) => {
        fc.pre(bin(hsv(major).h) !== bin(hsv(minor).h));
        const g = Math.round(lumaOf(eyeGrey));
        // Head: 3 in 5 pixels the major colour, 1 in 5 the minor (brighter or not), the rest dark.
        // Eyes: grey, so no candidate there.
        const image = paint((i) => (eyes.has(i) ? [g, g, g] : head.has(i) ? (i % 5 < 3 ? major : i % 5 === 3 ? minor : [4, 4, 4]) : minor));
        const { palette, warnings } = samplePalette(image, [HEAD, EYE_L, EYE_R]);
        const eye = hsv(unhex(palette.eye));
        expect(hueGap(eye.h, hsv(major).h)).toBeLessThan(1.5);
        expect(eye.s).toBeCloseTo(FALLBACK_SATURATION, 1);
        expect(eye.v).toBe(FALLBACK_VALUE);
        expect(warnings).toEqual([{ code: "palette_fallback", message: expect.stringContaining("head's dominant hue") }]);
      }),
      { numRuns: 200 },
    );
  });

  it("with no saturated pixel uses the hue of the faintly coloured ones, then the brightest grey", () => {
    const dusty: Rgb = [120, 100, 110]; // s = 0.17, below SATURATION_MIN
    const faint = samplePalette(paint((i) => (head.has(i) ? dusty : [0, 0, 0])), [HEAD, EYE_L, EYE_R]);
    expect(hueGap(hsv(unhex(faint.palette.eye)).h, hsv(dusty).h)).toBeLessThan(1.5);
    expect(faint.warnings.map((w) => w.code)).toEqual(["palette_fallback"]);

    const grey = (v: number): Rgba => paint((i) => (head.has(i) ? [v, v, v] : [0, 0, 0]));
    const a = samplePalette(grey(120), [HEAD, EYE_L, EYE_R]);
    const b = samplePalette(grey(180), [HEAD, EYE_L, EYE_R]);
    expect(a.palette.eye).toBe("#787878");
    expect(b.palette.eye).toBe("#b4b4b4");
    expect(hsv(unhex(a.palette.mouth)).s).toBe(0); // a grey light gets a grey mouth, not a tint
    expect(a.warnings[0]?.message).toContain("brightest grey of the head");
  });

  it("with no head pixel searches the whole portrait", () => {
    const red = samplePalette(paint(() => [200, 30, 30]), []);
    const teal = samplePalette(paint(() => [40, 200, 180]), []);
    expect(hsv(unhex(red.palette.eye)).h).toBeCloseTo(0, 0);
    expect(hueGap(hsv(unhex(teal.palette.eye)).h, hsv([40, 200, 180]).h)).toBeLessThan(1.5);
    expect(red.warnings[0]?.message).toContain("portrait's dominant hue");
  });
});
