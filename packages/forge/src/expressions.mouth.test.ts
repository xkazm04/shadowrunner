// The rig owns the mouth (llm-avatar-lab): `resetMouth` restores the base inside the mouth region
// with an 8 px feather, and `cutVariants` applies it to the head and jaw when the rig has `mouth`.
import type { Layer, Rig, RigMouth } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { RESET_DROP, RESET_FEATHER, RESET_RX, RESET_RY_ABOVE, RESET_RY_BELOW, cutVariants, mouthWeight, resetMouth } from "./expressions.js";
import type { Rgba } from "./types.js";

const solid = (w: number, h: number, rgba: [number, number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
};
const px = (image: Rgba, x: number, y: number): number[] => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

// A 100 px mouth; the region's centre, half-width and half-heights from the module's constants.
const MOUTH: RigMouth = { cx: 200, lineY: 100, width: 100 };
const CY = MOUTH.lineY + RESET_DROP * MOUTH.width;
const RX = RESET_RX * MOUTH.width;
const UP = RESET_RY_ABOVE * MOUTH.width;
const DOWN = RESET_RY_BELOW * MOUTH.width;

describe("mouthWeight", () => {
  it("1 at the centre and deep inside, 0 on and outside the edge, ramping across the feather", () => {
    expect(mouthWeight(MOUTH, 200, CY)).toBe(1);
    expect(mouthWeight(MOUTH, 200, CY - UP + RESET_FEATHER + 1)).toBe(1);
    expect(mouthWeight(MOUTH, 200, CY - UP)).toBe(0);
    expect(mouthWeight(MOUTH, 200, CY + DOWN + 1)).toBe(0);
    expect(mouthWeight(MOUTH, 200 + RX + 1, CY)).toBe(0);
    expect(mouthWeight(MOUTH, 200 + RX - RESET_FEATHER / 2, CY)).toBeCloseTo(0.5);
    expect(mouthWeight(MOUTH, 200, CY + DOWN - RESET_FEATHER / 4)).toBeCloseTo(0.25);
  });

  it("is symmetric left to right and reaches further into the corners than an ellipse", () => {
    expect(mouthWeight(MOUTH, 200 - 30, CY - 20)).toBe(mouthWeight(MOUTH, 200 + 30, CY - 20));
    const corner = [200 + 0.75 * RX, CY - 0.75 * UP] as const;
    expect(Math.hypot(0.75, 0.75)).toBeGreaterThan(1); // outside the ellipse of the same radii
    expect(mouthWeight(MOUTH, ...corner)).toBeGreaterThan(0);
  });
});

describe("resetMouth", () => {
  // Patch and base at different boxes: base covers [0, 0] .. [400, 300], patch [20, 10] 360 x 280.
  const base = solid(400, 300, [10, 20, 30, 255]);
  const patch = solid(360, 280, [210, 220, 230, 200]);
  const out = resetMouth(patch, [20, 10, 360, 280], base, [0, 0, 400, 300], MOUTH);
  const at = (image: Rgba, x: number, y: number) => px(image, Math.floor(x) - 20, Math.floor(y) - 10);

  it("the centre pixel equals the base, every channel", () => {
    expect(at(out, 200, CY)).toEqual([10, 20, 30, 255]);
  });

  it("a far pixel equals the patch", () => {
    expect(at(out, 20, 10)).toEqual([210, 220, 230, 200]);
    expect(at(out, 379, 289)).toEqual([210, 220, 230, 200]);
  });

  it("inside the feather it lies between them, and the patch is not modified", () => {
    // The pixel whose centre is 3.5 px inside the right edge: about 0.44 base.
    const [r] = at(out, 200 + RX - 4, CY);
    expect(r).toBeGreaterThan(10);
    expect(r).toBeLessThan(210);
    expect(px(patch, 180, 90)).toEqual([210, 220, 230, 200]);
    expect([out.width, out.height]).toEqual([360, 280]);
  });

  it("patch pixels outside the base's box stay the patch's", () => {
    const small = solid(4, 4, [0, 0, 0, 255]);
    const kept = resetMouth(patch, [20, 10, 360, 280], small, [198, Math.floor(CY) - 2, 4, 4], MOUTH);
    expect(at(kept, 200, CY)).toEqual([0, 0, 0, 255]);
    expect(at(kept, 190, CY)).toEqual([210, 220, 230, 200]);
  });
});

describe("cutVariants with Rig.mouth", () => {
  // 120 x 120: a head with eyes and a jaw; the edit repaints everything +40.
  const W = 120;
  const LAYERS: (Pick<Layer, "name" | "kind" | "bbox"> & { rgb: [number, number, number] })[] = [
    { name: "head", kind: "head", bbox: [20, 10, 80, 90], rgb: [150, 140, 130] },
    { name: "eye_l", kind: "eye", bbox: [38, 40, 12, 6], rgb: [40, 220, 200] },
    { name: "jaw", kind: "jaw", bbox: [45, 76, 30, 10], rgb: [120, 60, 60] },
  ];
  const images = new Map(LAYERS.map((l) => [l.name, solid(l.bbox[2], l.bbox[3], [...l.rgb, 255])]));
  const portrait = solid(W, W, [0, 0, 0, 255]);
  for (const l of LAYERS) {
    const [bx, by, w, h] = l.bbox;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) portrait.data.set([...l.rgb, 255], ((by + y) * W + bx + x) * 4);
  }
  const edited = { ...portrait, data: portrait.data.map((v, i) => (i % 4 === 3 ? v : v + 40)) };
  const rig = (mouth?: RigMouth): Rig => ({
    version: 1,
    id: "t",
    name: "T",
    width: W,
    height: W,
    source: "forge",
    palette: { glow: "#ffffff", eye: "#28dcc8", rim: "#ffffff", mouth: "#000000" },
    layers: LAYERS.map(({ name, kind, bbox }, z) => ({ name, kind, bbox, z: z + 2, file: `${name}.png`, anchor: [bbox[0], bbox[1]] })),
    ...(mouth === undefined ? {} : { mouth }),
  });

  it("without mouth the jaw is repainted; with it the jaw keeps its base (no patch) and the eyes keep the edit", () => {
    const before = cutVariants(rig(), images, portrait, edited, "joy");
    expect(Object.keys(before.patches).sort()).toEqual(["eye_l", "head", "jaw"]);
    const after = cutVariants(rig({ cx: 60, lineY: 76, width: 40 }), images, portrait, edited, "joy");
    expect(after.patches.jaw).toBeUndefined();
    expect(after.patches.eye_l).toEqual(before.patches.eye_l);
  });

  it("the head patch shows the base just above the lip line and the edit at the brow", () => {
    const after = cutVariants(rig({ cx: 60, lineY: 76, width: 40 }), images, portrait, edited, "joy");
    const head = after.patches.head;
    if (head === undefined) throw new Error("no head patch");
    const [hx, hy] = head.patch.bbox;
    expect(px(head.image, 60 - hx, 74 - hy).slice(0, 3)).toEqual([150, 140, 130]);
    expect(px(head.image, 60 - hx, 36 - hy).slice(0, 3)).not.toEqual([150, 140, 130]);
  });
});
