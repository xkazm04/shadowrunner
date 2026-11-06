// cast-face-pass in the renderers: `Layer.tint` false keeps an eye's or iris's light in the art's own
// colour (eyeGain still applies, no eye colour, no eye recolour) on GL and canvas2D; a closed-only
// eye (closed art, no socket or iris, the Vicar) crossfades to its closed art on a blink and on its
// own staggered motion.blink (the Tallyman), in both renderers; a maw rig draws no interior (u_wLayer
// w its gap reach) and a pixel rig samples per cell (u_wCell), while a lips rig never sets u_wCell.
import { defaultLook, OWN_BLINK_S, poseLayers, type Drive, type Layer, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { gainOf } from "../gl/layers.js";
import { createGlRenderer, createRenderer } from "../gl/renderer.js";
import { blendParams, restWeights } from "../mouth/shapes.js";
import type { MouthPose } from "../mouth/state.js";
import { lookLight } from "../render/frame.js";
import { layerRecolour } from "../render/recolour.js";
import type { RigAssets } from "../render/types.js";
import { faceAssets, faceRig } from "./faceRig.js";
import { createCanvasStub, createCtx2dStub, createGlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";
import { asRigAssets, pixelSurfaces } from "./pixels.js";

const REST: Drive = { t: 1, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const SOCKETS = new Map([
  ["eye_l", { hx: 10, hy: 6 }],
  ["eye_r", { hx: 10, hy: 6 }],
]);
const bitmap = (width: number, height: number): ImageBitmap => ({ width, height, close: () => undefined });

function standIns(r: Rig): RigAssets {
  const out: RigAssets = {};
  for (const l of r.layers) {
    out[l.file] = bitmap(l.bbox[2], l.bbox[3]);
    if (l.socket !== undefined) out[l.socket] = bitmap(l.bbox[2], l.bbox[3]);
    if (l.closed !== undefined) out[l.closed] = bitmap(l.bbox[2], l.bbox[3]);
    for (const p of Object.values(l.variants ?? {})) {
      out[p.file] = bitmap(p.bbox[2], p.bbox[3]);
      if (p.socket !== undefined) out[p.socket] = bitmap(l.bbox[2], l.bbox[3]);
    }
  }
  return out;
}

const uniformsOf = (log: [string, unknown[]][], method: string, name: string): unknown[][] =>
  log.filter(([m, a]) => m === method && (a[0] as { uniform?: string } | null)?.uniform === name).map(([, a]) => a.slice(1));

function glFrame(rig: Rig, look: Look, drive: Partial<Drive>) {
  const stub = createGlStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 256, height: 256 }).canvas, rig, standIns(rig));
  const poses = poseLayers(rig, look, { ...REST, ...drive }, { sockets: SOCKETS });
  stub.reset();
  renderer.draw(poses, look);
  return { poses, log: stub.log, info: renderer.info() };
}

/** canvas2D on the face fixture's pixel images (the iris clip needs readable pixels). */
function c2dFrame(rig: Rig, look: Look, drive: Partial<Drive>) {
  const ctx = createCtx2dStub();
  const canvas = createCanvasStub({ webgl2: "null", ctx2d: ctx, width: 128, height: 128 }).canvas;
  const renderer = createCanvas2dRenderer(canvas, ctx.ctx, rig, asRigAssets(faceAssets()), { surface: pixelSurfaces().factory });
  renderer.draw(poseLayers(rig, look, { ...REST, ...drive }, { sockets: SOCKETS }), look);
  return ctx;
}

describe("Layer.tint false", () => {
  const base = faceRig();
  const untinted: Rig = { ...base, layers: base.layers.map((l) => (l.kind === "iris" ? { ...l, tint: false as const } : l)) };
  const furious: Look = { ...defaultLook(base), emotion: "furious" };

  it("gainOf: an emissive eye or iris with tint false takes eyeGain alone (grey), others the eye colour", () => {
    const light = lookLight(base, furious);
    expect(light.eyeGain).toBe(2);
    const iris = untinted.layers.find((l) => l.name === "iris_l") as Layer;
    expect(gainOf(iris, { tint: 1.5 }, light, undefined)).toEqual([3, 3, 3]);
    const tinted = base.layers.find((l) => l.name === "iris_l") as Layer;
    expect(gainOf(tinted, { tint: 1 }, light, undefined)).toEqual(light.eye);
    // Not emissive: no light term at all, as before.
    expect(gainOf({ ...iris, emissive: false }, { tint: 1 }, light, undefined)).toEqual([1, 1, 1]);
  });

  it("is never recoloured by a look's eye colour (its regions still are)", () => {
    const iris = untinted.layers.find((l) => l.name === "iris_l") as Layer;
    const other: Look = { ...defaultLook(base), palette: { ...base.palette, eye: "#ff0000" } };
    expect(layerRecolour(base, iris, other)).toBeUndefined();
    expect(layerRecolour(base, { ...iris, tint: undefined } as Layer, other)?.light?.name).toBe("eye");
  });

  it("GL: the iris's u_gain is eyeGain on every channel; the tinted rig's is the eye colour", () => {
    const frame = glFrame(untinted, furious, {});
    const own = uniformsOf(frame.log, "uniform3f", "u_gain");
    const tinted = uniformsOf(glFrame(base, furious, {}).log, "uniform3f", "u_gain");
    // head, jaw, eye_l, iris_l, eye_r, iris_r; the pose tint carries the mood's glow gain.
    const k = 2 * (frame.poses[3]?.tint ?? 0);
    expect(k).toBeGreaterThan(2);
    expect(own[3]).toEqual([k, k, k]);
    expect(own[5]).toEqual([k, k, k]);
    expect(tinted[3]).toEqual(lookLight(base, furious).eye.map((c) => expect.closeTo((c * k) / 2, 9)));
    expect(own.filter((_, i) => i !== 3 && i !== 5)).toEqual(tinted.filter((_, i) => i !== 3 && i !== 5));
  });

  it("canvas2D: the iris's filter carries eyeGain; the tinted rig's iris draws as before", () => {
    const own = c2dFrame(untinted, furious, {});
    const tinted = c2dFrame(base, furious, {});
    // head, jaw, eye_l, iris_l, eye_r, iris_r: the irises' filter doubles (eyeGain 2), nothing else changes.
    expect(own.filters).toHaveLength(6);
    expect(own.filters.filter((_, i) => i !== 3 && i !== 5)).toEqual(tinted.filters.filter((_, i) => i !== 3 && i !== 5));
    const level = (f: string | undefined): number => (f === undefined || f === "none" ? 1 : Number(/brightness\((.*)\)/.exec(f)?.[1]));
    expect(level(own.filters[3])).toBeCloseTo(2 * level(tinted.filters[3]), 3);
    expect(level(own.filters[5])).toBeCloseTo(2 * level(tinted.filters[5]), 3);
  });
});

describe("closed-only eyes (closed art, no socket or iris)", () => {
  const base = faceRig();
  const eyesOnly = (motion?: (name: string) => Layer["motion"]): Rig => ({
    ...base,
    layers: base.layers
      .filter((l) => l.kind !== "iris")
      .map((l): Layer => {
        if (l.kind !== "eye") return l;
        const rest: Layer = { ...l };
        delete rest.socket;
        delete rest.variants;
        const m = motion?.(l.name);
        return { ...rest, ...(m === undefined ? {} : { motion: m }) };
      }),
  });
  const look = defaultLook(base);

  it("a blink crossfades to the closed art exactly as a socketed eye's (no squash, closed quad at the closure)", () => {
    const rig = eyesOnly();
    const { poses, log } = glFrame(rig, look, { blink: 0.6 });
    const eye = poses.find((p) => p.name === "eye_l");
    expect(eye?.scale[1]).toBe(1);
    expect(eye?.closed).toBeCloseTo(0.6, 12);
    // head, jaw, eye_l + closed, eye_r + closed.
    expect(uniformsOf(log, "uniform1f", "u_opacity").map((a) => a[0])).toEqual([1, 1, 1, expect.closeTo(0.6, 9), 1, expect.closeTo(0.6, 9)]);
    const ctx = c2dFrame(rig, look, { blink: 0.6 });
    expect(ctx.alphas).toEqual([1, 1, 1, expect.closeTo(0.6, 9), 1, expect.closeTo(0.6, 9)]);
    // Open: no closed quad.
    expect(uniformsOf(glFrame(rig, look, {}).log, "uniform1f", "u_opacity")).toHaveLength(4);
  });

  it("per-eye motion.blink drives that eye's closed-art crossfade alone (staggered phases)", () => {
    const rig = eyesOnly((name) => ({ blink: { freq: 0.25, phase: name === "eye_l" ? 0 : 0.5 } }));
    const t = OWN_BLINK_S / 2; // eye_l mid-blink (shut), eye_r half a cycle away (open)
    const { poses, log } = glFrame(rig, look, { t });
    expect(poses.find((p) => p.name === "eye_l")?.closed).toBeCloseTo(1, 9);
    expect(poses.find((p) => p.name === "eye_r")?.closed).toBeUndefined();
    expect(uniformsOf(log, "uniform1f", "u_opacity").map((a) => a[0])).toEqual([1, 1, 1, expect.closeTo(1, 9), 1]);
    expect(c2dFrame(rig, look, { t }).alphas).toEqual([1, 1, 1, expect.closeTo(1, 9), 1]);
  });
});

describe("GL warp modes", () => {
  const plain = malakorRig();
  const lips = { left: 455, right: 568, upper: 495, lower: 530 };
  const lipsRig: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, lips } };
  const mawRig: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, lips: { ...lips, seam: 512, maw: true } } };
  const pixelRig: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, cell: 7.1, lips } };
  const look = defaultLook(plain);
  const open: MouthPose = { params: blendParams({ ...restWeights(), rest: 0.2, openMid: 0.8 }), alpha: 1, lips: 1 };

  function talk(rig: Rig): [string, unknown[]][] {
    const stub = createGlStub();
    const { canvas } = createCanvasStub({ webgl2: stub, width: 512, height: 512 });
    const renderer = createGlRenderer(stub.gl, canvas, rig, fakeAssets(rig), undefined, () => null);
    stub.reset();
    renderer.draw(poseLayers(rig, look, { ...REST, jawOpen: 0.4 }), look, { t: 0, reducedMotion: false, mouth: open });
    return stub.log;
  }

  it("a maw sets u_wLayer.w to its gap reach (no interior: the art's gap); lips 0", () => {
    // reach = MAW_TAP_REACH x min(seam - upper, lower - seam) = 0.5 x 17.
    expect(uniformsOf(talk(mawRig), "uniform4f", "u_wLayer").map((a) => a[3])).toEqual([8.5, 8.5]);
    expect(uniformsOf(talk(lipsRig), "uniform4f", "u_wLayer").map((a) => a[3])).toEqual([0, 0]);
  });

  it("a pixel rig sets u_wCell to its cell once per program; a lips rig never sets it", () => {
    expect(uniformsOf(talk(pixelRig), "uniform1f", "u_wCell")).toEqual([[expect.closeTo(7.1, 6)]]);
    expect(uniformsOf(talk(lipsRig), "uniform1f", "u_wCell")).toEqual([]);
  });
});
