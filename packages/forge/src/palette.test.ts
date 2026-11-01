// forge-pipeline task 4: samplePalette (requirement 6.3). Synthetic images only; no network.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rasterizeMask } from "./mask.js";
import { FALLBACK_PALETTE, SATURATION_MIN, VALUE_MIN, hsv, samplePalette } from "./palette.js";
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
  it("property: always four #rrggbb colours", () => {
    fc.assert(
      fc.property(arbParts, arbNoise, (parts, noise) => {
        const palette = samplePalette(paint((i) => noiseAt(noise, i)), parts);
        expect(Object.keys(palette).sort()).toEqual(["eye", "glow", "mouth", "rim"]);
        for (const value of Object.values(palette)) expect(value).toMatch(HEX);
      }),
      { numRuns: 200 },
    );
  });

  it("property: eyes lit with one saturated colour give exactly that eye colour, whatever lies outside them", () => {
    const eyes = inside([EYE_L, EYE_R]);
    fc.assert(
      fc.property(arbSaturated, arbNoise, (light, noise) => {
        const palette = samplePalette(paint((i) => (eyes.has(i) ? light : noiseAt(noise, i))), [HEAD, EYE_L, EYE_R]);
        expect(palette.eye).toBe(hex(light));
        expect(palette.rim).toBe(palette.eye);
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
        const a = samplePalette(paint((i) => (eyes.has(i) ? within(i) : noiseAt(outer, i))), [HEAD, EYE_L, EYE_R]);
        const b = samplePalette(paint((i) => (eyes.has(i) ? within(i) : [255 - (outer[i] ?? 0), 255, 0])), [HEAD, EYE_L, EYE_R]);
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
        expect(samplePalette(image, [HEAD, EYE_L, EYE_R]).eye).toBe(hex(bright));
      }),
      { numRuns: 150 },
    );
  });

  it("property: glow and mouth keep the eye's hue; glow is no brighter than the eye; the mouth is dark", () => {
    const eyes = inside([EYE_L, EYE_R]);
    fc.assert(
      fc.property(arbSaturated, (light) => {
        const palette = samplePalette(paint((i) => (eyes.has(i) ? light : [3, 3, 3])), [HEAD, EYE_L, EYE_R]);
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
    const palette = samplePalette(paint((i) => (eyes.has(i) ? [255, 158, 56] : [6, 6, 6])), [HEAD, EYE_L, EYE_R]);
    expect(palette).toEqual({ eye: "#ff9e38", rim: "#ff9e38", glow: expect.stringMatching(HEX), mouth: expect.stringMatching(HEX) });
    const [r, g, b] = unhex(palette.glow);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("falls back to the head when the eyes are missing or unlit, then to FALLBACK_PALETTE", () => {
    const head = inside([HEAD]);
    const eyes = inside([EYE_L, EYE_R]);
    const teal: Rgb = [40, 200, 180];
    const lit = paint((i) => (head.has(i) && !eyes.has(i) && i % 4 === 0 ? teal : [10, 10, 10]));
    expect(samplePalette(lit, [HEAD]).eye).toBe(hex(teal));
    expect(samplePalette(lit, [HEAD, EYE_L, EYE_R]).eye).toBe(hex(teal)); // eyes dark: no candidate there
    expect(samplePalette(paint(() => [120, 120, 120]), [HEAD, EYE_L, EYE_R])).toEqual(FALLBACK_PALETTE);
    expect(samplePalette(paint(() => [200, 30, 30]), [])).toEqual(FALLBACK_PALETTE);
  });
});
