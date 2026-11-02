// Layer motion in the renderer (cast-forge task 1, req 1.3-1.4): reduced motion reaches poseLayers
// as `Drive.still`; Malakor's shard floats reach the GL quad matrices and the canvas2D transforms,
// and the monocle pulse reaches the GL light gain and the canvas2D brightness filter.
import { defaultLook, poseLayers, type Drive, type LayerPose } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { tintFilter } from "../canvas2d/renderer.js";
import { initialState } from "../driver/state.js";
import { createRenderer } from "../gl/renderer.js";
import { advanceFrame, stillUnder } from "../react/loop.js";
import { createCanvasStub, createCtx2dStub, createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const rig = malakorRig();
const look = defaultLook(rig);
const SHARDS = rig.layers.filter((l) => l.motion?.float !== undefined).map((l) => l.name);
const at = (t: number, still?: true): LayerPose[] => poseLayers(rig, look, { t, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, ...(still ? { still } : {}) });

function glFrame(poses: LayerPose[]): { gains: unknown[][]; matrices: unknown[][]; stub: GlStub } {
  const stub = createGlStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 512, height: 512 }).canvas, rig, fakeAssets(rig));
  stub.reset();
  renderer.draw(poses, look);
  const calls = (method: string, uniform: string): unknown[][] =>
    stub.log.filter(([name, args]) => name === method && (args[0] as { uniform?: string } | null)?.uniform === uniform).map(([, args]) => args.slice(1));
  return { gains: calls("uniform3f", "u_gain"), matrices: calls("uniformMatrix3fv", "u_m"), stub };
}

function canvasFrame(poses: LayerPose[]) {
  const ctx2d = createCtx2dStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: "null", ctx2d, width: 512, height: 512 }).canvas, rig, fakeAssets(rig));
  renderer.draw(poses, look);
  return { transforms: ctx2d.transforms.slice(1, -1), filters: ctx2d.filters };
}

describe("reduced motion reaches poseLayers as Drive.still", () => {
  it("advanceFrame marks the driver's Drive and an override still under reduced motion only", () => {
    const s0 = initialState(3);
    expect(advanceFrame(s0, { dt: 0.05, level: 0, gaze: "host", reducedMotion: true }).drive.still).toBe(true);
    expect(advanceFrame(s0, { dt: 0.05, level: 0, gaze: "host", reducedMotion: false }).drive.still).toBeUndefined();
    const override: Drive = { t: 3, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
    expect(advanceFrame(s0, { dt: 0.05, level: 0, gaze: "host", reducedMotion: true, drive: override }).drive).toEqual({ ...override, still: true });
    expect(stillUnder(override, false)).toBe(override);
  });
});

describe("float and pulse in the renderers", () => {
  it("Malakor has 11 floating shards and a pulsing monocle", () => {
    expect(SHARDS).toHaveLength(11);
    expect(rig.layers.find((l) => l.name === "monocle")?.motion?.pulse).toBeDefined();
  });

  it("GL: shard quads move between t = 3 s and t = 4 s, and hold still under reduced motion", () => {
    const [a, b] = [glFrame(at(3)), glFrame(at(4))];
    const index = at(3).map((p) => p.name);
    for (const shard of SHARDS) {
      const i = index.indexOf(shard);
      expect(a.matrices[i], shard).not.toEqual(b.matrices[i]);
    }
    expect(glFrame(at(3, true)).matrices).toEqual(glFrame(at(4, true)).matrices);
  });

  it("GL: the monocle's light gain is its pulse tint, and 1 under reduced motion", () => {
    const poses = at(2);
    const i = poses.findIndex((p) => p.name === "monocle");
    const tint = poses[i]?.tint ?? NaN;
    expect(tint).toBeGreaterThan(1);
    expect(glFrame(poses).gains[i]).toEqual([tint, tint, tint].map((v) => expect.closeTo(v, 6)));
    expect(glFrame(at(2, true)).gains[i]).toEqual([1, 1, 1]);
  });

  it("canvas2D: shards move, the monocle is drawn with its pulse as brightness, the rest unfiltered", () => {
    const poses = at(2);
    const frame = canvasFrame(poses);
    poses.forEach((pose, i) => expect(frame.filters[i]).toBe(pose.name === "monocle" ? tintFilter(pose.tint) : "none"));
    expect(tintFilter(poses.find((p) => p.name === "monocle")?.tint ?? 1)).toMatch(/^brightness\(1\.\d{4}\)$/);
    const later = canvasFrame(at(3));
    const names = poses.map((p) => p.name);
    for (const shard of SHARDS) expect(frame.transforms[names.indexOf(shard)], shard).not.toEqual(later.transforms[names.indexOf(shard)]);
    const still = canvasFrame(at(2, true));
    expect(still.filters.every((f) => f === "none")).toBe(true);
    expect(still.transforms).toEqual(canvasFrame(at(3, true)).transforms);
  });

  it("tintFilter is none at 1 and for non-finite tints", () => {
    expect(tintFilter(1)).toBe("none");
    expect(tintFilter(Number.NaN)).toBe("none");
    expect(tintFilter(1.5)).toBe("brightness(1.5000)");
  });
});
