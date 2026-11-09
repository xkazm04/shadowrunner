// WebGL2 recolour, regions and faces (character-control task 2) against the counting GL stub (no
// GPU under vitest; the shader's arithmetic is checked in recolour.test.ts): uniforms per layer,
// nearest-sampled index maps, lazy face patches, the replace rule, the brow rule, the mood fader.
import { defaultLook, poseLayers, regionKey, type Drive, type Layer, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createRenderer } from "../gl/renderer.js";
import { BROW_STEP, lookLight } from "../render/frame.js";
import { hexToHsl, layerRecolour } from "../render/recolour.js";
import { moodFader } from "../react/AvatarCanvas.js";
import { createCanvasStub, createGlStub, type GlStub } from "./glStub.js";
import { malakorRig } from "./malakor.js";
import { asImage, asRigAssets, pixelAssets, pixelRig, type PixelImage } from "./pixels.js";

const DRIVE: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };

function uniformCalls(stub: GlStub, method: string, uniform: string): unknown[][] {
  return stub.log.filter(([name, args]) => name === method && (args[0] as { uniform?: string } | null)?.uniform === uniform).map(([, args]) => args.slice(1));
}

function setup(images: Record<string, PixelImage> = pixelAssets(), loadAsset?: (file: string) => Promise<ImageBitmap>) {
  const stub = createGlStub();
  const rig = pixelRig();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 64, height: 64 }).canvas, rig, asRigAssets(images), loadAsset === undefined ? {} : { loadAsset });
  const draw = (look: Look) => {
    stub.reset();
    renderer.draw(poseLayers(rig, look, DRIVE), look);
  };
  return { stub, rig, renderer, draw };
}

describe("GL recolour", () => {
  it("a look equal to the rig sets u_recolour 0 on every layer and keeps the old gains", () => {
    const { stub, rig, draw } = setup();
    draw(defaultLook(rig));
    expect(uniformCalls(stub, "uniform1f", "u_recolour")).toEqual([[0], [0], [0]]);
    expect(uniformCalls(stub, "uniform4f", "u_light")).toEqual([]);
    expect(uniformCalls(stub, "uniform3f", "u_gain")).toEqual([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  });

  it("red eye light recolours the non-emissive eye (u_light = red's HSL, every pixel)", () => {
    const { stub, rig, draw } = setup();
    draw({ ...defaultLook(rig), palette: { ...rig.palette, eye: "#ff0000" } });
    expect(uniformCalls(stub, "uniform1f", "u_recolour")).toEqual([[0], [0], [1]]);
    expect(uniformCalls(stub, "uniform4f", "u_light")).toEqual([[...hexToHsl("#ff0000"), 1]]);
    expect(hexToHsl("#ff0000")[0]).toBe(0);
  });

  it("uploads region maps with their layer, nearest and unmipmapped, and enables only the set slot", () => {
    const { stub, rig, renderer, draw } = setup();
    expect(renderer.info().textureUploads).toBe(5); // 3 layers + 2 maps
    draw({ ...defaultLook(rig), regions: { [regionKey("robe", "r2")]: "#00ff00" } });
    expect(uniformCalls(stub, "uniform4f", "u_slotOn")).toEqual([[0, 1, 0, 0]]);
    const slots = uniformCalls(stub, "uniform3fv", "u_slots")[0]?.[0] as number[];
    expect(slots.slice(3, 6)).toEqual(hexToHsl("#00ff00"));
    const fresh = createGlStub();
    createRenderer(createCanvasStub({ webgl2: fresh }).canvas, rig, asRigAssets(pixelAssets()));
    const nearest = fresh.log.filter(([n, a]) => n === "texParameteri" && a[2] === fresh.gl.NEAREST);
    expect(nearest).toHaveLength(4); // MIN and MAG for each of the two maps
    expect(fresh.count("generateMipmap")).toBe(3);
  });

  it("mouth light takes a `cavity` slot on any layer (a head included), and a layer named mouth_glow", () => {
    const rig = pixelRig();
    const head: Layer = { name: "head", z: 0, kind: "head", file: "head.png", bbox: [0, 0, 16, 16], anchor: [8, 8], regions: { map: "head.regions.png", slots: [{ id: "r1", name: "head", hex: "#808080" }, { id: "cavity", name: "mouth", hex: "#300000" }] } };
    const glow: Layer = { name: "mouth_glow", z: 9, kind: "accessory", file: "mouth_glow.png", bbox: [0, 0, 4, 4], anchor: [2, 2] };
    const look: Look = { ...defaultLook(rig), palette: { ...rig.palette, mouth: "#00ff00" } };
    expect(layerRecolour(rig, head, look)?.slots.map((s) => s !== undefined)).toEqual([false, true, false, false]);
    expect(layerRecolour(rig, glow, look)?.light).toMatchObject({ name: "mouth", mode: "all" });
  });
});

describe("GL faces", () => {
  it("a replace patch at weight 1 hides its base: one quad, the patch's rect, opacity 1", () => {
    const { stub, rig, draw } = setup();
    draw({ ...defaultLook(rig), emotion: "furious" });
    // + 1: the pixel rig has no emissive layer, so the glow pass is the composite alone (perfection-pass P1).
    expect(stub.count("drawArrays")).toBe(3 + 1);
    expect(uniformCalls(stub, "uniform4f", "u_rect")[2]).toEqual([2, 0, 4, 2]);
    expect(uniformCalls(stub, "uniform1f", "u_opacity")[2]).toEqual([1]);
  });

  it("loads a patch lazily: the base draws until it is ready, then the patch (uploaded once)", async () => {
    const { ["eye_l.anger.png"]: patch, ...rest } = pixelAssets();
    const asked: string[] = [];
    const { stub, rig, renderer, draw } = setup(rest, (file) => {
      asked.push(file);
      return Promise.resolve(asImage(patch));
    });
    const look: Look = { ...defaultLook(rig), emotion: "furious" };
    draw(look);
    expect(uniformCalls(stub, "uniform4f", "u_rect")[2]).toEqual([2, 0, 4, 4]);
    await Promise.resolve();
    draw(look);
    expect(uniformCalls(stub, "uniform4f", "u_rect")[2]).toEqual([2, 0, 4, 2]);
    draw(look);
    expect(stub.count("texImage2D")).toBe(0);
    expect(asked).toEqual(["eye_l.anger.png"]);
    expect(renderer.info().textureUploads).toBe(6);
  });
});

describe("brow rule", () => {
  it("a rig with brow layers gets no eye brow shift; one without keeps BROW_STEP", () => {
    const rig = malakorRig();
    const look: Look = { ...defaultLook(rig), emotion: "theatrical" };
    expect(lookLight(rig, look).browY).toBeCloseTo(-3 * BROW_STEP * rig.height, 9);
    const browed: Rig = { ...rig, layers: [...rig.layers, { name: "brow_l", z: 999, kind: "static", file: "brow_l.png", bbox: [0, 0, 1, 1], anchor: [0, 0] }] };
    expect(lookLight(browed, look).browY).toBe(0);
  });
});

describe("moodFader", () => {
  it("fades from the previous emotion over MOOD_FADE_S; instant under reduced motion", () => {
    const fade = moodFader();
    expect(fade("neutral", 0, false)).toBeUndefined();
    expect(fade("furious", 1, false)).toEqual({ from: "neutral", mix: 0 });
    expect(fade("furious", 1.125, false)?.mix).toBeCloseTo(0.5, 9);
    expect(fade("furious", 1.25, false)).toBeUndefined();
    expect(fade("bored", 2, true)).toBeUndefined();
  });
});
