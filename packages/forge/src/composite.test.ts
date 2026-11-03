// compositeRig turns (cast-forge task 4): the review sheet draws a layer's rotation and scale about
// its anchor, so a swaying lure stalk is seen to sway and its bulb is seen to stay on its tip.
import { describe, expect, it } from "vitest";
import { compositeRig } from "./composite.js";
import type { Rgba } from "./types.js";

/** A `w` x `h` opaque white layer image. */
const white = (w: number, h: number): Rgba => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
const lit = (img: Rgba): string[] => {
  const out: string[] = [];
  for (let i = 0; i < img.width * img.height; i++) if ((img.data[i * 4] ?? 0) > 0) out.push(`${i % img.width},${Math.floor(i / img.width)}`);
  return out;
};

describe("compositeRig turns", () => {
  // A 4 x 1 bar at (4, 4)..(8, 5), anchored at the centre of its left pixel.
  const rig = {
    width: 12,
    height: 12,
    layers: [{ name: "bar", z: 2, kind: "accessory" as const, file: "bar.png", bbox: [4, 4, 4, 1] as [number, number, number, number], anchor: [4.5, 4.5] as [number, number] }],
  };
  const images = { "bar.png": white(4, 1) };

  it("turns a layer about its anchor: a quarter turn clockwise hangs the bar straight down", () => {
    const out = compositeRig(rig, images, { turns: { bar: { rotation: Math.PI / 2 } } });
    expect(lit(out)).toEqual(["4,4", "4,5", "4,6", "4,7"]);
  });

  it("turns about the anchor moved by the layer's offset, and scales about it", () => {
    const moved = compositeRig(rig, images, { offsets: { bar: [2, 1] }, turns: { bar: { rotation: Math.PI / 2 } } });
    expect(lit(moved)).toEqual(["6,5", "6,6", "6,7", "6,8"]);
    const stretched = compositeRig(rig, images, { turns: { bar: { rotation: 0, scale: [0.5, 1] } } });
    expect(lit(stretched)).toEqual(["4,4", "5,4"]);
  });

  it("no turn, or a zero turn, draws the layer as before", () => {
    const plain = compositeRig(rig, images);
    expect(lit(plain)).toEqual(["4,4", "5,4", "6,4", "7,4"]);
    expect(compositeRig(rig, images, { turns: { bar: { rotation: 0 } } }).data).toEqual(plain.data);
  });
});
