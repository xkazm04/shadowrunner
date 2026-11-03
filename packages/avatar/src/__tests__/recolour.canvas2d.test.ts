// canvas2d recolour, regions and faces (character-control task 2) on pixels: the fallback's
// offscreen copies run on a pixel surface stub, and the main context records what it drew.
import { defaultLook, poseLayers, regionKey, type Drive, type LayerPose, type Look } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { recolourRgb, rgbToHsl } from "../render/recolour.js";
import { createCanvasStub, createCtx2dStub } from "./glStub.js";
import { asImage, asRigAssets, CAVITY, pixelAssets, pixelOf, pixelRig, pixelSurfaces, ROBE_A, ROBE_B, TEAL, TEETH, type PixelImage, type Rgba } from "./pixels.js";

const DRIVE: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };

function setup(images: Record<string, PixelImage> = pixelAssets(), loadAsset?: (file: string) => Promise<ImageBitmap>) {
  const rig = pixelRig();
  const ctx2d = createCtx2dStub();
  const { canvas } = createCanvasStub({ webgl2: "null", ctx2d, width: 64, height: 64 });
  const surfaces = pixelSurfaces();
  const renderer = createCanvas2dRenderer(canvas, ctx2d.ctx, rig, asRigAssets(images), { surface: surfaces.factory, ...(loadAsset === undefined ? {} : { loadAsset }) });
  /** Draws `look` and returns, per drawn image, what was drawn and its alpha. */
  const draw = (look: Look, poses?: LayerPose[]) => {
    ctx2d.images.length = 0;
    ctx2d.alphas.length = 0;
    ctx2d.filters.length = 0;
    renderer.draw(poses ?? poseLayers(rig, look, DRIVE), look);
    return ctx2d.images.map((image, i) => ({ image, alpha: ctx2d.alphas[i], filter: ctx2d.filters[i] }));
  };
  return { rig, images, renderer, draw, surfaces };
}

const expected = (src: Rgba, hex: string): Rgba => {
  const [r, g, b] = recolourRgb([src[0] / 255, src[1] / 255, src[2] / 255], hex);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), src[3]];
};

describe("canvas2d recolour", () => {
  it("a look equal to the rig draws every layer's own image (pixel-identical to the old path), no offscreen copy", () => {
    const { rig, images, draw, surfaces } = setup();
    const drawn = draw(defaultLook(rig));
    expect(drawn.map((d) => d.image)).toEqual([images["robe.png"], images["jaw.png"], images["eye.png"]]);
    expect(drawn.map((d) => d.filter)).toEqual(["none", "none", "none"]);
    expect(surfaces.made()).toBe(0);
  });

  it("red eye light makes the teal, non-emissive eye red (hue within 10 degrees, lightness kept)", () => {
    const { rig, draw } = setup();
    const look: Look = { ...defaultLook(rig), palette: { ...rig.palette, eye: "#ff0000" } };
    const eye = draw(look)[2];
    const px = pixelOf(eye?.image, 1, 1);
    expect(px).toEqual(expected(TEAL, "#ff0000"));
    const [h, , l] = rgbToHsl([px[0] / 255, px[1] / 255, px[2] / 255]);
    expect(Math.min(h, 1 - h) * 360).toBeLessThan(10);
    expect(l).toBeCloseTo(rgbToHsl([TEAL[0] / 255, TEAL[1] / 255, TEAL[2] / 255])[2], 2);
  });

  it("a region colour changes only its slot's pixels", () => {
    const { rig, draw } = setup();
    const look: Look = { ...defaultLook(rig), regions: { [regionKey("robe", "r2")]: "#00ff00" } };
    const [robe, jaw] = draw(look);
    expect(pixelOf(robe?.image, 2, 3)).toEqual(ROBE_A);
    expect(pixelOf(robe?.image, 12, 3)).toEqual(expected(ROBE_B, "#00ff00"));
    expect(pixelOf(jaw?.image, 0, 3)).toEqual(CAVITY);
  });

  it("the mouth light recolours the jaw's cavity slot and nothing else", () => {
    const { rig, draw } = setup();
    const look: Look = { ...defaultLook(rig), palette: { ...rig.palette, mouth: "#00ffff" } };
    const [robe, jaw, eye] = draw(look);
    expect(pixelOf(jaw?.image, 3, 0)).toEqual(TEETH);
    expect(pixelOf(jaw?.image, 3, 3)).toEqual(expected(CAVITY, "#00ffff"));
    expect(pixelOf(robe?.image, 2, 3)).toEqual(ROBE_A);
    expect(pixelOf(eye?.image, 0, 0)).toEqual(TEAL);
  });

  it("caches per file and recolour key: an unchanged look makes no new copy", () => {
    const { rig, draw, surfaces } = setup();
    const look: Look = { ...defaultLook(rig), palette: { ...rig.palette, eye: "#ff0000" } };
    draw(look);
    const made = surfaces.made();
    draw({ ...look });
    expect(surfaces.made()).toBe(made);
    draw({ ...look, palette: { ...look.palette, eye: "#0000ff" } });
    expect(surfaces.made()).toBe(made + 1);
  });
});

describe("canvas2d faces", () => {
  it("a replace patch at weight 1 hides its base: only the patch is drawn", () => {
    const { rig, images, draw } = setup();
    const look: Look = { ...defaultLook(rig), emotion: "furious" };
    const poses = poseLayers(rig, look, DRIVE);
    expect(poses.find((p) => p.name === "eye_l")?.faces).toEqual([{ family: "anger", weight: 1 }]);
    const drawn = draw(look, poses);
    expect(drawn.map((d) => d.image)).toEqual([images["robe.png"], images["jaw.png"], images["eye_l.anger.png"]]);
    expect(drawn[2]?.alpha).toBe(1);
  });

  it("crossfades a replace face: base at 1 - w, patch at w, recoloured with the layer's light", () => {
    const { rig, draw } = setup();
    const look: Look = { ...defaultLook(rig), emotion: "furious", palette: { ...rig.palette, eye: "#ff0000" } };
    const poses = poseLayers(rig, look, DRIVE).map((p) => (p.name === "eye_l" ? { ...p, faces: [{ family: "anger" as const, weight: 0.25 }] } : p));
    const [, , base, patch] = draw(look, poses);
    expect(base?.alpha).toBeCloseTo(0.75, 9);
    expect(patch?.alpha).toBeCloseTo(0.25, 9);
    expect(pixelOf(patch?.image, 0, 0)).toEqual(expected(TEAL, "#ff0000"));
  });

  it("loads a patch missing from the assets lazily, drawing the base until it is ready", async () => {
    const all = pixelAssets();
    const { ["eye_l.anger.png"]: patch, ...rest } = all;
    const asked: string[] = [];
    const { rig, draw } = setup(rest, (file) => {
      asked.push(file);
      return Promise.resolve(asImage(patch));
    });
    const look: Look = { ...defaultLook(rig), emotion: "furious" };
    expect(draw(look).map((d) => d.image)[2]).toBe(rest["eye.png"]);
    await Promise.resolve();
    expect(draw(look).map((d) => d.image)[2]).toBe(patch);
    expect(asked).toEqual(["eye_l.anger.png"]);
  });
});
