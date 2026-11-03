// character-control task 4: the pure glass pick (pick.ts): the posed inverse, the alpha test, the
// region slot from the map, the backdrop never picked, and the traced outline.
import { defaultLook, type LayerPose } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { applyAffine, compose, invert, outlineOf, pickAt, poseAffine, restPoses, traceMask, type Affine, type Pixels } from "./pick";

function image(w: number, h: number, rgba: (x: number, y: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) data.set(rgba(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

const rig = {
  ...testRig(),
  layers: testRig().layers.map((l) =>
    l.name === "head" ? { ...l, regions: { map: "head.regions.png", slots: [{ id: "r1", name: "hood", hex: "#334455" }, { id: "r2", name: "face", hex: "#556677" }] } } : l,
  ),
};

/** Every layer opaque at twice its bbox resolution, except the jaw (clear); the head's map split left / right. */
const pixels: Record<string, Pixels> = Object.fromEntries(rig.layers.map((l) => [l.file, image(l.bbox[2] * 2, l.bbox[3] * 2, () => [9, 9, 9, l.name === "jaw" ? 0 : 255])]));
pixels["head.regions.png"] = image(64, 72, (x) => [x < 32 ? 1 : 2, 0, 0, 255]);
const of = (file: string): Pixels | undefined => pixels[file];

describe("pickAt", () => {
  const poses = restPoses(rig, defaultLook(rig));

  it("finds the topmost opaque layer and its region slot", () => {
    expect(pickAt(rig, poses, [20, 30], of)).toEqual({ layer: "head", slot: "r1" });
    expect(pickAt(rig, poses, [44, 30], of)).toEqual({ layer: "head", slot: "r2" });
    expect(pickAt(rig, poses, [39, 20], of)).toEqual({ layer: "monocle" });
  });

  it("passes over a clear pixel to the layer under it, and never picks the backdrop", () => {
    expect(pickAt(rig, poses, [32, 34], of)).toEqual({ layer: "head", slot: "r2" });
    expect(pickAt(rig, poses, [2, 2], of)).toBeUndefined();
  });

  it("follows a moved, scaled and rotated pose (inverse of the posed transform)", () => {
    const head = rig.layers.find((l) => l.name === "head");
    if (head === undefined) throw new Error("no head");
    const pose: LayerPose = { name: "head", x: head.bbox[0] + 4, y: head.bbox[1], scale: [0.5, 0.5], rotation: Math.PI / 2, opacity: 1, tint: 1 };
    const m = poseAffine(head, pose);
    // The head's top-left pixel, wherever it lands, is still the head's first region.
    const [px, py] = applyAffine(m, [head.bbox[0] + 0.5, head.bbox[1] + 0.5]);
    expect(pickAt(rig, [pose], [px, py], of)).toEqual({ layer: "head", slot: "r1" });
  });

  it("an undecoded image is passed over", () => {
    expect(pickAt(rig, poses, [20, 30], (f) => (f === "head.png" ? undefined : of(f)))?.layer).not.toBe("head");
  });
});

describe("affines", () => {
  const num = fc.double({ min: -5, max: 5, noNaN: true });
  const scale = fc.double({ min: 0.2, max: 3, noNaN: true });
  const turn = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
  it("invert undoes a posed affine: scale, rotation, translation (property)", () => {
    fc.assert(
      fc.property(scale, scale, turn, num, num, num, num, (sx, sy, r, e, f, x, y) => {
        const a: Affine = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, e, f];
        const inv = invert(a);
        expect(inv).toBeDefined();
        if (inv === undefined) return;
        const [bx, by] = applyAffine(compose(inv, a), [x, y]);
        expect(bx).toBeCloseTo(x, 6);
        expect(by).toBeCloseTo(y, 6);
      }),
    );
  });
});

describe("traceMask and outlineOf", () => {
  it("a single cell is outlined by its four edges", () => {
    expect(traceMask(3, 3, (x, y) => x === 1 && y === 1)).toBe("M1 1H2M1 2H2M1 1V2M2 1V2");
    expect(traceMask(4, 4, () => false)).toBe("");
  });

  it("a region's outline comes from its map pixels, cached by the caller per layer and slot", () => {
    const head = rig.layers.find((l) => l.name === "head");
    if (head === undefined) throw new Error("no head");
    const left = outlineOf(head, "r1", of);
    expect(left).toMatchObject({ width: 64, height: 72 });
    expect(left?.d).toContain("M32 0V72");
    expect(outlineOf(head, undefined, of)?.d).toBe("M0 0H64M0 72H64M0 0V72M64 0V72");
  });
});
