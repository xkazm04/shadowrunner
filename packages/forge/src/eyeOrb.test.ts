// cast-face-pass shared forge pieces on synthetic art: the glow orb (soft and cell-snapped), the
// eye's own light colour, region sockets, a pixel pupil's eye widened to its lens and socketed by a
// recipe (lens socket, the pupil cut whole as the iris, tint false), an orb recipe, the orb fallback
// for a lit hole, a closed-only eye, per-eye blinks kept, the band's unit for tiny eyes, and a band
// cut that never patches the jaw.
import type { Layer, Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { cutVariants } from "./expressions.js";
import { discBits, ellipseBits, lightColour, orbArt, widenEye } from "./eyeOrb.js";
import { socketEyes } from "./faceEyes.js";
import { BAND_MIN_UNIT, bandUnit, browLidBand } from "./stability.js";
import type { Rgba } from "./types.js";

const W = 200;
const solid = (w: number, h: number, rgb: readonly number[], a = 255): Rgba => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? a : (rgb[i % 4] ?? 0))) });
const at = (img: Rgba, x: number, y: number): number[] => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const crop = (img: Rgba, [x, y, w, h]: Layer["bbox"]): Rgba => {
  const out = solid(w, h, [0, 0, 0]);
  for (let j = 0; j < h; j++) out.data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  return out;
};
const count = (bits: Uint8Array) => bits.reduce((s, v) => s + v, 0);

function rig(layers: Pick<Layer, "name" | "kind" | "bbox" | "emissive" | "motion">[]): Rig {
  return {
    version: 1,
    id: "t",
    name: "T",
    width: W,
    height: W,
    source: "forge",
    palette: { glow: "#ffffff", eye: "#ffe000", rim: "#ffffff", mouth: "#000000" },
    layers: layers.map((l, z) => ({ ...l, z: z + 1, file: `${l.name}.png`, anchor: [l.bbox[0] + l.bbox[2] / 2, l.bbox[1] + l.bbox[3] / 2] })),
  };
}

describe("orbArt and lightColour", () => {
  it("a soft orb: whitened core, the light's colour toward the edge, nothing past the radius", () => {
    const art = orbArt({ cx: 20, cy: 20, r: 8 }, { rgb: [255, 0, 255] });
    const px = (x: number, y: number) => at(art.image, x - art.box[0], y - art.box[1]);
    const core = px(20, 20);
    expect(core[3]).toBe(255);
    expect(core[1]).toBeGreaterThan(80); // whitened
    const ring = px(26, 20);
    expect(ring[3]).toBeGreaterThan(0);
    expect(ring[3]).toBeLessThan(255);
    expect(ring[0]).toBeGreaterThan(ring[1] ?? 0);
    expect(px(29, 20)[3]).toBe(0);
    expect(art.box[0]).toBeLessThanOrEqual(12);
  });

  it("a cell orb is hard pixels, one value per cell", () => {
    const art = orbArt({ cx: 21, cy: 21, r: 7 }, { rgb: [250, 230, 10], cell: 7 });
    const alphas = new Set<number>();
    for (let i = 3; i < art.image.data.length; i += 4) alphas.add(art.image.data[i] ?? 0);
    expect([...alphas].every((a) => a === 0 || a === 255)).toBe(true);
    const px = (x: number, y: number) => at(art.image, x - art.box[0], y - art.box[1]);
    expect(px(19, 19)).toEqual(px(23, 23));
  });

  it("lightColour is the eye's brightest pixels", () => {
    const eye = solid(20, 10, [20, 20, 30]);
    for (let x = 7; x < 13; x++) for (let y = 3; y < 7; y++) eye.data.set([250, 200, 120, 255], (y * 20 + x) * 4);
    expect(lightColour(eye)).toEqual([250, 200, 120]);
  });

  it("region bits", () => {
    expect(Math.abs(count(discBits(40, 40, { cx: 20, cy: 20, r: 10 })) - Math.PI * 100)).toBeLessThan(12);
    expect(count(ellipseBits(40, 20, 20, 10, 15, 5))).toBeGreaterThan(200);
  });
});

/** A pixel face: grey skin, two black lenses (r 26) at (60, 80) and (140, 80), a 14x12 yellow pupil in each. */
function lensFace(): Rgba {
  const img = solid(W, W, [150, 150, 150]);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      for (const lx of [60, 140]) {
        if (Math.hypot(x + 0.5 - lx, y + 0.5 - 80) <= 26) img.data.set([4, 4, 4, 255], (y * W + x) * 4);
        if (x >= lx - 7 && x < lx + 7 && y >= 74 && y < 86) img.data.set([240, 230, 10, 255], (y * W + x) * 4);
      }
    }
  }
  return img;
}

describe("socketEyes recipes", () => {
  const face = lensFace();
  const base = rig([
    { name: "head", kind: "head", bbox: [0, 0, W, W] },
    { name: "eye_r", kind: "eye", bbox: [53, 74, 14, 12] },
    { name: "eye_l", kind: "eye", bbox: [133, 74, 14, 12] },
    { name: "jaw", kind: "jaw", bbox: [70, 150, 60, 20] },
  ]);
  const images = Object.fromEntries(base.layers.map((l) => [l.file, crop(face, l.bbox)]));

  it("a pixel pupil widened to its lens: lens socket, the pupil whole as the iris, tint false", () => {
    let r = base;
    let imgs: Record<string, Rgba> = images;
    const recipes: Record<string, object> = {};
    for (const [name, lx] of [["eye_r", 60], ["eye_l", 140]] as const) {
      const box: Layer["bbox"] = [lx - 26, 54, 52, 52];
      const pupil = imgs[`${name}.png`] as Rgba;
      const lens = discBits(52, 52, { cx: 26, cy: 26, r: 25 });
      ({ rig: r, images: imgs } = widenEye(r, imgs, name, box, lens));
      const eye = imgs[`${name}.png`] as Rgba;
      expect(eye.width).toBe(52);
      expect(at(eye, 26, 26)).toEqual([240, 230, 10, 255]);
      expect(at(eye, 26, 6)).toEqual([4, 4, 4, 255]);
      expect(at(eye, 0, 0)[3]).toBe(0);
      const clean = { ...eye, data: eye.data.slice() };
      for (let y = 20; y < 32; y++) for (let x = 19; x < 33; x++) clean.data.set([4, 4, 4, 255], (y * 52 + x) * 4);
      recipes[name] = { socket: lens, iris: { cx: 26, cy: 26, r: 7 }, irisArt: { image: pupil, box: [19, 20, 14, 12] }, clean, tint: false };
    }
    const out = socketEyes(r, imgs, { eyes: recipes });
    const eye = out.rig.layers.find((l) => l.name === "eye_r");
    const iris = out.rig.layers.find((l) => l.name === "iris_r");
    expect(eye).toMatchObject({ bbox: [34, 54, 52, 52], socket: "eye_r.socket.png", tint: false });
    expect(iris).toMatchObject({ kind: "iris", bbox: [53, 74, 14, 12], anchor: [60, 80], tint: false });
    expect(at(out.files["eye_r.png"] as Rgba, 26, 26)).toEqual([4, 4, 4, 255]);
    expect(count(new Uint8Array((out.files["eye_r.socket.png"] as Rgba).data.filter((_, i) => i % 4 === 3).map((a) => (a >= 128 ? 1 : 0))))).toBeGreaterThan(1800);
    expect(out.notes.join(" ")).toContain("recipe socket");
  });

  it("an orb recipe draws a glow orb in the eye's own light", () => {
    const out = socketEyes(base, images, { eyes: { eye_r: { socket: discBits(14, 12, { cx: 7, cy: 6, r: 6 }), iris: { cx: 7, cy: 6, r: 3 }, orb: { r: 4 } } } });
    const art = out.files["iris_r.png"] as Rgba;
    expect(art.width).toBeLessThanOrEqual(12);
    const edge = at(art, Math.floor(art.width / 2) + 3, Math.floor(art.height / 2));
    expect(edge[2]).toBeLessThan(edge[0] ?? 0); // the pupil's yellow, not white
    expect(out.notes.find((n) => n.startsWith("eye_r"))).toContain("glow orb");
  });

  it("a lit eye with no lit disc (a dark hole) falls back to a glow orb in its opening", () => {
    const hole = solid(30, 20, [140, 120, 60]);
    for (let y = 3; y < 17; y++) for (let x = 5; x < 25; x++) hole.data.set([6, 4, 10, 255], (y * 30 + x) * 4);
    const r = rig([{ name: "head", kind: "head", bbox: [0, 0, W, W] }, { name: "eye_r", kind: "eye", bbox: [50, 50, 30, 20], emissive: true }]);
    const out = socketEyes(r, { "head.png": solid(W, W, [140, 120, 60]), "eye_r.png": hole });
    expect(out.notes[0]).toContain("glow orb");
    const iris = out.rig.layers.find((l) => l.kind === "iris");
    expect(iris?.anchor[0]).toBeCloseTo(65, 0);
  });

  it("a closed-only eye stays one piece with its closed art and its blink", () => {
    const blink = { freq: 0.2, phase: 0.3 };
    const r = rig([{ name: "head", kind: "head", bbox: [0, 0, W, W] }, { name: "eye_r", kind: "eye", bbox: [53, 74, 14, 12], motion: { blink } }]);
    const closed = solid(14, 12, [30, 60, 90]);
    const out = socketEyes(r, images, { eyes: { eye_r: { closedOnly: true, closed } } });
    expect(out.rig.layers.some((l) => l.kind === "iris")).toBe(false);
    expect(out.rig.layers.find((l) => l.name === "eye_r")).toMatchObject({ closed: "eye_r.closed.png", motion: { blink } });
    expect(out.rig.layers.find((l) => l.name === "eye_r")?.socket).toBeUndefined();
    expect(out.files["eye_r.closed.png"]).toBe(closed);
    expect(out.eyes).toHaveLength(0);
  });

  it("each eye keeps its own blink phase; a lit eye's pulse moves to its iris", () => {
    const r = rig([
      { name: "head", kind: "head", bbox: [0, 0, W, W] },
      { name: "eye_r", kind: "eye", bbox: [53, 74, 14, 12], emissive: true, motion: { blink: { freq: 0.25, phase: 0.1 }, pulse: { amp: 0.3, freq: 0.5, phase: 0 } } },
      { name: "eye_l", kind: "eye", bbox: [133, 74, 14, 12], emissive: true, motion: { blink: { freq: 0.25, phase: 0.6 } } },
    ]);
    const lens = discBits(14, 12, { cx: 7, cy: 6, r: 6 });
    const recipe = { socket: lens, iris: { cx: 7, cy: 6, r: 3 }, orb: {} };
    const out = socketEyes(r, images, { eyes: { eye_r: recipe, eye_l: recipe } });
    const by = (n: string) => out.rig.layers.find((l) => l.name === n);
    expect(by("eye_r")?.motion).toEqual({ blink: { freq: 0.25, phase: 0.1 } });
    expect(by("eye_l")?.motion).toEqual({ blink: { freq: 0.25, phase: 0.6 } });
    expect(by("iris_r")?.motion).toEqual({ pulse: { amp: 0.3, freq: 0.5, phase: 0 } });
    expect(by("eye_r")?.emissive).toBe(false);
    expect(by("iris_r")?.emissive).toBeUndefined();
  });
});

describe("band reach and the band cut", () => {
  const tiny = rig([
    { name: "head", kind: "head", bbox: [0, 0, W, W] },
    { name: "eye_r", kind: "eye", bbox: [53, 74, 14, 12] },
    { name: "jaw", kind: "jaw", bbox: [70, 150, 60, 20] },
  ]);

  it("the unit is the widest eye, never under BAND_MIN_UNIT of the width; a reach's unit overrides", () => {
    expect(bandUnit(tiny)).toBe(14);
    expect(bandUnit({ ...tiny, width: 1000 })).toBeCloseTo(BAND_MIN_UNIT * 1000);
    expect(bandUnit(tiny, { unit: 52 })).toBe(52);
    const lens = browLidBand(tiny, { unit: 52, above: 1, below: 0.5, side: 0.5 });
    expect(lens.data[(74 - 50) * W + 60]).toBe(255);
    expect(lens.data[(74 - 70) * W + 60]).toBe(0);
  });

  it("a band cut (no iris layers) patches the brows' head and never the jaw", () => {
    const portrait = solid(W, W, [150, 150, 150]);
    const edited = { ...portrait, data: portrait.data.slice() };
    // Brows raised above the eye and the mouth repainted: only the brows may come through.
    for (let x = 45; x < 75; x++) for (let y = 62; y < 66; y++) edited.data.set([20, 20, 20, 255], (y * W + x) * 4);
    for (let x = 80; x < 120; x++) for (let y = 152; y < 160; y++) edited.data.set([200, 20, 20, 255], (y * W + x) * 4);
    const layers = new Map(tiny.layers.map((l) => [l.name, crop(portrait, l.bbox)]));
    const cut = cutVariants(tiny, layers, portrait, edited, "anger", { unit: 30 }, { band: true });
    expect(Object.keys(cut.patches)).toContain("head");
    expect(Object.keys(cut.patches)).not.toContain("jaw");
    const free = cutVariants(tiny, layers, portrait, edited, "anger");
    expect(Object.keys(free.patches)).toContain("jaw");
  });
});
