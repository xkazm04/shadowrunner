// WebGL2 renderer (task 3.5, req 1, 7.1, 7.2) against the counting GL stub: exact draw and upload
// counts, z order, look uniforms without context recreation, and a complete dispose.
import { defaultLook, poseLayers, type Drive, type Look } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { glowGain, GLOW_GAIN } from "../gl/glow.js";
import { createRenderer } from "../gl/renderer.js";
import { hexToRgb, RIM_STRENGTH } from "../render/frame.js";
import { createCanvasStub, createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const drive = (t: number, over: Partial<Drive> = {}): Drive => ({ t, headYaw: 6 * Math.sin(t), headPitch: 2 * Math.cos(t), jawOpen: 0.5 + 0.5 * Math.sin(3 * t), blink: 0, ...over });

function setup() {
  const stub = createGlStub();
  const { canvas } = createCanvasStub({ webgl2: stub, width: 640, height: 480 });
  const rig = malakorRig();
  const renderer = createRenderer(canvas, rig, fakeAssets(rig));
  return { stub, canvas, rig, renderer };
}

/** Arguments of every call to `uniform` method `name` on the uniform `uniform`, in order. */
function uniformCalls(stub: GlStub, method: string, uniform: string): unknown[][] {
  return stub.log.filter(([name, args]) => name === method && (args[0] as { uniform?: string } | null)?.uniform === uniform).map(([, args]) => args.slice(1));
}

describe("WebGL2 renderer", () => {
  it("issues exactly visible layers + 4 draw calls per frame for 120 frames, uploading once per layer", () => {
    const { stub, rig, renderer } = setup();
    const look = defaultLook(rig);
    expect(stub.count("texImage2D")).toBe(rig.layers.length);
    for (let frame = 0; frame < 120; frame += 1) {
      const poses = poseLayers(rig, look, drive(frame / 60));
      stub.reset();
      renderer.draw(poses, look, { t: frame / 60, reducedMotion: false });
      expect(stub.count("drawArrays")).toBe(poses.length + 4);
      expect(renderer.info()).toEqual({ mode: "webgl2", drawCalls: poses.length + 4, textureUploads: rig.layers.length });
      expect(stub.count("texImage2D")).toBe(0);
    }
  });

  it("counts only the poses it is given (a look hiding layers draws fewer, uploads nothing)", () => {
    const { stub, rig, renderer } = setup();
    const look: Look = { ...defaultLook(rig), hidden: ["monocle", "shard_c"] };
    const poses = poseLayers(rig, look, drive(0));
    stub.reset();
    renderer.draw(poses, look);
    expect(poses).toHaveLength(rig.layers.length - 2);
    expect(stub.count("drawArrays")).toBe(rig.layers.length - 2 + 4);
    expect(stub.count("texImage2D")).toBe(0);
  });

  it("draws one quad per pose in the order poseLayers returns", () => {
    const { stub, rig, renderer } = setup();
    const look = defaultLook(rig);
    const poses = poseLayers(rig, look, drive(1));
    stub.reset();
    renderer.draw(poses, look);
    const rects = uniformCalls(stub, "uniform4f", "u_rect");
    const expected = poses.map((p) => rig.layers.find((l) => l.name === p.name)?.bbox);
    expect(rects).toEqual(expected);
  });

  it("blends premultiplied and uploads premultiplied textures", () => {
    const { stub, renderer, rig } = setup();
    expect(stub.log.some(([n, a]) => n === "pixelStorei" && a[0] === stub.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL && a[1] === true)).toBe(true);
    stub.reset();
    renderer.draw(poseLayers(rig, defaultLook(rig), drive(0)), defaultLook(rig));
    expect(stub.log.some(([n, a]) => n === "blendFunc" && a[0] === stub.gl.ONE && a[1] === stub.gl.ONE_MINUS_SRC_ALPHA)).toBe(true);
  });

  it("applies rim, eye colour x eyeGain and glow tint from the look, without a new context or upload", () => {
    const { stub, rig, renderer } = setup();
    const look: Look = { palette: { glow: "#204080", eye: "#80ff40", rim: "#ff0000", mouth: "#000000" }, hidden: [], emotion: "furious" };
    const poses = poseLayers(rig, look, drive(0));
    stub.reset();
    renderer.setLook(look);
    renderer.draw(poses, look);
    expect(stub.count("texImage2D")).toBe(0);
    expect(stub.count("createProgram")).toBe(0);
    const rims = uniformCalls(stub, "uniform3f", "u_rim");
    poses.forEach((pose, i) => {
      const kind = rig.layers.find((l) => l.name === pose.name)?.kind;
      expect(rims[i]).toEqual(kind === "jaw" || kind === "eye" ? [0, 0, 0] : [1 * RIM_STRENGTH, 0, 0]);
    });
    const gains = uniformCalls(stub, "uniform3f", "u_gain");
    const eyeIndex = poses.findIndex((p) => p.name === "eye_l");
    const [er, eg, eb] = hexToRgb("#80ff40");
    const tint = poses[eyeIndex]?.tint ?? NaN;
    expect(gains[eyeIndex]).toEqual([er * 2 * tint, eg * 2 * tint, eb * 2 * tint].map((v) => expect.closeTo(v, 6)));
    const torsoIndex = poses.findIndex((p) => p.name === "torso");
    expect(gains[torsoIndex]).toEqual([1, 1, 1]);
    const [gr, gg, gb] = hexToRgb("#204080");
    expect(uniformCalls(stub, "uniform3f", "u_tint")[0]).toEqual([gr * GLOW_GAIN, gg * GLOW_GAIN, gb * GLOW_GAIN].map((v) => expect.closeTo(v, 6)));
  });

  it("pulses the glow on the driver clock, and holds it steady under reduced motion", () => {
    const steady = [0, 0.7, 1.3, 2.9].map((t) => glowGain({ t, reducedMotion: true }));
    expect(new Set(steady)).toEqual(new Set([GLOW_GAIN]));
    expect(glowGain(undefined)).toBe(GLOW_GAIN);
    expect(glowGain({ t: 1, reducedMotion: false })).not.toBeCloseTo(glowGain({ t: 3, reducedMotion: false }), 3);
  });

  it("re-allocates its targets on resize and frees every GL object on dispose", () => {
    const { stub, canvas, rig, renderer } = setup();
    renderer.resize(400, 300, 2);
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    renderer.setRig(rig, fakeAssets(rig));
    expect(renderer.info().textureUploads).toBe(2 * rig.layers.length);
    renderer.draw(poseLayers(rig, defaultLook(rig), drive(0)), defaultLook(rig));
    expect(stub.live.size).toBeGreaterThan(0);
    renderer.dispose();
    expect([...stub.live]).toEqual([]);
  });
});
