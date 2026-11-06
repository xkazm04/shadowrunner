// Face control in the renderers and the frame body (face-control WP-A): the iris drawn through its
// socket clip (GL iris program, canvas2D composite), held back while its mask loads; closed lids
// over a blinking eye; the light on the iris, not the socketed eye; the look's light fading with
// the mood; no brow shift on a socketed eye; dead patches dropped; the profile read every frame.
import { defaultLook, poseLayers, type Drive, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { createRenderer } from "../gl/renderer.js";
import { createFrameBody } from "../player/frame.js";
import { createMouthState } from "../mouth/state.js";
import { fitView, layerAffine, lookLight } from "../render/frame.js";
import { createRigInspector, withoutDeadPatches } from "../render/inspect.js";
import type { RigAssets } from "../render/types.js";
import { faceAssets, faceRig, IRIS } from "./faceRig.js";
import { createCanvasStub, createCtx2dStub, createGlStub } from "./glStub.js";
import { asRigAssets, pixelOf, pixelSurfaces } from "./pixels.js";

const rig = faceRig();
const look: Look = defaultLook(rig);
const REST: Drive = { t: 1, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const SOCKETS = new Map([
  ["eye_l", { hx: 10, hy: 6 }],
  ["eye_r", { hx: 10, hy: 6 }],
]);

const bitmap = (width: number, height: number): ImageBitmap => ({ width, height, close: () => undefined });

/** Stand-in images for every file the rig names (no decoding under node). */
function standIns(r: Rig, skip: readonly string[] = []): RigAssets {
  const out: RigAssets = {};
  const add = (file: string | undefined, w: number, h: number): void => {
    if (file !== undefined && !skip.includes(file)) out[file] = bitmap(w, h);
  };
  for (const l of r.layers) {
    add(l.file, l.bbox[2], l.bbox[3]);
    add(l.socket, l.bbox[2], l.bbox[3]);
    add(l.closed, l.bbox[2], l.bbox[3]);
    for (const p of Object.values(l.variants ?? {})) {
      add(p.file, p.bbox[2], p.bbox[3]);
      add(p.socket, l.bbox[2], l.bbox[3]);
    }
  }
  return out;
}

function glFrame(drive: Partial<Drive>, assets: RigAssets = standIns(rig), l: Look = look) {
  const stub = createGlStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 256, height: 256 }).canvas, rig, assets);
  const poses = poseLayers(rig, l, { ...REST, ...drive }, { sockets: SOCKETS });
  stub.reset();
  renderer.draw(poses, l);
  const uniform = (method: string, name: string): unknown[][] => stub.log.filter(([m, a]) => m === method && (a[0] as { uniform?: string } | null)?.uniform === name).map(([, a]) => a.slice(1));
  return { stub, poses, uniform, info: renderer.info() };
}

describe("face-control in the GL renderer", () => {
  it("draws each iris with the socket clip (u_maskM, masks on units 2-4) and the light on the iris, not the socketed eye", () => {
    const { uniform, poses, info } = glFrame({ gaze: { x: 0.5, y: 0 } });
    expect(uniform("uniformMatrix3fv", "u_maskM")).toHaveLength(2);
    expect(uniform("uniform3f", "u_maskW")).toEqual([[1, 0, 0], [1, 0, 0]]);
    // head, jaw, eye_l, iris_l, eye_r, iris_r: the eyes write no glow, the irises do, lit by the eye colour.
    expect(poses.map((p) => p.name)).toEqual(["head", "jaw", "eye_l", "iris_l", "eye_r", "iris_r"]);
    expect(uniform("uniform1f", "u_emissive").map((a) => a[0])).toEqual([0, 0, 0, 1, 0, 1]);
    const eye = lookLight(rig, look).eye;
    const gains = uniform("uniform3f", "u_gain");
    expect(gains[2]).toEqual([1, 1, 1]);
    expect(gains[3]).toEqual(eye.map((c) => expect.closeTo(c, 9)));
    expect(info.drawCalls).toBe(6 + 4);
  });

  it("blends the joy face's own socket by its weight, and draws the closed lids over a blinking eye", () => {
    const joy = { ...look, emotion: "amused" as const };
    const { uniform } = glFrame({ mood: { from: "neutral", mix: 0.5 } }, standIns(rig), joy);
    expect(uniform("uniform3f", "u_maskW")[0]).toEqual([expect.closeTo(0.5, 9), expect.closeTo(0.5, 9), 0]);
    const shut = glFrame({ blink: 0.6 });
    // eye_l: base + closed lids (opacity 0.6); its iris at 0.4.
    const opacities = shut.uniform("uniform1f", "u_opacity").map((a) => a[0]);
    expect(opacities).toEqual([1, 1, 1, 0.6, expect.closeTo(0.4, 9), 1, 0.6, expect.closeTo(0.4, 9)]);
  });

  it("holds an iris back while its socket mask is not ready (never unclipped), other layers draw", () => {
    const { uniform, info } = glFrame({}, standIns(rig, ["eye_l.socket.png"]));
    expect(uniform("uniformMatrix3fv", "u_maskM")).toHaveLength(1);
    expect(info.drawCalls).toBe(5 + 4);
  });
});

describe("face-control in the canvas2D renderer", () => {
  it("draws the clipped iris composite in the iris's box and the closed lids at the closure", () => {
    const images = faceAssets();
    const ctx = createCtx2dStub();
    const surfaces = pixelSurfaces();
    const canvas = createCanvasStub({ webgl2: "null", ctx2d: ctx, width: 128, height: 128 }).canvas;
    const renderer = createCanvas2dRenderer(canvas, ctx.ctx, rig, asRigAssets(images), { surface: surfaces.factory });
    const wide = { ...look, face: { gaze: { range: 1 } } };
    const poses = poseLayers(rig, wide, { ...REST, t: 0, blink: 0.5, gaze: { x: 1, y: 0 } }, { sockets: SOCKETS });
    renderer.draw(poses, wide);
    // head, jaw, eye_l (+ closed), iris_l (composite), eye_r (+ closed), iris_r.
    expect(ctx.count("drawImage")).toBe(8);
    expect(ctx.alphas).toEqual([1, 1, 1, 0.5, 0.5, 1, 0.5, 0.5]);
    const iris = ctx.images[4];
    expect(iris).not.toBe(images["iris_l.png"]);
    // The iris moved 10 px right (52..60); the socket ends at x 56: the composite keeps the iris
    // colour inside and cuts what lies past the edge.
    expect(pixelOf(iris, 1, 4)).toEqual(IRIS);
    expect(pixelOf(iris, 7, 4)[3]).toBe(0);
  });
});

describe("face-control light and placement", () => {
  it("lookLight fades eyeGain and the brow shift with the mood; settled it is the emotion's row", () => {
    const furious = { ...look, emotion: "furious" as const };
    const settled = lookLight(rig, furious);
    expect(settled.eyeGain).toBe(2);
    expect(lookLight(rig, furious, { from: "neutral", mix: 0 }).eyeGain).toBe(1);
    expect(lookLight(rig, furious, { from: "neutral", mix: 0.5 }).eyeGain).toBeCloseTo(1.5, 12);
    expect(lookLight(rig, furious, { from: "neutral", mix: 0.5 }).browY).toBeCloseTo(settled.browY / 2, 12);
  });

  it("the brow shift never moves a socketed eye (its lids belong to the face)", () => {
    const poses = poseLayers(rig, look, REST);
    const view = fitView(rig, 128, 128);
    const eye = rig.layers.find((l) => l.name === "eye_l");
    const pose = poses.find((p) => p.name === "eye_l");
    if (eye === undefined || pose === undefined) throw new Error("fixture");
    expect(layerAffine(eye, pose, view, -5)).toEqual(layerAffine(eye, pose, view, 0));
    const bare = { ...eye, socket: undefined };
    delete bare.socket;
    expect(layerAffine(bare, pose, view, -5)[5]).toBeCloseTo(layerAffine(bare, pose, view, 0)[5] - 5, 9);
  });
});

describe("face-control in the frame body", () => {
  it("drops jaw and eye patches that are one image (by name, or by pixels for assets in hand) and measures the sockets", () => {
    const surfaces = pixelSurfaces();
    const inspector = createRigInspector(asRigAssets(faceAssets()), undefined, surfaces.factory);
    expect([...inspector.deadLayers(rig)]).toEqual(["jaw"]);
    expect(inspector.sockets(rig)).toEqual(SOCKETS);
    const byName = { ...rig, layers: rig.layers.map((l) => (l.name !== "eye_l" ? l : { ...l, variants: { joy: { file: "x.png", bbox: l.bbox, mode: "over" as const }, anger: { file: "x.png", bbox: l.bbox, mode: "over" as const } } })) };
    expect([...createRigInspector({}, undefined, surfaces.factory).deadLayers(byName)]).toEqual(["eye_l"]);
    expect(withoutDeadPatches(rig, new Set(["jaw"])).layers.find((l) => l.name === "jaw")?.variants).toBeUndefined();
  });

  it("poses with the measured sockets, the trimmed rig and the look's live profile; the clock carries the mood", () => {
    const body = createFrameBody(1, { surface: pixelSurfaces().factory });
    const assets = asRigAssets(faceAssets());
    const frame = (l: Look, drive: Partial<Drive> = {}) => body({ rig, look: l, dt: 1 / 60, level: 0, gaze: "host", reducedMotion: false, assets, drive: { ...REST, ...drive } });
    const angry = { ...look, emotion: "irritated" as const };
    const out = frame(angry, { t: 0, gaze: { x: 1, y: 0 } });
    expect(out.poses.find((p) => p.name === "jaw")?.faces).toBeUndefined();
    expect(out.poses.find((p) => p.name === "iris_l")?.x).toBeCloseTo(42 + 6, 9);
    const half = frame({ ...look, emotion: "amused", face: { expression: { strength: 0.5 } } });
    expect(half.poses.find((p) => p.name === "eye_l")?.faces).toEqual([{ family: "joy", weight: 0.5 }]);
    expect(frame(look, { mood: { from: "furious", mix: 0.3 } }).clock.mood).toEqual({ from: "furious", mix: 0.3 });
  });

  it("mouth.emotion scales the mouth's emotion bias (0 none, 1 as today)", () => {
    const smileOf = (k: number | undefined): number => {
      const step = createMouthState();
      const out = step({ emotion: "amused", level: 0, reducedMotion: true, dt: 0.1, ...(k === undefined ? {} : { emotionStrength: k }) });
      return out.pose?.params.smile ?? NaN;
    };
    expect(smileOf(1)).toBe(smileOf(undefined));
    expect(smileOf(0)).toBe(0);
    expect(smileOf(0.5)).toBeCloseTo(smileOf(1) / 2, 9);
  });
});
