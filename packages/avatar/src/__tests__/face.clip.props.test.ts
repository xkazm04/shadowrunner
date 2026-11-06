// The iris never shows outside its socket (face-control WP-A, render/socket.ts, canvas2d/iris.ts):
// a property over head turns, gestures, squints, blinks, faces and gazes (in and far past the
// range). Every iris pixel the clip leaves visible maps, through the poses alone (an independent
// inverse of the eye's placement), onto a socket texel that is opaque in a mask in force; and no
// pixel gains alpha. The GL draw is handed the same map (u_maskM) and the same masks.
import fc from "fast-check";
import { poseLayers, type Drive, type Emotion, type LayerPose, type Look } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createIrisClipper } from "../canvas2d/iris.js";
import { irisClipOf } from "../gl/iris.js";
import { layerAffine, type View } from "../render/frame.js";
import { irisMaskMap, socketBoxOf, socketWeights, alphaOf } from "../render/socket.js";
import type { TextureStore } from "../gl/textures.js";
import { faceAssets, faceRig } from "./faceRig.js";
import { asImage, pixelSurfaces, type PixelImage } from "./pixels.js";

const rig = faceRig();
const images = faceAssets();
const layers = new Map(rig.layers.map((l) => [l.name, l]));
const iris = layers.get("iris_l");
const eye = layers.get("eye_l");
if (iris === undefined || eye === undefined) throw new Error("fixture");
/** Test stand-ins for DOM types the stubs cannot construct (only the members the code uses exist). */
const asPixels = (value: unknown): PixelImage => value as PixelImage;
const fakeTexture = (file: string): WebGLTexture => ({ file }) as WebGLTexture;
const fileOf = (texture: unknown): string => (texture as { file: string }).file;
const UNIT: View = { scale: 1, ox: 0, oy: 0, width: 1, height: 1 };
const socket = images["eye_l.socket.png"] as PixelImage;
const box = socketBoxOf(alphaOf(socket.width, socket.height, socket.pixels), eye.bbox[2], eye.bbox[3]);

/** Whether any texel of `mask` within one texel of (px, py) (mask px) is opaque at all. */
function opaqueNear(mask: PixelImage, px: number, py: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = Math.floor(px) + dx;
      const y = Math.floor(py) + dy;
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) continue;
      if ((mask.pixels[(y * mask.width + x) * 4 + 3] ?? 0) > 0) return true;
    }
  }
  return false;
}

const arbCase = fc.record({
  yaw: fc.double({ min: -22, max: 22, noNaN: true }),
  pitch: fc.double({ min: -12, max: 12, noNaN: true }),
  blink: fc.double({ min: 0, max: 1, noNaN: true }),
  gesture: fc.constantFrom(undefined, "tilt", "nod", "lean_in", "recoil"),
  at: fc.double({ min: 0, max: 0.4, noNaN: true }),
  emotion: fc.constantFrom<Emotion>("neutral", "amused", "irritated", "smug", "bored", "delighted"),
  from: fc.constantFrom<Emotion>("neutral", "amused", "furious"),
  mix: fc.double({ min: 0, max: 1, noNaN: true }),
  gx: fc.double({ min: -3, max: 3, noNaN: true }),
  gy: fc.double({ min: -3, max: 3, noNaN: true }),
  range: fc.double({ min: 0, max: 1, noNaN: true }),
  rot: fc.double({ min: -25, max: 25, noNaN: true }),
  size: fc.double({ min: 0.6, max: 1.6, noNaN: true }),
});

type Case = typeof arbCase extends fc.Arbitrary<infer T> ? T : never;

function posesOf(c: Case): { look: Look; poses: LayerPose[] } {
  const look: Look = { palette: rig.palette, hidden: [], emotion: c.emotion, shape: { head: { size: c.size, sx: 1, sy: 1, dx: 0, dy: 0, rot: c.rot } }, face: { gaze: { range: c.range } } };
  const drive: Drive = {
    t: 1,
    headYaw: c.yaw,
    headPitch: c.pitch,
    jawOpen: 0,
    blink: c.blink,
    gaze: { x: c.gx, y: c.gy },
    mood: { from: c.from, mix: c.mix },
    ...(c.gesture === undefined ? {} : { gesture: { name: c.gesture, startedAt: 1 - c.at } }),
  };
  return { look, poses: poseLayers(rig, look, drive, { sockets: new Map(box === undefined ? [] : [["eye_l", box]]) }) };
}

describe("iris clip (face-control)", () => {
  it("never leaves an iris pixel visible outside an opaque socket texel in force, and never adds alpha", () => {
    expect(box).toEqual({ hx: 10, hy: 6 });
    fc.assert(
      fc.property(arbCase, (c) => {
        const { poses } = posesOf(c);
        const irisPose = poses.find((p) => p.name === "iris_l");
        const eyePose = poses.find((p) => p.name === "eye_l");
        if (irisPose === undefined || eyePose === undefined) throw new Error("posed");
        const clipper = createIrisClipper(pixelSurfaces().factory);
        const source = images["iris_l.png"] as PixelImage;
        const out = clipper.clip(iris, irisPose, { key: "k", image: asImage(source), size: asImage(source) }, layers, poses, (file) => (images[file] === undefined ? undefined : asImage(images[file])));
        if (out === "plain" || out === undefined) throw new Error("expected a clipped iris");
        const result = asPixels(out);
        // Independent placement: iris rest px -> canvas (its affine) -> eye rest px (the eye's affine inverted by hand).
        const mi = layerAffine(iris, irisPose, UNIT, 0);
        const me = layerAffine(eye, eyePose, UNIT, 0);
        const det = me[0] * me[3] - me[1] * me[2];
        const masks = socketWeights(eye, eyePose).map((m) => images[m.file] as PixelImage);
        for (let j = 0; j < result.height; j += 1) {
          for (let i = 0; i < result.width; i += 1) {
            const k = (j * result.width + i) * 4;
            const a = result.pixels[k + 3] ?? 0;
            expect(a).toBeLessThanOrEqual(source.pixels[k + 3] ?? 0);
            if (a === 0) continue;
            const rx = iris.bbox[0] + ((i + 0.5) * iris.bbox[2]) / result.width;
            const ry = iris.bbox[1] + ((j + 0.5) * iris.bbox[3]) / result.height;
            const cx = mi[0] * rx + mi[2] * ry + mi[4] - me[4];
            const cy = mi[1] * rx + mi[3] * ry + mi[5] - me[5];
            const ex = (me[3] * cx - me[2] * cy) / det;
            const ey = (-me[1] * cx + me[0] * cy) / det;
            const mx = ((ex - eye.bbox[0]) / eye.bbox[2]) * socket.width;
            const my = ((ey - eye.bbox[1]) / eye.bbox[3]) * socket.height;
            expect(mx >= -1 && my >= -1 && mx <= socket.width + 1 && my <= socket.height + 1, `inside the eye box at ${i},${j}`).toBe(true);
            expect(masks.some((m) => opaqueNear(m, mx, my)), `on the socket at ${i},${j}`).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("cuts an iris looking past the socket's edge, and keeps one at rest whole", () => {
    const visible = (gx: number): number => {
      const { poses } = posesOf({ yaw: 0, pitch: 0, blink: 0, gesture: undefined, at: 0, emotion: "neutral", from: "neutral", mix: 1, gx, gy: 0, range: 1, rot: 0, size: 1 });
      const irisPose = poses.find((p) => p.name === "iris_l") as LayerPose;
      const source = images["iris_l.png"] as PixelImage;
      const out = createIrisClipper(pixelSurfaces().factory).clip(iris, irisPose, { key: "k", image: asImage(source), size: asImage(source) }, layers, poses, (file) => (images[file] === undefined ? undefined : asImage(images[file])));
      const pixels = asPixels(out).pixels;
      let n = 0;
      for (let k = 3; k < pixels.length; k += 4) n += (pixels[k] ?? 0) > 0 ? 1 : 0;
      return n;
    };
    const src = images["iris_l.png"] as PixelImage;
    let whole = 0;
    for (let k = 3; k < src.pixels.length; k += 4) whole += (src.pixels[k] ?? 0) > 0 ? 1 : 0;
    expect(visible(0)).toBe(whole);
    expect(visible(1)).toBeGreaterThan(0);
    expect(visible(1)).toBeLessThan(whole * 0.75);
  });

  it("GL is handed the same map and masks; an iris whose socket is not ready is not drawn, one without a socket is plain", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const { poses } = posesOf(c);
        const irisPose = poses.find((p) => p.name === "iris_l");
        const eyePose = poses.find((p) => p.name === "eye_l");
        if (irisPose === undefined || eyePose === undefined) throw new Error("posed");
        const textures = new Map<string, { texture: WebGLTexture; texel: [number, number] }>();
        const store: TextureStore = { get: (file) => textures.get(file) ?? (textures.set(file, { texture: fakeTexture(file), texel: [1, 1] }), textures.get(file)), uploads: () => 0, dispose: () => undefined };
        const clip = irisClipOf(iris, irisPose, layers, poses, store);
        if (clip === undefined || clip === "plain") throw new Error("expected a clip");
        const m = irisMaskMap(iris, irisPose, eye, eyePose);
        expect(clip.maskM).toEqual(m === undefined ? [] : [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
        const weights = socketWeights(eye, eyePose);
        expect(clip.masks.map((x) => [fileOf(x.texture.texture), x.weight])).toEqual(weights.map((w) => [w.file, w.weight]));
        expect(weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 9);
      }),
      { numRuns: 100 },
    );
    const { poses } = posesOf({ yaw: 0, pitch: 0, blink: 0, gesture: undefined, at: 0, emotion: "neutral", from: "neutral", mix: 1, gx: 0, gy: 0, range: 0.6, rot: 0, size: 1 });
    const irisPose = poses.find((p) => p.name === "iris_l") as LayerPose;
    const empty: TextureStore = { get: () => undefined, uploads: () => 0, dispose: () => undefined };
    expect(irisClipOf(iris, irisPose, layers, poses, empty)).toBeUndefined();
    const bare = new Map(layers);
    bare.set("eye_l", { ...eye, socket: undefined } as never);
    expect(irisClipOf(iris, irisPose, bare, poses, empty)).toBe("plain");
  });
});
