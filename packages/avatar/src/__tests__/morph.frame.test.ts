// A morph rig in the player (companion-lanes requirement 3.3-3.5): mouth mode "morph", the frame
// body's clock `morph` (the shapes, the blink, the eyes-lead gaze), the sway's lag and its reduced-
// motion twin, the Canvas 2D patches, and the file list the avatar loads.
import { defaultLook, FACE_DEFAULTS, morphPlan, poseLayers, type Drive, type Rig, type RigMorph, type SpringChannels } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { mouthMode } from "../mouth/anchor.js";
import { createFrameBody, type FrameBodyInputs } from "../player/frame.js";
import { SWAY_FULL, SWAY_IDLE, swayLag } from "../player/morph.js";
import { rigAssetFiles } from "../render/assets.js";
import { createCanvasStub, createCtx2dStub } from "./glStub.js";
import { KEYS, morphAssets, morphRig } from "./morphRig.js";

const weightOf = (rig: Rig, id: string, plan: { weights: Float64Array } | undefined): number => plan?.weights[rig.morph?.keys.findIndex((k) => k.id === id) ?? -1] ?? 0;
const DRIVE: Drive = { t: 2, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };

function run(rig: Rig, frames: number, over: Partial<FrameBodyInputs> = {}) {
  const body = createFrameBody(1);
  let out = body({ rig, look: defaultLook(rig), dt: 0, level: 0, gaze: "host", reducedMotion: false, ...over });
  for (let i = 1; i < frames; i += 1) out = body({ rig, look: defaultLook(rig), dt: 1 / 30, level: 0, gaze: "host", reducedMotion: false, ...over });
  return out;
}

describe("mouth mode", () => {
  it('is "morph" when the morph has a mouth key, whatever the rig\'s mouth says; otherwise as before', () => {
    const rig = morphRig();
    expect(mouthMode(rig.mouth, rig.morph)).toBe("morph");
    expect(mouthMode(undefined, rig.morph)).toBe("morph");
    expect(mouthMode({ cx: 1, lineY: 1, width: 1, render: "drawn" }, rig.morph)).toBe("morph");
    const eyesOnly: RigMorph = { ...(rig.morph as RigMorph), keys: KEYS.filter((k) => k.track === "blink") };
    expect(mouthMode(rig.mouth, eyesOnly)).toBe("still");
    expect(mouthMode(rig.mouth)).toBe("still");
  });
});

describe("the frame body on a morph rig", () => {
  it("drives the mouth keys from the level's shapes, draws no mouth and leaves the clock without one", () => {
    const rig = morphRig();
    const out = run(rig, 4, { level: 0.5, drive: DRIVE });
    expect("mouth" in out.clock).toBe(false);
    expect(weightOf(rig, "open_mid", out.clock.morph?.plan)).toBeGreaterThan(0.9);
    expect(weightOf(rig, "round", out.clock.morph?.plan)).toBe(0);
  });

  it("drives them from a caller's visemes (setMouthShapes), the emotion's face key with them", () => {
    const rig = morphRig();
    const shapes = { rest: 0.2, openWide: 0, openMid: 0.3, round: 0.5, closed: 0, teeth: 0, tongue: 0, narrow: 0 };
    const out = run(rig, 2, { mouth: { shapes }, drive: DRIVE, look: { ...defaultLook(rig), emotion: "amused" } });
    const plan = out.clock.morph?.plan;
    expect(weightOf(rig, "open_mid", plan)).toBeCloseTo(0.3, 9);
    expect(weightOf(rig, "round", plan)).toBeCloseTo(0.5, 9);
  });

  it("the blink drives the blink key; at rest with a drive override, no key and no sway: no clock morph", () => {
    const rig = morphRig();
    expect(weightOf(rig, "blink", run(rig, 1, { drive: { ...DRIVE, blink: 1 } }).clock.morph?.plan)).toBe(1);
    expect("morph" in run(rig, 1, { drive: DRIVE }).clock).toBe(false);
  });

  it("runs the eyes-lead driver on a rig with gaze keys: a glance to chat turns the right gaze key on", () => {
    const rig = morphRig();
    const out = run(rig, 12, { gaze: "chat" });
    expect(weightOf(rig, "look_r", out.clock.morph?.plan)).toBeGreaterThan(0.6);
    expect(weightOf(rig, "look_l", out.clock.morph?.plan)).toBe(0);
  });

  it("sways with the idle drift, and not at all under reduced motion", () => {
    const rig = morphRig();
    const moving = run(rig, 3, { dt: 1 / 30 });
    expect(Math.hypot(moving.clock.morph?.sway.x ?? 0, moving.clock.morph?.sway.y ?? 0)).toBeGreaterThan(0);
    const reduced = run(rig, 3, { reducedMotion: true });
    expect(reduced.clock.morph === undefined || (reduced.clock.morph.sway.x === 0 && reduced.clock.morph.sway.y === 0)).toBe(true);
    expect(run(rig, 3, { look: { ...defaultLook(rig), motion: { spring: 0 } } }).clock.morph?.sway ?? { x: 0, y: 0 }).toEqual({ x: 0, y: 0 });
  });

  it("a rig without morph keeps a clock without a morph key", () => {
    const rig = morphRig();
    delete rig.morph;
    expect("morph" in run(rig, 3, { level: 0.5 }).clock).toBe(false);
  });
});

describe("swayLag", () => {
  const lag = (over: Partial<SpringChannels>): SpringChannels => ({ yaw: 0, pitch: 0, roll: 0, scale: 0, lift: 0, actDx: 0, actDy: 0, actRot: 0, ...over });
  it("trails the head: a yaw lag sideways, a pitch lag up and down, clamped to [-1, 1]; still is 0", () => {
    const out = { x: 0, y: 0 };
    const idle = swayLag(undefined, 3, 1, false, { x: 0, y: 0 });
    expect(Math.abs(idle.x)).toBeLessThanOrEqual(SWAY_IDLE);
    expect(Math.abs(idle.y)).toBeLessThanOrEqual(SWAY_IDLE);
    expect(swayLag(lag({ yaw: SWAY_FULL.yaw / 2 }), 3, 1, false, out).x).toBeCloseTo(0.5 + idle.x, 9);
    expect(swayLag(lag({ pitch: -SWAY_FULL.pitch / 4 }), 3, 1, false, out).y).toBeCloseTo(-0.25 + idle.y, 9);
    expect(swayLag(lag({ roll: SWAY_FULL.roll }), 3, 1, false, out).x).toBeCloseTo(Math.max(-1, -1 + idle.x), 9);
    expect(swayLag(lag({ yaw: 5 }), 3, 2, false, out).x).toBe(1);
    expect(swayLag(lag({ yaw: 5 }), 3, 1, true, out)).toEqual({ x: 0, y: 0 });
  });
});

describe("Canvas 2D", () => {
  it("draws each active key's atlas cell over its bbox at its weight, after the morph layer, in compositing order", () => {
    const rig = morphRig();
    const morph = rig.morph as RigMorph;
    const ctx2d = createCtx2dStub();
    const assets = morphAssets(rig);
    const renderer = createCanvas2dRenderer(createCanvasStub({ webgl2: "null", ctx2d, width: 256, height: 256 }).canvas, ctx2d.ctx, rig, assets);
    const look = defaultLook(rig);
    const plan = morphPlan(morph, { blink: 1, emotion: "amused", shapes: { openMid: 0.4 }, face: FACE_DEFAULTS });
    renderer.draw(poseLayers(rig, look, DRIVE), look, { t: 1, reducedMotion: false, morph: { plan, sway: { x: 0.5, y: 0 } } });
    expect(ctx2d.count("drawImage")).toBe(3 + 3);
    expect(ctx2d.images.slice(3)).toEqual([assets[morph.atlas], assets[morph.atlas], assets[morph.atlas]]);
    expect(ctx2d.alphas).toEqual([1, 1, 1, 1, 0.4, 1]);
    expect(renderer.info().drawCalls).toBe(6);
  });
});

describe("rigAssetFiles", () => {
  it("lists the morph's atlas, motion image and sway map after the layers", () => {
    expect(rigAssetFiles(morphRig())).toEqual({ layers: ["background.webp", "body.webp", "head.webp"], maps: [], patches: [], morph: ["morph.atlas.webp", "morph.flow.png", "morph.sway.png"] });
  });
});
