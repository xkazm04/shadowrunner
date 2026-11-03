// cast-forge task 5 (Reveille): a lifted part with `matte: "plate"` keeps only what differs from the
// plate behind it, and over that plate at rest gives back the portrait; a part's own `pivot` is its
// layer's anchor. No network.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assembleRig } from "./assemble.js";
import { compositeRig } from "./composite.js";
import { cutNamed } from "./cutNamed.js";
import { decodeImage } from "./image.js";
import { MATTE_HI, MATTE_LO, matteAlpha, matteToPlate } from "./matte.js";
import { parseParts } from "./parts.js";
import type { NamedPart, Rgba } from "./types.js";

const SIZE = 40;
const rect = (y0: number, x0: number, y1: number, x1: number): [number, number][] => [
  [y0, x0],
  [y0, x1],
  [y1, x1],
  [y1, x0],
];
const part = (name: string, role: NamedPart["role"], poly: [number, number][], extra: Partial<NamedPart> = {}): NamedPart => ({ name, role, box_2d: [0, 0, 1000, 1000], poly, ...extra });
const flat = (rgb: readonly [number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data.set([...rgb, 255], i * 4);
  return { width: SIZE, height: SIZE, data };
};
const rgb = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }));

/**
 * A dial (`surface`) with a neon ring of `neon` at radius 8..10 about the centre and a halo fading
 * over 5 px outside it, plus `noise` (0..MATTE_LO) of re-render noise on every pixel.
 */
function ringOn(surface: readonly [number, number, number], neon: readonly [number, number, number], noise: number): Rgba {
  const img = flat(surface);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = Math.hypot((i % SIZE) - SIZE / 2 + 0.5, Math.floor(i / SIZE) - SIZE / 2 + 0.5);
    const w = r >= 8 && r <= 10 ? 1 : r > 10 && r < 15 ? (15 - r) / 5 : 0;
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = (surface[c] ?? 0) + w * ((neon[c] ?? 0) - (surface[c] ?? 0)) + (i % 2 === 0 ? noise : -noise);
  }
  return img;
}

describe("matteToPlate", () => {
  it("alpha ramps from MATTE_LO to MATTE_HI", () => {
    expect(matteAlpha(MATTE_LO)).toBe(0);
    expect(matteAlpha(MATTE_HI)).toBe(1);
    expect(matteAlpha((MATTE_LO + MATTE_HI) / 2)).toBeCloseTo(0.5, 5);
  });

  it("property: over the plate at rest the matted part is the portrait, and the surface is clear", () => {
    fc.assert(
      fc.property(rgb, rgb, fc.integer({ min: 0, max: MATTE_LO }), (surface, neon, noise) => {
        const plate = flat(surface);
        const portrait = ringOn(surface, neon, noise);
        const m = new Uint8ClampedArray(SIZE * SIZE).fill(255);
        const colour = matteToPlate(portrait, plate, m);
        for (let i = 0; i < SIZE * SIZE; i++) {
          let difference = 0;
          for (let c = 0; c < 3; c++) difference = Math.max(difference, Math.abs((portrait.data[i * 4 + c] ?? 0) - (plate.data[i * 4 + c] ?? 0)));
          if (difference <= MATTE_LO) expect(m[i], `surface pixel ${i} kept`).toBe(0);
          if (difference >= MATTE_HI) expect(m[i]).toBe(255);
          const a = (m[i] ?? 0) / 255;
          for (let c = 0; c < 3; c++) {
            const over = a * (colour.data[i * 4 + c] ?? 0) + (1 - a) * (plate.data[i * 4 + c] ?? 0);
            const want = difference <= MATTE_LO ? (plate.data[i * 4 + c] ?? 0) : (portrait.data[i * 4 + c] ?? 0);
            // Exact up to rounding, except where the un-mixed colour is clamped at 0 or 255.
            const clamped = (colour.data[i * 4 + c] ?? 0) === 0 || (colour.data[i * 4 + c] ?? 0) === 255;
            if (!clamped) expect(Math.abs(over - want), `pixel ${i} channel ${c}`).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 80 },
    );
  });
});

describe("cutNamed with matte: \"plate\"", () => {
  const surface = [150, 135, 90] as const;
  const portrait = ringOn(surface, [60, 200, 255], 4);
  const plate = flat(surface);
  const head = part("dial", "head", rect(0, 0, 1000, 1000));
  const eye = part("eye", "eye", rect(150, 150, 850, 850), { motion: { pulse: { amp: 0.6, freq: 0.5 } } });
  const at = (layer: { image: Rgba; bbox: [number, number, number, number] }, x: number, y: number): number => layer.image.data[((y - layer.bbox[1]) * layer.image.width + x - layer.bbox[0]) * 4 + 3] ?? -1;

  it("keeps the ring and clears the dial inside the polygon", () => {
    const result = cutNamed(portrait, [{ ...eye, matte: "plate" }, head], { plate, feather: 0 });
    const layer = result.layers.find((l) => l.name === "eye");
    expect(layer).toBeDefined();
    if (layer === undefined) return;
    expect(at(layer, 29, 20)).toBe(255);
    expect(at(layer, 20, 20)).toBe(0);
    expect(at(layer, 8, 8)).toBe(0);
  });

  it("without the matte the polygon is opaque over the dial (what a pulse would light)", () => {
    const layer = cutNamed(portrait, [eye, head], { plate, feather: 0 }).layers.find((l) => l.name === "eye");
    expect(layer === undefined ? -1 : at(layer, 20, 20)).toBe(255);
  });

  it("the rig at rest composites back to the portrait", () => {
    const parts = [{ ...eye, matte: "plate" as const }, head];
    const cut = cutNamed(portrait, parts, { plate, feather: 0 });
    const assembled = assembleRig(parts, cut.layers, { id: "ring", name: "Ring", portrait, plate });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const images: Record<string, Rgba> = {};
    for (const [file, bytes] of Object.entries(assembled.value.files)) {
      const decoded = decodeImage(bytes);
      if (decoded.ok) images[file] = decoded.value;
    }
    const out = compositeRig(assembled.value.rig, images, {});
    let worst = 0;
    for (let i = 0; i < SIZE * SIZE * 4; i++) if (i % 4 !== 3) worst = Math.max(worst, Math.abs((out.data[i] ?? 0) - (portrait.data[i] ?? 0)));
    expect(worst).toBeLessThanOrEqual(MATTE_LO + 1);
  });
});

describe("pivot", () => {
  const portrait = flat([120, 110, 90]);
  const head = part("dial", "head", rect(0, 0, 1000, 1000));
  const hand = part("brow", "accessory", rect(300, 200, 400, 600), { follow: "dial", pivot: [350, 575], key: false });

  it("a part's own pivot is its layer's anchor", () => {
    const parts = [hand, head];
    const assembled = assembleRig(parts, cutNamed(portrait, parts).layers, { id: "hand", name: "Hand", portrait });
    expect(assembled.ok).toBe(true);
    const anchor = assembled.ok ? assembled.value.rig.layers.find((l) => l.name === "brow")?.anchor : undefined;
    expect(anchor).toEqual([23, 14]);
  });

  it("parse accepts pivot and matte on a lifted part and rejects them on a plate part or out of range", () => {
    const file = (extra: Partial<NamedPart>, role: NamedPart["role"] = "accessory") => ({ version: 2, parts: [head, { ...part("brow", role, hand.poly), ...extra }] });
    const ok = parseParts(file({ pivot: [350, 575], matte: "plate" }));
    expect(ok.ok && ok.value.named?.[1]).toMatchObject({ pivot: [350, 575], matte: "plate" });
    expect(parseParts(file({ pivot: [350, 1001] })).ok).toBe(false);
    expect(parseParts(file({ pivot: [350, 5.5] })).ok).toBe(false);
    expect(parseParts(file({ pivot: [350, 575] }, "torso")).ok).toBe(false);
    expect(parseParts(file({ matte: "plate" }, "head")).ok).toBe(false);
    expect(parseParts({ version: 2, parts: [head, { ...hand, matte: "edit" }] }).ok).toBe(false);
  });
});
