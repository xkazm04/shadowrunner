// cast-forge task 5 (Reveille): `cavity: "gap"`, a mouth drawn open over a dark gap. The open jaw
// uncovers the gap carried up: every column of the jaw as deep as the drop, not a lens, in the
// column's own dark colour under the lip line, or the lip's tones where that row is not dark.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cutNamed } from "./cutNamed.js";
import { rasterizeMask } from "./mask.js";
import { GAP_INSET, GAP_LUMA, liftedJaw, paintCavity } from "./mouth.js";
import { parseParts, toCanvas } from "./parts.js";
import type { NamedPart, Rgba } from "./types.js";

const SIZE = 48;
/** Jaw: rows 24..40, columns 8..40 (of 48). */
const JAW: [number, number][] = [
  [500, 167],
  [500, 854],
  [854, 854],
  [854, 167],
];
const LIP_Y = 24;

/** Brass surface (160, 120, 60); the jaw's first rows are a dark gap whose blue rises with x, except column 30, which is bright. */
function mouth(): Rgba {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    const dark = y >= LIP_Y && y <= LIP_Y + GAP_INSET && x !== 30;
    data.set(dark ? [5, 10, x, 255] : [160, 120, 60, 255], i * 4);
  }
  return { width: SIZE, height: SIZE, data };
}

describe("paintCavity with gap", () => {
  const portrait = mouth();
  const hard = rasterizeMask(toCanvas(JAW, SIZE, SIZE), SIZE, SIZE, 0);

  it("property: every column of the jaw is painted the whole drop deep, in its gap colour or the lip's tones", () => {
    fc.assert(
      fc.property(fc.integer({ min: GAP_INSET + 1, max: 14 }), (drop) => {
        const surface = { ...portrait, data: portrait.data.slice() };
        const { tones } = paintCavity(surface, portrait, hard, liftedJaw(hard), drop, { gap: true });
        const lipTones = [tones.shadow, tones.deep].map((t) => t.join(","));
        for (let x = 8; x < 41; x++) {
          for (let k = GAP_INSET + 1; k < drop; k++) {
            const i = ((LIP_Y + k) * SIZE + x) * 4;
            const got = Array.from(surface.data.subarray(i, i + 3));
            if (x === 30) expect(lipTones, `column ${x} row ${k}: the lip's tones`).toContain(got.join(","));
            else expect(got, `column ${x} row ${k}`).toEqual([5, 10, x]);
          }
          const below = ((LIP_Y + drop) * SIZE + x) * 4;
          expect(Array.from(surface.data.subarray(below, below + 3))).toEqual([160, 120, 60]);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("the gap colour is taken only when dark", () => {
    expect(GAP_LUMA).toBeLessThan(0.299 * 160 + 0.587 * 120 + 0.114 * 60);
  });

  it("cutNamed paints it for a jaw with cavity \"gap\" and parse accepts it", () => {
    const head: NamedPart = { name: "head", role: "head", box_2d: [0, 0, 1000, 1000], poly: [[0, 0], [0, 1000], [1000, 1000], [1000, 0]] };
    const jaw: NamedPart = { name: "jaw", role: "jaw", box_2d: [500, 167, 854, 854], poly: JAW, drop: 0.1, cavity: "gap" };
    expect(parseParts({ version: 2, parts: [head, jaw] }).ok).toBe(true);
    const plate = { ...portrait, data: portrait.data.slice() };
    const layers = cutNamed(portrait, [jaw, head], { plate, feather: 0 }).layers;
    const surface = layers.find((l) => l.name === "head");
    expect(surface).toBeDefined();
    if (surface === undefined) return;
    // Row LIP_Y + 3 at column 12, a corner a lens would leave shallow: the gap colour, carried up.
    const [bx, by, bw] = surface.bbox;
    const i = ((LIP_Y + 3 - by) * bw + 12 - bx) * 4;
    expect(Array.from(surface.image.data.subarray(i, i + 3))).toEqual([5, 10, 12]);
  });
});
