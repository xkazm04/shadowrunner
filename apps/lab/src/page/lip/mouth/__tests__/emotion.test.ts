// The emotion the drawn mouth carries: biases added to the viseme mix (a closure still closes),
// eased over EMOTION_EASE_MS (instant under reduced motion), shown at rest only when not neutral,
// and the mouth placed on the rig's measured mouth when the rig has one.
import type { AvatarPlayer, LayerFrame } from "@sr/avatar/core";
import type { Layer, RigMouth } from "@sr/rig";
import { describe, expect, it, vi } from "vitest";
import type { LipContext, ScenePainter } from "../../../types.js";
import { mouthAnchor } from "../anchor.js";
import { createMouthDriver, type MouthFrame } from "../driver.js";
import { applyBias, createEmotionEase, EMOTION_BIAS, EMOTION_EASE_MS, NO_BIAS } from "../emotion.js";
import { mouthGeometry, OPEN_OF_WIDTH } from "../geometry.js";
import { mouthFrame } from "../paint.js";
import { blendParams, restWeights, SHAPE_PARAMS } from "../shapes.js";

const head: Layer = { name: "head", z: 3, kind: "head", file: "head.png", bbox: [332, 1, 360, 642], anchor: [512, 634] };
const jaw: Layer = { name: "jaw", z: 4, kind: "jaw", file: "jaw.png", bbox: [448, 493, 130, 22], anchor: [513, 492], follow: "head", drop: 0.014 };
const frames = (): LayerFrame[] => [
  { layer: head, affine: [1, 0, 0, 1, 0, 0], opacity: 1 },
  { layer: jaw, affine: [1, 0, 0, 1, 0, 0], opacity: 1 },
];
const measured: RigMouth = { cx: 520, lineY: 505, width: 70 };

function harness(reducedMotion: boolean, mouth?: RigMouth) {
  const painters: ScenePainter[] = [];
  const levels: (number | undefined)[] = [];
  let clock = 0;
  const player = { attachAudio: vi.fn(), setLevel: (l: number | undefined) => levels.push(l), layerFrames: frames } as Partial<AvatarPlayer> as AvatarPlayer;
  const ctx: LipContext = {
    character: "the-tallyman",
    ...(mouth === undefined ? {} : { mouth }),
    player,
    audio: { context: {} as AudioContext, output: {} as GainNode, nowMs: () => clock, level: () => 0 },
    reducedMotion,
    addPainter: (p) => painters.push(p),
  };
  const g = {
    canvas: { width: 1920, height: 1080 },
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : 128)) }),
  } as Partial<CanvasRenderingContext2D> as CanvasRenderingContext2D;
  const seen: MouthFrame[] = [];
  const d = createMouthDriver("L1", ctx, (_g, f) => seen.push(f));
  const step = (t: number): MouthFrame | undefined => {
    clock = t;
    d.frame(t);
    for (const p of painters) p(g, t);
    return seen.at(-1);
  };
  return { d, step, levels, setClock: (t: number) => (clock = t) };
}

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

describe("emotion in the driver", () => {
  it("neutral at rest leaves the art untouched; an emotion shows the drawn mouth at rest", () => {
    const h = harness(false);
    expect(h.step(100)?.alpha).toBe(0);
    h.setClock(200);
    h.d.onEmotion?.("delighted");
    const mid = h.step(200 + EMOTION_EASE_MS / 2);
    expect(mid?.alpha).toBeCloseTo(0.5, 6);
    const full = h.step(200 + EMOTION_EASE_MS);
    expect(full?.alpha).toBe(1);
    expect(full?.params.smile).toBeCloseTo(EMOTION_BIAS.joy.smile, 9);
    expect(full?.weights).toEqual(restWeights());
    h.d.onEmotion?.("neutral");
    expect(h.step(2000)?.alpha).toBe(0);
  });

  it("reduced motion: the emotion shows on the next frame, with no easing", () => {
    const h = harness(true);
    h.step(0);
    h.setClock(100);
    h.d.onEmotion?.("smug");
    const f = h.step(116);
    expect(f?.alpha).toBe(1);
    expect(f?.params.skew).toBeCloseTo(EMOTION_BIAS.smug.skew, 9);
  });

  it("a PP in a joyful line closes the lips with the corners up", () => {
    const h = harness(false);
    h.d.onEmotion?.("amused");
    h.d.onViseme({ t: 0, kind: "viseme", id: "u", v: "PP", startMs: 0, endMs: 300 });
    h.d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 300 }, 1000);
    const f = h.step(1150);
    expect(f?.weights.closed).toBeCloseTo(1, 6);
    expect(f?.params.open).toBe(0);
    expect(f?.params.smile).toBeGreaterThan(0.5);
    expect(h.levels.at(-1)).toBe(0);
  });
});

describe("mouth anchor", () => {
  it("sits on the rig's measured mouth when the rig has one", () => {
    const a = mouthAnchor(frames(), measured);
    expect(a?.geometry.cx).toBe(520);
    expect(a?.geometry.lineY).toBe(505);
    expect(a?.geometry.width).toBe(70);
    expect(a?.geometry.maxOpen).toBeCloseTo(70 * OPEN_OF_WIDTH, 9);
    expect(a?.geometry.crop).toEqual(mouthGeometry({ bbox: [0, 0, 1, 1] }, undefined, measured).crop);
  });

  it("falls back to the jaw's guess without one (or with a broken one)", () => {
    expect(mouthAnchor(frames())?.geometry).toEqual(mouthGeometry(jaw, head));
    expect(mouthAnchor(frames(), { cx: Number.NaN, lineY: 1, width: 1 })?.geometry).toEqual(mouthGeometry(jaw, head));
  });

  it("the driver hands the painter the measured mouth from ctx.mouth", () => {
    const h = harness(false, measured);
    h.d.onEmotion?.("smug");
    expect(h.step(1000)?.anchor.geometry.cx).toBe(520);
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
