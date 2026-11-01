// forge-pipeline task 4, items (a) and (b) from the task 3 review. No network.
// (a) The committed Malakor portrait, cut with the recorded m8 parts: every part yields a layer
//     and the crown keeps its dark facets.
// (b) Seams: wherever layers meet inside the character, compositing every layer back to front
//     over black must give back the source, so no layer edge lets the ground through as a dark
//     line. Checked on all pixels at least CUT_FEATHER + 2 px inside the union of the parts (the
//     outer silhouette fades to the ground by design and is left out).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import portraitUrl from "../../../assets/characters/malakor/rig/portrait.png?inline";
import announcer from "../test/fixtures/spike-announcer-of-dead-air-parts.json";
import m8 from "../test/fixtures/m8-parts.json";
import { CUT_FEATHER, type CutPart, type CutResult, KEYED_PARTS, cutAll } from "./cut.js";
import { decodeImage } from "./image.js";
import { KEY_HI, type Mask, cornerKeyLo, featherMask, luma, lumaKey, rasterizeMask } from "./mask.js";
import { parseParts, toCanvas } from "./parts.js";
import { PART_NAMES, type Part, type Rgba } from "./types.js";

/** Largest luma change a seam may cause (task 4 (b)). */
const SEAM_TOLERANCE = 8;

function unbase64(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) table[alphabet.charCodeAt(i)] = i;
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = ((acc << 6) | (table[clean.charCodeAt(i)] ?? 0)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 255;
    }
  }
  return out;
}

function malakorPortrait(): Rgba {
  const decoded = decodeImage(unbase64(portraitUrl.slice(portraitUrl.indexOf(",") + 1)));
  if (!decoded.ok) throw new Error(decoded.errors.message);
  return decoded.value;
}

function partsOf(json: unknown): Part[] {
  const parsed = parseParts(json);
  if (!parsed.ok) throw new Error("fixture does not parse");
  return parsed.value.parts;
}

/** Layers (front to back, as cutAll returns them) composited back to front over black: RGB floats. */
function composite(layers: readonly CutPart[], width: number, height: number): Float64Array {
  const out = new Float64Array(width * height * 3);
  for (const layer of [...layers].reverse()) {
    const [bx, by, bw, bh] = layer.bbox;
    const { data } = layer.image;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const from = (y * bw + x) * 4;
        const to = ((by + y) * width + bx + x) * 3;
        const a = (data[from + 3] ?? 0) / 255;
        for (let c = 0; c < 3; c++) out[to + c] = (data[from + c] ?? 0) * a + (out[to + c] ?? 0) * (1 - a);
      }
    }
  }
  return out;
}

/**
 * Pixels at least feather + 2 px inside the union of the parts' polygons, less the ground the
 * luma key takes out of crown, hair and accessory on purpose (key below 255 inside their polygons).
 */
function interior(source: Rgba, parts: readonly Part[], keyLo: number, feather: number): Mask {
  const { width, height } = source;
  const union: Mask = { width, height, data: new Uint8ClampedArray(width * height) };
  const keyed = new Uint8Array(width * height);
  for (const part of parts) {
    const isKeyed = KEYED_PARTS.includes(part.name);
    rasterizeMask(toCanvas(part.poly, width, height), width, height, 0).data.forEach((a, i) => {
      if (a === 0) return;
      union.data[i] = 255;
      if (isKeyed) keyed[i] = 1;
    });
  }
  const key = lumaKey(source, keyLo, KEY_HI);
  const inner = featherMask(union, feather + 2);
  for (let i = 0; i < keyed.length; i++) if (keyed[i] === 1 && key.data[i] !== 255) inner.data[i] = 0;
  return inner;
}

/** Interior pixels whose composited luma differs from the source by more than SEAM_TOLERANCE. */
function seams(source: Rgba, parts: readonly Part[], cut: CutResult): string[] {
  const { width, height, data } = source;
  const out = composite(cut.layers, width, height);
  const inner = interior(source, parts, cut.keyLo, CUT_FEATHER);
  const bad: string[] = [];
  for (let i = 0; i < width * height; i++) {
    if (inner.data[i] !== 255) continue;
    const was = luma(data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0);
    const now = luma(out[i * 3] ?? 0, out[i * 3 + 1] ?? 0, out[i * 3 + 2] ?? 0);
    if (Math.abs(now - was) > SEAM_TOLERANCE) bad.push(`(${i % width}, ${Math.floor(i / width)}): ${was.toFixed(1)} -> ${now.toFixed(1)}`);
  }
  return bad;
}

const opaque = (layer: CutPart): number => layer.image.data.filter((a, i) => i % 4 === 3 && a === 255).length;

describe("seams (task 4 (b))", () => {
  const SIZE = 48;
  const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), {
    minLength: 3,
    maxLength: 12,
  });
  // Hats are left out here: a hood (ruling 4) is checked on the Announcer below.
  const arbParts: fc.Arbitrary<Part[]> = fc
    .subarray(PART_NAMES.filter((n) => n !== "head" && n !== "hat"))
    .chain((others) =>
      fc.tuple(...["head" as const, ...others].map((name) => arbPoly.map((poly): Part => ({ name, box_2d: [0, 0, 1000, 1000], poly })))),
    );
  // Bright enough (luma >= 64) that the luma key keeps every pixel and any ground shows.
  const arbPortrait: fc.Arbitrary<Rgba> = fc
    .uint8Array({ minLength: SIZE * SIZE, maxLength: SIZE * SIZE })
    .map((greys) => {
      const data = new Uint8ClampedArray(SIZE * SIZE * 4);
      greys.forEach((g, i) => data.set([64 + (g % 192), 64 + ((g * 7) % 192), 64 + ((g * 13) % 192), 255], i * 4));
      return { width: SIZE, height: SIZE, data };
    });

  it("property: layers composited over black give back the source inside the character", () => {
    fc.assert(
      fc.property(arbParts, arbPortrait, (parts, portrait) => {
        expect(seams(portrait, parts, cutAll(portrait, parts))).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("the Announcer's hood meets the face without a seam", () => {
    const parts = partsOf(announcer);
    const data = new Uint8ClampedArray(1024 * 1024 * 4);
    for (let i = 0; i < 1024 * 1024; i++) data.set([80 + (i % 151), 80 + ((i >> 10) % 151), 200, 255], i * 4);
    const portrait = { width: 1024, height: 1024, data };
    const result = cutAll(portrait, parts);
    expect(result.hood).toBe(true);
    expect(seams(portrait, parts, result).slice(0, 10)).toEqual([]);
  });
});

describe("the Malakor portrait with the recorded m8 parts (task 4 (a))", () => {
  const portrait = malakorPortrait();
  const parts = partsOf(m8);
  const result = cutAll(portrait, parts);

  it("decodes at 1024 x 1024 and measures the key from its corners", () => {
    expect([portrait.width, portrait.height]).toEqual([1024, 1024]);
    expect(result.keyLo).toBe(cornerKeyLo(portrait));
    expect(result.keyLo).toBeGreaterThanOrEqual(10);
  });

  it("gives every part a non-empty layer", () => {
    expect(result.empty).toEqual([]);
    expect(result.layers.map((l) => l.name).sort()).toEqual(parts.map((p) => p.name).sort());
    for (const layer of result.layers) expect(opaque(layer), layer.name).toBeGreaterThan(1000);
  });

  it("keeps the crown's dark facets", () => {
    const crown = result.layers.find((l) => l.name === "crown");
    if (crown === undefined) throw new Error("no crown layer");
    const { data } = crown.image;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255 && luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) < 64) dark++;
    }
    expect(opaque(crown)).toBeGreaterThan(15000);
    expect(dark).toBeGreaterThan(5000);
  });

  it("composites back without a seam", () => {
    expect(seams(portrait, parts, result).slice(0, 10)).toEqual([]);
  });
});
