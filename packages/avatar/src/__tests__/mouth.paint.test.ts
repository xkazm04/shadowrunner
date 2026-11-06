// The drawn mouth's pure parts (moved from the lab with the mouth, spark llm-avatar-lab R3): the
// emotion biases added to a mix (a closure still closes), their easing (instant under reduced
// motion), the corners emotion moves, the colours derived from the skin, and the anchor in the
// head's frame on the rig's measured mouth only.
import type { Layer, LayerPose } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { applyAffine, type View } from "../render/frame.js";
import { anchorOf, invertAffine, mouthGeometry, mouthLayers, OPEN_OF_WIDTH } from "../mouth/anchor.js";
import { deriveColours } from "../mouth/colours.js";
import { applyBias, createEmotionEase, EMOTION_BIAS, EMOTION_EASE_MS, NO_BIAS } from "../mouth/emotion.js";
import { mouthFrame } from "../mouth/paint.js";
import { blendParams, SHAPE_PARAMS } from "../mouth/shapes.js";

describe("emotion bias", () => {
  it("talks through a smile: joy + PP is still closed, the corners still up", () => {
    const p = applyBias(blendParams({ closed: 1 }), EMOTION_BIAS.joy);
    expect(p.open).toBe(0);
    expect(p.press).toBe(1);
    expect(p.smile).toBeGreaterThan(0.5);
    expect(p.width).toBeGreaterThan(SHAPE_PARAMS.closed.width);
  });

  it("an open showman bias yields to a closure (lips and jaw stay shut)", () => {
    const shut = applyBias(blendParams({ closed: 1 }), EMOTION_BIAS.showman);
    expect(shut.open).toBe(0);
    expect(shut.jaw).toBe(0);
    const rest = applyBias(blendParams({ rest: 1 }), EMOTION_BIAS.showman);
    expect(rest.open).toBeGreaterThan(0);
    expect(rest.smile).toBeGreaterThan(0);
  });

  it("each family reads by its own param, and neutral adds nothing", () => {
    expect(EMOTION_BIAS.gloom.smile).toBeLessThan(-0.5);
    expect(EMOTION_BIAS.anger.snarl).toBeGreaterThan(0.5);
    expect(Math.abs(EMOTION_BIAS.smug.skew)).toBeGreaterThan(0.5);
    expect(EMOTION_BIAS.suspicion.tight).toBeGreaterThan(0.5);
    expect(applyBias(blendParams({ openWide: 1 }), NO_BIAS)).toEqual(blendParams({ openWide: 1 }));
  });

  it("clamps the sum to each param's range", () => {
    const p = applyBias({ ...SHAPE_PARAMS.rest, smile: 0.9, teeth: 0.9 }, EMOTION_BIAS.showman);
    expect(p.smile).toBe(1);
    expect(p.teeth).toBe(1);
  });
});

describe("emotion easing", () => {
  it("eases over EMOTION_EASE_MS with a smoothstep, from wherever it was", () => {
    const e = createEmotionEase(false);
    e.set("delighted", 1000);
    expect(e.at(1000).strength).toBe(0);
    expect(e.at(1000 + EMOTION_EASE_MS / 2).bias.smile).toBeCloseTo(EMOTION_BIAS.joy.smile / 2, 9);
    expect(e.at(1000 + EMOTION_EASE_MS).bias).toEqual(EMOTION_BIAS.joy);
    // Interrupted halfway: the next ease starts from the half-way mouth, not from neutral.
    e.set("grim", 1000 + EMOTION_EASE_MS / 2);
    expect(e.at(1000 + EMOTION_EASE_MS / 2).bias.smile).toBeCloseTo(EMOTION_BIAS.joy.smile / 2, 9);
    expect(e.at(2000).bias).toEqual(EMOTION_BIAS.gloom);
    e.set("neutral", 3000);
    expect(e.expressive).toBe(false);
    expect(e.at(3000 + EMOTION_EASE_MS).strength).toBe(0);
  });

  it("reduced motion switches at once", () => {
    const e = createEmotionEase(true);
    e.set("furious", 500);
    expect(e.at(500).bias).toEqual(EMOTION_BIAS.anger);
    expect(e.at(500).strength).toBe(1);
  });
});

describe("mouth corners", () => {
  it("smile lifts both corners, a frown drops them, skew lifts one", () => {
    const smile = mouthFrame(500, 500, 30, 60, { smile: 1, skew: 0 });
    expect(smile.yl).toBeLessThan(500);
    expect(smile.yr).toBeCloseTo(smile.yl, 9);
    const frown = mouthFrame(500, 500, 30, 60, { smile: -1, skew: 0 });
    expect(frown.yl).toBeGreaterThan(500);
    const smirk = mouthFrame(500, 500, 30, 60, { smile: 0, skew: 1 });
    expect(smirk.yr).toBeLessThan(smirk.yl);
    expect(smirk.cx).toBeGreaterThan(500);
  });
});

describe("mouth colours", () => {
  it("derives darker lips, a dark inside and bright teeth from the skin", () => {
    const c = deriveColours([120, 120, 120], [100, 100, 100]);
    expect(c.lip[0]).toBeLessThan(110);
    expect(c.inner[0]).toBeLessThan(20);
    expect(c.teeth[0]).toBeGreaterThan(180);
    expect(c.teeth[0]).toBeLessThanOrEqual(255);
  });
});

describe("mouth anchor", () => {
  const head: Layer = { name: "head", z: 3, kind: "head", file: "head.png", bbox: [332, 1, 360, 642], anchor: [512, 634] };
  const jaw: Layer = { name: "jaw", z: 4, kind: "jaw", file: "jaw.png", bbox: [448, 493, 130, 22], anchor: [513, 492], follow: "head", drop: 0.014 };
  const layers = new Map([head, jaw].map((l) => [l.name, l]));
  const at = (layer: Layer, dy: number): LayerPose => ({ name: layer.name, x: layer.bbox[0], y: layer.bbox[1] + dy, scale: [1, 1], rotation: 0, opacity: 1, tint: 1 });
  const view: View = { width: 1024, height: 1024, scale: 1.5, ox: 100, oy: 50 };

  it("inverts affines", () => {
    const m = [1.2, 0.3, -0.3, 1.2, 40, -7] as const;
    const inv = invertAffine([...m]);
    expect(inv).toBeDefined();
    const [x, y] = applyAffine(inv ?? [1, 0, 0, 1, 0, 0], ...applyAffine([...m], 10, 20));
    expect(x).toBeCloseTo(10, 9);
    expect(y).toBeCloseTo(20, 9);
    expect(invertAffine([0, 0, 0, 0, 1, 1])).toBeUndefined();
  });

  it("only a usable measured mouth places one (never a guess from the jaw)", () => {
    expect(mouthGeometry({ cx: 520, lineY: 505, width: 70 })).toEqual({ cx: 520, lineY: 505, width: 70, maxOpen: 70 * OPEN_OF_WIDTH });
    expect(mouthGeometry(undefined)).toBeUndefined();
    expect(mouthGeometry({ cx: Number.NaN, lineY: 1, width: 1 })).toBeUndefined();
    expect(mouthGeometry({ cx: 1, lineY: 1, width: 0 })).toBeUndefined();
  });

  it("anchors in the head's frame and measures the jaw's drop there", () => {
    const poses = [at(head, 0), at(jaw, 6)];
    const found = mouthLayers(layers, poses);
    expect(found?.head?.layer.name).toBe("head");
    const geometry = mouthGeometry({ cx: 513, lineY: 493, width: 100 });
    if (found === undefined || geometry === undefined) throw new Error("no mouth");
    const a = anchorOf(geometry, found.jaw, found.head, view, 0);
    expect(a.affine[0]).toBeCloseTo(1.5, 9);
    expect(a.gap).toBeCloseTo(6, 6);
    expect(mouthLayers(layers, [at(head, 0)])).toBeUndefined();
  });
});
