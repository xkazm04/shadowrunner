// The art mouth in both renderers (spark art-mouth): GL at rest issues exactly today's calls; a
// talking frame draws only the head and the jaw with the warp program, each quad grown to the
// field's box, and is back on the base program for the next layer; canvas2D draws a warp (or still)
// rig exactly as a rig without a mouth, whatever the clock carries.
import { defaultLook, poseLayers, type Drive, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { createGlRenderer } from "../gl/renderer.js";
import { blendParams, restWeights } from "../mouth/shapes.js";
import type { MouthPose } from "../mouth/state.js";
import { createCanvasStub, createCtx2dStub, createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const plain = malakorRig();
const warpRig: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, lips: { left: 455, right: 568, upper: 495, lower: 530 } } };
const stillRig: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, render: "still" } };
const look = defaultLook(plain);
const shut: Drive = { t: 0, headYaw: 3, headPitch: 1, jawOpen: 0, blink: 0 };
const talking: Drive = { ...shut, jawOpen: 0.4 };
const HEAD = poseLayers(plain, look, shut).findIndex((p) => p.name === "head");
const JAW = poseLayers(plain, look, shut).findIndex((p) => p.name === "jaw");
const open: MouthPose = { params: { ...blendParams({ ...restWeights(), rest: 0.2, openMid: 0.8 }), smile: 0.5 }, alpha: 1, lips: 1 };

const uniformOf = (args: unknown[]): string | undefined => (args[0] as { uniform?: string } | null)?.uniform;

function glFrame(rig: Rig, drive: Drive, mouth?: MouthPose): GlStub {
  const stub = createGlStub();
  const { canvas } = createCanvasStub({ webgl2: stub, width: 512, height: 512 });
  const renderer = createGlRenderer(stub.gl, canvas, rig, fakeAssets(rig), undefined, () => null);
  stub.reset();
  renderer.draw(poseLayers(rig, look, drive), look, { t: 0, reducedMotion: false, ...(mouth === undefined ? {} : { mouth }) });
  return stub;
}

describe("GL art mouth", () => {
  it("at rest (neutral, jaw shut) issues today's calls exactly", () => {
    const before = glFrame(plain, shut).log;
    expect(glFrame(warpRig, shut).log).toEqual(before);
    expect(glFrame(stillRig, shut).log).toEqual(before);
  });

  it("a still rig never warps, talking or not", () => {
    expect(glFrame(stillRig, talking, open).log).toEqual(glFrame(plain, talking, open).log);
  });

  it("a talking frame warps the head and the jaw only, each quad grown over its rect, then switches off", () => {
    const stub = glFrame(warpRig, talking, open);
    // The warp program is the one bound when the field's uniforms are set.
    let bound: unknown;
    let warpProgram: unknown;
    let baseProgram: unknown;
    for (const [name, args] of stub.log) {
      if (name === "useProgram") {
        bound = args[0];
        baseProgram ??= bound;
      } else if (uniformOf(args) === "u_wLips") warpProgram = bound;
    }
    expect(warpProgram).toBeDefined();
    expect(warpProgram).not.toBe(baseProgram);
    // Which quads were drawn with it, and the program after the last layer.
    const warpedQuads: number[] = [];
    let quad = 0;
    let afterLayers: unknown;
    const layerCount = poseLayers(plain, look, talking).length;
    for (const [name, args] of stub.log) {
      if (name === "useProgram") bound = args[0];
      if (name !== "drawArrays") continue;
      if (quad < layerCount && bound === warpProgram) warpedQuads.push(quad);
      if (quad === layerCount - 1) afterLayers = bound;
      quad += 1;
    }
    expect(quad).toBe(layerCount + 4);
    expect(warpedQuads).toEqual([HEAD, JAW].sort((a, b) => a - b));
    expect(afterLayers).toBe([HEAD, JAW].includes(layerCount - 1) ? warpProgram : baseProgram);
    const draw = stub.log.filter(([name, args]) => name === "uniform4f" && uniformOf(args) === "u_draw").map(([, a]) => a.slice(1) as number[]);
    const rects = stub.log.filter(([name, args]) => name === "uniform4f" && uniformOf(args) === "u_rect").map(([, a]) => a.slice(1) as number[]);
    expect(draw).toHaveLength(2);
    for (const [i, index] of [HEAD, JAW].sort((a, b) => a - b).entries()) {
      const d = draw[i] ?? [];
      const r = rects[index] ?? [];
      expect(d[0]).toBeLessThanOrEqual(r[0] ?? 0);
      expect(d[1]).toBeLessThanOrEqual(r[1] ?? 0);
      expect((d[0] ?? 0) + (d[2] ?? 0)).toBeGreaterThanOrEqual((r[0] ?? 0) + (r[2] ?? 0));
      expect((d[1] ?? 0) + (d[3] ?? 0)).toBeGreaterThanOrEqual((r[1] ?? 0) + (r[3] ?? 0));
    }
    // The jaw carries its drop and the jaw flag; the head neither.
    const layer = stub.log.filter(([name, args]) => name === "uniform4f" && uniformOf(args) === "u_wLayer").map(([, a]) => a.slice(1) as number[]);
    const jawFirst = JAW < HEAD;
    const jaw = layer[jawFirst ? 0 : 1] ?? [];
    const head = layer[jawFirst ? 1 : 0] ?? [];
    expect(jaw[0]).toBeGreaterThan(0);
    expect(jaw[1]).toBe(1);
    expect(head.slice(0, 2)).toEqual([0, 0]);
  });
});

describe("canvas2D with an art mouth", () => {
  function frame(rig: Rig, mouth?: MouthPose) {
    const ctx2d = createCtx2dStub();
    const { canvas } = createCanvasStub({ webgl2: "null", ctx2d, width: 512, height: 512 });
    const renderer = createCanvas2dRenderer(canvas, ctx2d.ctx, rig, fakeAssets(rig), { mouthSurface: () => null });
    renderer.draw(poseLayers(rig, look, talking), look, { t: 0, reducedMotion: false, ...(mouth === undefined ? {} : { mouth }) });
    return { counts: [...ctx2d.counts.entries()].sort(), transforms: ctx2d.transforms, alphas: ctx2d.alphas, filters: ctx2d.filters, images: ctx2d.images.length };
  }

  it("draws a warp or still rig exactly like the same rig without a mouth, whatever the clock carries", () => {
    const today = frame(plain);
    expect(frame(warpRig, open)).toEqual(today);
    expect(frame(stillRig, open)).toEqual(today);
    expect(frame(warpRig)).toEqual(today);
  });
});
