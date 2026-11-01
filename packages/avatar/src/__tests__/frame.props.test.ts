// Shared frame math (task 3): letterbox fit, the pose -> device affine, look light.
import fc from "fast-check";
import { defaultLook, EMOTION_TABLE, poseLayers, type Emotion, type Layer, type LayerPose } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { applyAffine, BROW_STEP, fitView, hexToRgb, layerAffine, lookLight, RIM_STRENGTH } from "../render/frame.js";
import { malakorRig } from "./malakor.js";

const size = fc.integer({ min: 1, max: 4096 });
/** Uniform grid in [lo, hi] (fc.double clusters near 0). */
const num = (lo: number, hi: number) => fc.integer({ min: 0, max: 10000 }).map((i) => lo + ((hi - lo) * i) / 10000);
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

const layerArb = fc
  .record({ x: num(-500, 1500), y: num(-500, 1500), w: num(1, 800), h: num(1, 800), fx: num(0, 1), fy: num(0, 1), eye: fc.boolean() })
  .map(({ x, y, w, h, fx, fy, eye }): Layer => ({
    name: "l",
    z: 0,
    kind: eye ? "eye" : "head",
    file: "l.png",
    bbox: [x, y, w, h],
    anchor: [x + fx * w, y + fy * h],
  }));
const poseArb = fc.record({ dx: num(-200, 200), dy: num(-200, 200), k: num(0.5, 1.5), squash: num(0.1, 1), rot: num(-Math.PI, Math.PI) });

describe("fitView", () => {
  it("fits the rig whole, centred, touching two opposite edges", () => {
    fc.assert(
      fc.property(size, size, size, size, (rw, rh, w, h) => {
        const v = fitView({ width: rw, height: rh }, w, h);
        const right = v.ox + rw * v.scale;
        const bottom = v.oy + rh * v.scale;
        const inside = v.ox >= -1e-9 && v.oy >= -1e-9 && right <= w + 1e-6 && bottom <= h + 1e-6;
        const centred = close(v.ox, w - right) && close(v.oy, h - bottom);
        const touches = close(right - v.ox, w) || close(bottom - v.oy, h);
        return inside && centred && touches;
      }),
    );
  });
});

describe("layerAffine", () => {
  it("puts the anchor at the posed anchor (plus the brow for eyes), scaled into the view", () => {
    fc.assert(
      fc.property(layerArb, poseArb, size, size, num(-20, 20), (layer, p, w, h, browY) => {
        const view = fitView({ width: 1024, height: 1024 }, w, h);
        const pose: LayerPose = { name: "l", x: layer.bbox[0] + p.dx, y: layer.bbox[1] + p.dy, scale: [p.k, p.k * p.squash], rotation: p.rot, opacity: 1, tint: 1 };
        const [x, y] = applyAffine(layerAffine(layer, pose, view, browY), layer.anchor[0], layer.anchor[1]);
        const brow = layer.kind === "eye" ? browY : 0;
        return close(x, view.ox + view.scale * (layer.anchor[0] + p.dx), 1e-9) && close(y, view.oy + view.scale * (layer.anchor[1] + p.dy + brow), 1e-9);
      }),
    );
  });

  it("scales the layer's own axes (squash before rotation) and keeps distances to the anchor", () => {
    fc.assert(
      fc.property(layerArb, poseArb, (layer, p) => {
        const view = fitView({ width: 1024, height: 1024 }, 1024, 1024);
        const pose: LayerPose = { name: "l", x: layer.bbox[0], y: layer.bbox[1], scale: [p.k, p.k * p.squash], rotation: p.rot, opacity: 1, tint: 1 };
        const m = layerAffine(layer, pose, view, 0);
        const [ax, ay] = applyAffine(m, layer.anchor[0], layer.anchor[1]);
        const [rx, ry] = applyAffine(m, layer.anchor[0] + 10, layer.anchor[1]);
        const [ux, uy] = applyAffine(m, layer.anchor[0], layer.anchor[1] + 10);
        return close(Math.hypot(rx - ax, ry - ay), 10 * p.k) && close(Math.hypot(ux - ax, uy - ay), 10 * p.k * p.squash);
      }),
    );
  });

  it("draws every Malakor layer exactly on its bbox at rest", () => {
    const rig = malakorRig();
    const poses = poseLayers(rig, defaultLook(rig), { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 });
    const view = fitView(rig, 512, 512);
    for (const pose of poses) {
      const layer = rig.layers.find((l) => l.name === pose.name);
      if (layer === undefined) throw new Error(pose.name);
      const m = layerAffine(layer, pose, view, 0);
      const [x0, y0] = applyAffine(m, layer.bbox[0], layer.bbox[1]);
      const [x1, y1] = applyAffine(m, layer.bbox[0] + layer.bbox[2], layer.bbox[1] + layer.bbox[3]);
      expect([x0, y0, x1, y1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual(
        [layer.bbox[0] / 2, layer.bbox[1] / 2, (layer.bbox[0] + layer.bbox[2]) / 2, (layer.bbox[1] + layer.bbox[3]) / 2],
      );
    }
  });
});

describe("lookLight", () => {
  it("multiplies the eye colour by eyeGain, scales the rim, and maps one brow step to 0.004 x height", () => {
    const rig = malakorRig();
    const emotions = Object.keys(EMOTION_TABLE) as Emotion[];
    for (const emotion of emotions) {
      const look = { ...defaultLook(rig), emotion };
      const light = lookLight(rig, look);
      const row = EMOTION_TABLE[emotion];
      const eye = hexToRgb(look.palette.eye);
      expect(light.eye.map((c, i) => c / (eye[i] ?? 1))).toEqual(eye.map(() => expect.closeTo(row.eyeGain, 9)));
      expect(light.rim).toEqual(hexToRgb(look.palette.rim).map((c) => expect.closeTo(c * RIM_STRENGTH, 9)));
      expect(light.browY).toBeCloseTo(-row.brow * BROW_STEP * rig.height, 9);
    }
    expect(BROW_STEP * 1024).toBeCloseTo(4.096, 9);
  });

  it("parses #rrggbb and refuses anything else", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb("red")).toEqual([0, 0, 0]);
  });
});
