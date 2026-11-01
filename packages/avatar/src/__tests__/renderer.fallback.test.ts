// Canvas2D fallback and context loss (task 4, req 2) with the counting stubs.
import { defaultLook, poseLayers, type Drive, type Look } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createRenderer } from "../gl/renderer.js";
import { createCanvasStub, createCtx2dStub, createGlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const DRIVE: Drive = { t: 0.2, headYaw: 9, headPitch: -3, jawOpen: 0.7, blink: 0.5, gesture: { name: "tilt", startedAt: 0 } };

function scene(look?: Look) {
  const rig = malakorRig();
  const l = look ?? defaultLook(rig);
  return { rig, look: l, poses: poseLayers(rig, l, DRIVE) };
}

describe("canvas2D fallback", () => {
  it.each(["null", "throw"] as const)("is used when getContext('webgl2') returns %s, drawing every pose once", (webgl2) => {
    const ctx2d = createCtx2dStub();
    const { canvas } = createCanvasStub({ webgl2, ctx2d });
    const { rig, look, poses } = scene();
    const renderer = createRenderer(canvas, rig, fakeAssets(rig));
    renderer.draw(poses, look);
    expect(renderer.info()).toEqual({ mode: "2d", drawCalls: poses.length, textureUploads: 0 });
    expect(ctx2d.count("drawImage")).toBe(poses.length);
  });

  it("places every layer exactly where the WebGL2 renderer does, with the pose opacity", () => {
    const { rig, look, poses } = scene({ ...defaultLook(malakorRig()), emotion: "furious" });
    const gl = createGlStub();
    const glRenderer = createRenderer(createCanvasStub({ webgl2: gl, width: 500, height: 400 }).canvas, rig, fakeAssets(rig));
    gl.reset();
    glRenderer.draw(poses, look);
    const glMatrices = gl.log.filter(([n]) => n === "uniformMatrix3fv").map(([, a]) => {
      const m = a[2] as number[];
      return [m[0], m[1], m[3], m[4], m[6], m[7]];
    });
    const ctx2d = createCtx2dStub();
    const fallback = createRenderer(createCanvasStub({ webgl2: "null", ctx2d, width: 500, height: 400 }).canvas, rig, fakeAssets(rig));
    fallback.draw(poses.map((p, i) => (i === 3 ? { ...p, opacity: 0.25 } : p)), look);
    // Each drawImage is preceded by its layer's transform; the last setTransform resets.
    const layerTransforms = ctx2d.transforms.slice(1, -1);
    expect(layerTransforms).toHaveLength(poses.length);
    layerTransforms.forEach((t, i) => expect(t).toEqual((glMatrices[i] ?? []).map((v) => expect.closeTo(v ?? NaN, 9))));
    expect(ctx2d.alphas).toEqual(poses.map((_, i) => (i === 3 ? 0.25 : 1)));
  });
});

describe("WebGL2 context loss", () => {
  it("switches to canvas2D for the session, frees the GL objects and keeps drawing", () => {
    const gl = createGlStub();
    const stub = createCanvasStub({ webgl2: gl, width: 640, height: 480 });
    const replacement = createCtx2dStub();
    const fresh = createCanvasStub({ webgl2: "null", ctx2d: replacement });
    const { rig, look, poses } = scene();
    const lost: unknown[] = [];
    const renderer = createRenderer(stub.canvas, rig, fakeAssets(rig), {
      replaceCanvas: (canvas) => {
        lost.push(canvas);
        return fresh.canvas;
      },
    });
    renderer.resize(320, 240, 2);
    renderer.draw(poses, look);
    expect(renderer.info().mode).toBe("webgl2");

    gl.lose();
    stub.loseContext();
    expect(lost).toEqual([stub.canvas]);
    expect(renderer.info().mode).toBe("2d");
    expect([...gl.live]).toEqual([]);
    expect([fresh.canvas.width, fresh.canvas.height]).toEqual([640, 480]);

    renderer.draw(poses, look);
    expect(replacement.count("drawImage")).toBe(poses.length);
    expect(renderer.info()).toEqual({ mode: "2d", drawCalls: poses.length, textureUploads: 0 });
    stub.loseContext();
    expect(lost).toHaveLength(1);
  });

  it("still reports mode 2d (drawing nothing) when no replacement canvas exists", () => {
    const gl = createGlStub();
    const stub = createCanvasStub({ webgl2: gl });
    const { rig, look, poses } = scene();
    const renderer = createRenderer(stub.canvas, rig, fakeAssets(rig), { replaceCanvas: () => null });
    stub.loseContext();
    renderer.draw(poses, look);
    expect(renderer.info()).toEqual({ mode: "2d", drawCalls: 0, textureUploads: 0 });
  });

  it("stops listening for loss on dispose", () => {
    const stub = createCanvasStub({ webgl2: createGlStub() });
    const rig = malakorRig();
    const renderer = createRenderer(stub.canvas, rig, fakeAssets(rig));
    expect(stub.listeners()).toBe(1);
    renderer.dispose();
    expect(stub.listeners()).toBe(0);
  });
});
