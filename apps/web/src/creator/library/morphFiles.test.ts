// companion-lanes requirement 1.3: the web app's rig file lists carry a morph's atlas, motion image
// and sway map, and the motion image and sway map are decoded as data (no premultiply, no colour
// conversion) while every other image is decoded premultiplied, as the renderer wants.
import type { Rig } from "@sr/rig";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extraFiles, rigAssetsOf, rigFiles } from "./assets";

const rig: Rig = {
  version: 1,
  id: "p",
  name: "P",
  width: 64,
  height: 64,
  source: "replay",
  palette: { glow: "#000000", eye: "#ffffff", rim: "#000000", mouth: "#000000" },
  layers: [{ name: "head", z: 1, kind: "head", file: "head.webp", bbox: [0, 0, 64, 64], anchor: [32, 60] }],
  morph: {
    layer: "head",
    atlas: "morph.atlas.webp",
    flow: "morph.flow.png",
    keys: [{ id: "blink", track: "blink", bbox: [0, 0, 8, 8], cell: [0, 0, 8, 8], flowCell: [0, 0, 2, 2], flowMax: 1 }],
    eyes: [[20, 20], [40, 20]],
    sway: { map: "morph.sway.png", amp: 2 },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("a morph rig's files in the web app", () => {
  it("rigFiles and extraFiles list the atlas, the motion image and the sway map", () => {
    expect(rigFiles(rig)).toEqual(["head.webp", "morph.atlas.webp", "morph.flow.png", "morph.sway.png"]);
    expect(extraFiles(rig)).toEqual(["morph.atlas.webp", "morph.flow.png", "morph.sway.png"]);
  });

  it("rigAssetsOf decodes the motion image and sway map raw, the rest premultiplied", async () => {
    const seen: Record<string, ImageBitmapOptions | undefined> = {};
    vi.stubGlobal("createImageBitmap", (blob: Blob, options?: ImageBitmapOptions) => {
      const name = (blob as Blob & { name?: string }).name ?? "";
      seen[name] = options;
      return Promise.resolve({ width: 1, height: 1, close: () => undefined });
    });
    const blobs = Object.fromEntries(rigFiles(rig).map((f) => [f, Object.assign(new Blob([f]), { name: f })]));
    const assets = await rigAssetsOf(rig, blobs);
    expect(Object.keys(assets).sort()).toEqual(rigFiles(rig).sort());
    expect(seen["head.webp"]).toEqual({ premultiplyAlpha: "premultiply" });
    expect(seen["morph.atlas.webp"]).toEqual({ premultiplyAlpha: "premultiply" });
    expect(seen["morph.flow.png"]).toEqual({ premultiplyAlpha: "none", colorSpaceConversion: "none" });
    expect(seen["morph.sway.png"]).toEqual({ premultiplyAlpha: "none", colorSpaceConversion: "none" });
  });
});
