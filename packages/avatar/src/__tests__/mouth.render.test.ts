// The drawn mouth in both renderers (spark llm-avatar-lab R3): drawn right after the later of the
// head and the jaw, in the head's frame; never for a rig without `mouth` or a frame without one;
// the GL quad repaints and uploads only when the mouth changed, and is never emissive.
import { defaultLook, poseLayers, type Drive, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { createGlRenderer } from "../gl/renderer.js";
import type { MouthSurfaceFactory } from "../mouth/colours.js";
import { blendParams, restWeights } from "../mouth/shapes.js";
import type { MouthPose } from "../mouth/state.js";
import { createCanvasStub, createCtx2dStub, createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const plain = malakorRig();
const rig: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, render: "drawn" } };
const look = defaultLook(rig);
const DRIVE: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0.3, blink: 0 };
const poses = poseLayers(rig, look, DRIVE);
const HEAD = poses.findIndex((p) => p.name === "head");
const JAW = poses.findIndex((p) => p.name === "jaw");
const pose = (alpha: number, open = 0.5): MouthPose => ({ params: { ...blendParams({ ...restWeights(), rest: 1 - open, openMid: open }), smile: 0.6 }, alpha, lips: 1 });

/** A stand-in for a DOM type the stub cannot construct; only the members the code uses exist. */
const stand = <T extends object>(value: object): T => value as T;

/** 2D surfaces that paint nothing and read a solid skin colour back. */
function mouthSurfaces(): { factory: MouthSurfaceFactory; made: () => number; painted: () => number } {
  let made = 0;
  let painted = 0;
  const factory: MouthSurfaceFactory = (w, h) => {
    made += 1;
    const g = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop: () => undefined });
          if (prop === "getImageData") return (_x: number, _y: number, gw: number, gh: number) => ({ data: new Uint8ClampedArray(gw * gh * 4).fill(200) });
          return () => {
            if (prop === "fill" || prop === "stroke") painted += 1;
          };
        },
        set: () => true,
      },
    );
    return { canvas: stand<OffscreenCanvas>({ width: w, height: h }), g: stand<CanvasRenderingContext2D>(g) };
  };
  return { factory, made: () => made, painted: () => painted };
}

describe("canvas2d mouth", () => {
  function setup(r: Rig) {
    const ctx2d = createCtx2dStub();
    const { canvas } = createCanvasStub({ webgl2: "null", ctx2d, width: 512, height: 512 });
    const surfaces = mouthSurfaces();
    const renderer = createCanvas2dRenderer(canvas, ctx2d.ctx, r, fakeAssets(r), { mouthSurface: surfaces.factory });
    return { ctx2d, renderer, surfaces };
  }

  it("a rig without mouth draws exactly its layers, whatever the clock says", () => {
    const { ctx2d, renderer, surfaces } = setup(plain);
    renderer.draw(poseLayers(plain, look, DRIVE), look, { t: 0, reducedMotion: false, mouth: pose(1) });
    expect(ctx2d.count("fill")).toBe(0);
    expect(surfaces.made()).toBe(0);
    expect(renderer.info().drawCalls).toBe(poses.length);
  });

  it("a frame without a mouth (neutral rest) draws nothing extra", () => {
    const { ctx2d, renderer } = setup(rig);
    renderer.draw(poses, look, { t: 0, reducedMotion: false });
    expect(ctx2d.count("fill")).toBe(0);
    expect(ctx2d.images).toHaveLength(poses.length);
  });

  it("paints the cover and the lips right after the jaw, in the head's frame", () => {
    const { ctx2d, renderer } = setup(rig);
    renderer.draw(poses, look, { t: 0, reducedMotion: false, mouth: pose(1) });
    expect(ctx2d.count("fill")).toBeGreaterThan(1);
    // The cover patch is the one image drawn that is not a layer: right after the later of head and jaw.
    const host = Math.max(HEAD, JAW);
    expect(ctx2d.images).toHaveLength(poses.length + 1);
    expect(ctx2d.images[host + 1]).not.toBe(fakeAssets(rig)[rig.layers.find((l) => l.name === poses[host + 1]?.name)?.file ?? ""]);
    expect(renderer.info().drawCalls).toBe(poses.length + 1);
  });
});

describe("WebGL mouth", () => {
  function setup(r: Rig) {
    const stub = createGlStub();
    const { canvas } = createCanvasStub({ webgl2: stub, width: 512, height: 512 });
    const surfaces = mouthSurfaces();
    const renderer = createGlRenderer(stub.gl, canvas, r, fakeAssets(r), undefined, surfaces.factory);
    return { stub, renderer, surfaces };
  }
  const emissiveAt = (stub: GlStub): unknown[] =>
    stub.log.filter(([name, args]) => name === "uniform1f" && (args[0] as { uniform?: string } | null)?.uniform === "u_emissive").map(([, args]) => args[1]);

  it("a rig without mouth draws layers + 4, as before", () => {
    const { stub, renderer } = setup(plain);
    stub.reset();
    renderer.draw(poseLayers(plain, look, DRIVE), look, { t: 0, reducedMotion: false, mouth: pose(1) });
    expect(stub.count("drawArrays")).toBe(poses.length + 4);
    expect(stub.count("texImage2D")).toBe(0);
  });

  it("draws one non-emissive quad after the jaw, uploading only when the mouth changes", () => {
    const { stub, renderer, surfaces } = setup(rig);
    stub.reset();
    renderer.draw(poses, look, { t: 0, reducedMotion: false, mouth: pose(1) });
    expect(stub.count("drawArrays")).toBe(poses.length + 5);
    expect(stub.count("texImage2D")).toBe(1);
    expect(surfaces.painted()).toBeGreaterThan(0);
    // One u_emissive per layer, the mouth's right after the host layer's: 0, so it writes no glow.
    const emissive = emissiveAt(stub);
    expect(emissive).toHaveLength(poses.length + 1);
    expect(emissive[Math.max(HEAD, JAW) + 1]).toBe(0);

    const uploads = renderer.info().textureUploads;
    stub.reset();
    renderer.draw(poses, look, { t: 0, reducedMotion: false, mouth: pose(1) });
    expect(stub.count("texImage2D") + stub.count("texSubImage2D")).toBe(0);
    expect(renderer.info().textureUploads).toBe(uploads);

    stub.reset();
    renderer.draw(poses, look, { t: 0, reducedMotion: false, mouth: pose(1, 0.9) });
    expect(stub.count("texSubImage2D")).toBe(1);
    expect(stub.count("texImage2D")).toBe(0);

    stub.reset();
    renderer.draw(poses, look, { t: 0, reducedMotion: false });
    expect(stub.count("drawArrays")).toBe(poses.length + 4);
  });

  it("frees its texture on dispose", () => {
    const { stub, renderer } = setup(rig);
    renderer.draw(poses, look, { t: 0, reducedMotion: false, mouth: pose(1) });
    renderer.dispose();
    expect([...stub.live].filter((h) => (h as { kind: string }).kind === "Texture")).toHaveLength(0);
  });
});
