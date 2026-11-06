// face-control WP-B: the face-stability metric on synthetic edits. An iris moved by the edit is found
// again within 1 px; a change outside the brow+lid band (the mouth, the cheeks) counts outside, a
// brow change inside; the band covers the brows and lids and not the mouth; registerEdit undoes a
// re-render's offset; socketVariant marks a face whose lids close in as narrowed and paints its iris out.
import type { Layer, Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { faceShape } from "./expressions.js";
import { socketEyes, socketVariant } from "./faceEyes.js";
import { IRIS_DRIFT_LIMIT, browLidBand, faceStability, isStable, outsideLimit, registerEdit, warpEdit } from "./stability.js";
import type { Rgba } from "./types.js";

const W = 160;
const solid = (w: number, h: number, rgb: readonly number[]): Rgba => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (rgb[i % 4] ?? 0))) });
const EYE: Layer["bbox"] = [50, 60, 30, 16];
const LAYERS: Pick<Layer, "name" | "kind" | "bbox">[] = [
  { name: "head", kind: "head", bbox: [20, 20, 120, 130] },
  { name: "eye_r", kind: "eye", bbox: EYE },
  { name: "eye_l", kind: "eye", bbox: [90, 60, 30, 16] },
  { name: "jaw", kind: "jaw", bbox: [60, 120, 40, 14] },
];
const RIG: Rig = {
  version: 1,
  id: "t",
  name: "T",
  width: W,
  height: W,
  source: "forge",
  palette: { glow: "#ffffff", eye: "#ffffff", rim: "#ffffff", mouth: "#000000" },
  layers: LAYERS.map((l, z) => ({ ...l, z: z + 1, file: `${l.name}.png`, anchor: [l.bbox[0], l.bbox[1]], ...(l.kind === "eye" ? { emissive: false } : {}) })),
};

/** A face: skin, two white almond eyes with irises at (x offset dx), a dark mouth, a brow bar. */
function face({ dx = 0, ry = 6, mouth = [90, 30, 30], brow = 0 }: { dx?: number; ry?: number; mouth?: readonly number[]; brow?: number } = {}): Rgba {
  const img = solid(W, W, [0, 0, 0]);
  const set = (x: number, y: number, c: readonly number[]) => img.data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * W + x) * 4);
  for (let y = 20; y < 150; y++) for (let x = 20; x < 140; x++) set(x, y, [190, 150, 130]);
  for (const [ex, ey] of [[65, 68], [105, 68]] as const) {
    for (let y = ey - 9; y <= ey + 9; y++) {
      for (let x = ex - 14; x <= ex + 14; x++) {
        const open = ((x + 0.5 - ex) / 13) ** 2 + ((y + 0.5 - ey) / ry) ** 2 <= 1;
        if (!open) continue;
        const d = Math.hypot(x + 0.5 - ex - dx, y + 0.5 - ey);
        set(x, y, d <= 5 ? (d <= 2 ? [10, 10, 10] : [50, 100, 160]) : [235, 235, 230]);
      }
    }
    for (let x = ex - 12; x <= ex + 12; x++) for (let y = 50 - brow; y < 53 - brow; y++) set(x, y, [60, 40, 30]);
  }
  for (let y = 124; y < 130; y++) for (let x = 66; x < 94; x++) set(x, y, mouth);
  return img;
}

const LAYER_IMAGES = (img: Rgba): Map<string, Rgba> => new Map(RIG.layers.map((l) => [l.name, cropTo(img, l.bbox)]));
const cropTo = (img: Rgba, [x, y, w, h]: Layer["bbox"]): Rgba => {
  const out = solid(w, h, [0, 0, 0]);
  for (let j = 0; j < h; j++) out.data.set(img.data.subarray(((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4), j * w * 4);
  return out;
};
const BASE = face();
const SHAPE = faceShape(RIG, LAYER_IMAGES(BASE));
const EYES = {
  eye_r: { bbox: EYE, iris: { cx: 65, cy: 68, r: 5 }, look: "white" as const },
  eye_l: { bbox: RIG.layers[2]?.bbox ?? EYE, iris: { cx: 105, cy: 68, r: 5 }, look: "white" as const },
};

describe("faceStability", () => {
  it("an unchanged face is still", () => {
    const s = faceStability(BASE, BASE, RIG, SHAPE, EYES);
    expect(s).toMatchObject({ irisDriftPx: 0, outsideBandMean: 0, bandMean: 0 });
  });

  it("an iris moved sideways by 6 px drifts 6 px (within 1)", () => {
    const s = faceStability(face({ dx: 6 }), BASE, RIG, SHAPE, EYES);
    expect(Math.abs(s.irisDriftPx - 6)).toBeLessThanOrEqual(1);
    expect(isStable(s)).toBe(false);
    expect(s.outsideBandMean).toBe(0);
  });

  it("a brow change counts in the band only; a mouth change outside only", () => {
    const brow = faceStability(face({ brow: 4 }), BASE, RIG, SHAPE, EYES);
    expect(brow.bandMean).toBeGreaterThan(0);
    expect(brow.outsideBandMean).toBe(0);
    expect(brow.irisDriftPx).toBeLessThanOrEqual(IRIS_DRIFT_LIMIT);
    const mouth = faceStability(face({ mouth: [200, 40, 40] }), BASE, RIG, SHAPE, EYES);
    expect(mouth.bandMean).toBe(0);
    expect(mouth.outsideBandMean).toBeGreaterThan(0);
  });

  it("the outside limit is the editor's floor plus the margin, else the fixed limit", () => {
    expect(outsideLimit(5)).toBeGreaterThan(5);
    expect(outsideLimit()).toBeGreaterThan(outsideLimit(1));
  });

  it("the band holds the brows and lids, not the mouth", () => {
    const band = browLidBand(RIG);
    expect(band.data[51 * W + 65]).toBeGreaterThan(0);
    expect(band.data[68 * W + 65]).toBe(255);
    expect(band.data[126 * W + 80]).toBe(0);
  });

  it("the box is at full weight to its edge (the feather lies outside it); a character's reach moves the edge", () => {
    const band = browLidBand(RIG);
    const top = 60 - Math.ceil(0.9 * 30); // eye top 60, LID_BAND_ABOVE 0.9 of the 30 px eye
    expect(band.data[top * W + 65]).toBe(255);
    expect(band.data[(top - 20) * W + 65]).toBe(0);
    const tall = browLidBand(RIG, { above: 1.5 });
    expect(tall.data[(60 - 44) * W + 65]).toBe(255);
  });
});

describe("registerEdit", () => {
  it("undoes a re-render's 3 px move and 2% zoom", () => {
    const moved = warpEdit(BASE, 1.02, 3, -2, 80, 85);
    const fit = registerEdit(moved, BASE, RIG, SHAPE);
    expect(Math.abs(fit.scale - 1 / 1.02)).toBeLessThan(0.01);
    expect(faceStability(fit.image, BASE, RIG, SHAPE, EYES).outsideBandMean).toBeLessThan(faceStability(moved, BASE, RIG, SHAPE, EYES).outsideBandMean / 2);
  });
});

describe("socketVariant", () => {
  const images = Object.fromEntries(RIG.layers.map((l) => [l.file, cropTo(BASE, l.bbox)]));
  const socketed = socketEyes(RIG, images);

  it("socketEyes adds an iris layer after each eye and gives the eye its socket and closed art", () => {
    expect(socketed.rig.layers.map((l) => l.name)).toEqual(["head", "eye_r", "iris_r", "eye_l", "iris_l", "jaw"]);
    const eye = socketed.rig.layers.find((l) => l.name === "eye_r");
    expect(eye).toMatchObject({ socket: "eye_r.socket.png", closed: "eye_r.closed.png" });
    const iris = socketed.rig.layers.find((l) => l.name === "iris_r");
    expect(iris).toMatchObject({ kind: "iris", follow: "eye_r" });
    expect(Math.abs((iris?.anchor[0] ?? 0) - 65)).toBeLessThanOrEqual(2);
  });

  it("a face whose lids close in is narrowed; one that keeps them is not", () => {
    const eye = socketed.eyes.find((e) => e.name === "eye_r");
    if (eye === undefined) throw new Error("eye_r not socketed");
    const shut = socketVariant(eye, cropTo(face({ ry: 3 }), EYE));
    expect(shut.narrowed).toBe(true);
    expect(shut.drift).toBe(0);
    const open = socketVariant(eye, cropTo(BASE, EYE));
    expect(open.narrowed).toBe(false);
  });
});
