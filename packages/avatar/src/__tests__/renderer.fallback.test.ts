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
    // u_m is a Float32Array (perfection-pass P1): the same doubles, rounded to float32 as GL holds them.
    layerTransforms.forEach((t, i) => expect(t.map((v) => Math.fround(v))).toEqual(glMatrices[i]));
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

  it("stops listening for loss and restore on dispose", () => {
    const stub = createCanvasStub({ webgl2: createGlStub() });
    const rig = malakorRig();
    const renderer = createRenderer(stub.canvas, rig, fakeAssets(rig));
    expect(stub.listeners()).toBe(2);
    renderer.dispose();
    expect(stub.listeners()).toBe(0);
  });
});

describe("WebGL2 context restore (perfection-pass P1)", () => {
  function lostRenderer() {
    const gl = createGlStub();
    const stub = createCanvasStub({ webgl2: gl, width: 640, height: 480 });
    const replacement = createCtx2dStub();
    const fresh = createCanvasStub({ webgl2: "null", ctx2d: replacement });
    const { rig, look, poses } = scene();
    const restored: Array<[unknown, unknown]> = [];
    const renderer = createRenderer(stub.canvas, rig, fakeAssets(rig), {
      replaceCanvas: () => fresh.canvas,
      restoreCanvas: (standIn, original) => restored.push([standIn, original]),
    });
    renderer.resize(320, 240, 2);
    renderer.draw(poses, look);
    gl.lose();
    const prevented = stub.loseContext();
    return { gl, stub, fresh, replacement, rig, look, poses, renderer, restored, prevented };
  }

  it("asks the browser to restore, then rebuilds programs, textures and targets and draws with WebGL2 again", () => {
    const t = lostRenderer();
    expect(t.prevented).toBe(true);
    expect(t.renderer.info().mode).toBe("2d");
    t.renderer.resize(300, 200, 2);
    t.gl.restore();
    t.gl.reset();
    t.stub.restoreContext();
    expect(t.renderer.info().mode).toBe("webgl2");
    expect(t.gl.count("createProgram")).toBeGreaterThan(0);
    expect(t.gl.count("texImage2D")).toBe(t.rig.layers.length);
    expect([...t.gl.live].filter((h) => (h as { kind?: string }).kind === "Framebuffer")).toHaveLength(3);
    expect(t.restored).toEqual([[t.fresh.canvas, t.stub.canvas]]);
    expect([t.stub.canvas.width, t.stub.canvas.height]).toEqual([600, 400]);
    t.gl.reset();
    const drawsBefore = t.replacement.count("drawImage");
    t.renderer.draw(t.poses, t.look);
    expect(t.gl.count("drawArrays")).toBe(t.poses.length + 4);
    expect(t.replacement.count("drawImage")).toBe(drawsBefore);
  });

  it("swaps to canvas2D again on a second loss, and frees everything on dispose", () => {
    const t = lostRenderer();
    t.gl.restore();
    t.stub.restoreContext();
    expect(t.renderer.info().mode).toBe("webgl2");
    t.gl.lose();
    t.stub.loseContext();
    expect(t.renderer.info().mode).toBe("2d");
    expect([...t.gl.live]).toEqual([]);
    t.renderer.dispose();
    expect(t.stub.listeners()).toBe(0);
  });

  it("ignores a restore without a loss, and keeps canvas2D when the context is still lost", () => {
    const t = lostRenderer();
    t.stub.restoreContext();
    expect(t.renderer.info().mode).toBe("2d");
    expect(t.restored).toEqual([]);
    const gl = createGlStub();
    const stub = createCanvasStub({ webgl2: gl });
    const rig = malakorRig();
    const renderer = createRenderer(stub.canvas, rig, fakeAssets(rig), { replaceCanvas: () => null });
    stub.restoreContext();
    expect(renderer.info().mode).toBe("webgl2");
    expect(gl.count("createProgram")).toBe(6);
  });
});
