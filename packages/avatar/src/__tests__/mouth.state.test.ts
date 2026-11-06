// The drawn mouth's state in the frame body (spark llm-avatar-lab R3, "the rig owns the mouth"):
// a rig without `mouth` runs exactly as before; with one, the emotion and the level (or a caller's
// shape mix) shape the mouth and open the jaw to match; reduced motion switches at once.
import { defaultLook, type Emotion, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { JAW_FLOOR } from "../driver/state.js";
import { applyBias, createEmotionEase, EMOTION_BIAS, EMOTION_EASE_MS } from "../mouth/emotion.js";
import { blendParams, coverOf, jawLevel, levelWeights, restWeights, type ShapeWeights } from "../mouth/shapes.js";
import type { MouthShapesInput } from "../mouth/state.js";
import { createFrameBody, type FrameOutput } from "../player/frame.js";
import { runPlayer } from "../player/run.js";
import type { FrameClock, Renderer } from "../render/types.js";
import { malakorRig } from "./malakor.js";

/** A stand-in for a DOM type the stub cannot construct; only the members the code uses exist. */
const stand = <T extends object>(value: object): T => value as T;

const plain = malakorRig();
const withMouth: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, render: "drawn" } };
/** A measured mouth with lips and no `render` (painterly styles): the art mouth, "warp". */
const artMouth: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, lips: { left: 455, right: 568, upper: 495, lower: 530 } } };
const lookOf = (rig: Rig, emotion: Emotion): Look => ({ ...defaultLook(rig), emotion });

/** Runs `frames` frames of `dt` seconds and returns the last output. */
function run(rig: Rig, o: { emotion?: Emotion; level?: number; frames?: number; dt?: number; reducedMotion?: boolean; mouth?: MouthShapesInput } = {}): FrameOutput {
  const body = createFrameBody(7);
  const look = lookOf(rig, o.emotion ?? "neutral");
  let out: FrameOutput | undefined;
  for (let i = 0; i < (o.frames ?? 30); i += 1) {
    out = body({ rig, look, dt: o.dt ?? 1 / 60, level: o.level ?? 0, gaze: "host", reducedMotion: o.reducedMotion ?? false, ...(o.mouth === undefined ? {} : { mouth: o.mouth }) });
  }
  if (out === undefined) throw new Error("no frame");
  return out;
}

const jawOf = (out: FrameOutput): number => {
  const jaw = out.poses.find((p) => p.name === "jaw");
  const head = out.poses.find((p) => p.name === "head");
  return (jaw?.y ?? 0) - (head?.y ?? 0);
};

describe("a rig without mouth", () => {
  it("a measured mouth without render (the art mouth, \"warp\") carries the mouth pose and leaves the jaw on the level", () => {
    const out = run(artMouth, { emotion: "delighted", level: 0.4 });
    expect(out.clock.mouth?.params.smile).toBeGreaterThan(0.5);
    const still = run({ ...artMouth, mouth: { cx: 511.5, lineY: 511, width: 120, render: "still" } }, { emotion: "delighted", level: 0.4 });
    expect(still.clock.mouth).toBeUndefined();
    expect(out.poses).toEqual(still.poses);
  });

  it("the art mouth follows the reduced-motion twin (one soft shape) and opens the jaw for a caller's visemes", () => {
    const calm = run(artMouth, { level: 0.9, reducedMotion: false }).clock.mouth?.params.open ?? 0;
    const reduced = run(artMouth, { level: 0.9, reducedMotion: true, frames: 60 }).clock.mouth?.params.open ?? 0;
    expect(reduced).toBeGreaterThan(0);
    expect(reduced).toBeLessThan(calm * 0.6);
    const wide = run(artMouth, { mouth: { shapes: { ...restWeights(), rest: 0, openWide: 1 } } });
    expect(jawOf(wide)).toBeGreaterThan(jawOf(run(artMouth)));
  });

  it("draws no mouth and opens the jaw from the raw level, exactly as before", () => {
    const out = run(plain, { emotion: "delighted", level: 0.4 });
    expect(Object.keys(out.clock).sort()).toEqual(["reducedMotion", "t"]);
    const same = run(plain, { emotion: "delighted", level: 0.4, mouth: { shapes: { ...restWeights(), rest: 0, closed: 1 } } });
    expect(same.poses).toEqual(out.poses);
  });
});

describe("a rig with mouth", () => {
  it("neutral at rest draws nothing (the art untouched)", () => {
    expect(run(withMouth).clock.mouth).toBeUndefined();
  });

  it("an emotion shows the drawn mouth at rest, with its family's bias", () => {
    const mouth = run(withMouth, { emotion: "delighted" }).clock.mouth;
    expect(mouth?.alpha).toBe(1);
    expect(mouth?.params.smile).toBeCloseTo(EMOTION_BIAS.joy.smile, 6);
    expect(mouth?.params.open).toBe(0);
  });

  it("the level opens a mid mouth and the jaw with it; joy keeps the corners up while talking", () => {
    const level = 0.3;
    const out = run(withMouth, { emotion: "delighted", level });
    const want = applyBias(blendParams(levelWeights(level)), EMOTION_BIAS.joy);
    expect(out.clock.mouth?.params.open).toBeCloseTo(want.open, 6);
    expect(out.clock.mouth?.params.smile).toBeCloseTo(want.smile, 6);
    expect(out.clock.mouth?.alpha).toBe(1);
    expect(jawOf(out)).toBeGreaterThan(jawOf(run(withMouth, { emotion: "delighted" })) + 0.5);
  });

  it("a showman bias opens the jaw a little even in silence", () => {
    expect(jawOf(run(withMouth, { emotion: "theatrical" }))).toBeGreaterThan(jawOf(run(withMouth)) + 0.1);
  });

  it("eases a change of emotion over EMOTION_EASE_MS", () => {
    const body = createFrameBody(1);
    const step = (emotion: Emotion, dt: number): FrameOutput => body({ rig: withMouth, look: lookOf(withMouth, emotion), dt, level: 0, gaze: "host", reducedMotion: false });
    step("neutral", 0);
    step("delighted", 0);
    const half = step("delighted", EMOTION_EASE_MS / 2000).clock.mouth;
    expect(half?.params.smile).toBeGreaterThan(0.1);
    expect(half?.params.smile).toBeLessThan(EMOTION_BIAS.joy.smile - 0.1);
    expect(step("delighted", EMOTION_EASE_MS / 1000).clock.mouth?.params.smile).toBeCloseTo(EMOTION_BIAS.joy.smile, 6);
  });

  it("reduced motion: the emotion shows on the next frame, and talking is one soft shape", () => {
    const body = createFrameBody(1);
    const step = (emotion: Emotion, level: number): FrameOutput => body({ rig: withMouth, look: lookOf(withMouth, emotion), dt: 1 / 60, level, gaze: "host", reducedMotion: true });
    step("neutral", 0);
    expect(step("furious", 0).clock.mouth?.params.snarl).toBeCloseTo(EMOTION_BIAS.anger.snarl, 6);
    const quiet = run(withMouth, { level: 0.25, reducedMotion: true, frames: 60 }).clock.mouth;
    const loud = run(withMouth, { level: 0.9, reducedMotion: true, frames: 60 }).clock.mouth;
    expect(quiet?.params.open).toBeCloseTo(loud?.params.open ?? NaN, 6);
    expect(quiet?.params.open).toBeCloseTo(blendParams({ ...restWeights(), rest: 0.5, openMid: 0.5 }).open, 2);
  });

  it("a caller's shapes override the level drive: a closure stays shut while the audio is loud", () => {
    const closed: ShapeWeights = { ...restWeights(), rest: 0, closed: 1 };
    const out = run(withMouth, { emotion: "delighted", level: 0.9, mouth: { shapes: closed } });
    expect(out.clock.mouth?.params.press).toBe(1);
    expect(out.clock.mouth?.params.open).toBe(0);
    expect(out.clock.mouth?.params.smile).toBeCloseTo(EMOTION_BIAS.joy.smile, 6);
    expect(jawOf(out)).toBeCloseTo(jawOf(run(withMouth, { emotion: "delighted" })), 6);
    const wide: ShapeWeights = { ...restWeights(), rest: 0, openWide: 1 };
    expect(run(withMouth, { mouth: { shapes: wide } }).clock.mouth?.params.open).toBe(1);
  });

  it("a caller's jaw mix opens the jaw; its drawn share scales the lips but not the cover", () => {
    const wide: ShapeWeights = { ...restWeights(), rest: 0, openWide: 1 };
    const out = run(withMouth, { mouth: { shapes: wide, jaw: restWeights(), drawn: { openWide: 0.25 } } });
    expect(out.clock.mouth?.alpha).toBe(1);
    expect(out.clock.mouth?.lips).toBe(0.25);
    expect(jawOf(out)).toBeCloseTo(jawOf(run(withMouth)), 6);
  });
});

describe("mouth math", () => {
  it("level -> a mid mouth above the floor; jaw level and cover as the lab's", () => {
    expect(levelWeights(JAW_FLOOR).rest).toBe(1);
    expect(levelWeights(1).openMid).toBe(1);
    expect(jawLevel(0)).toBe(0);
    expect(jawLevel(1)).toBe(1);
    expect(coverOf(restWeights())).toBe(0);
    expect(coverOf({ ...restWeights(), rest: 0.5, openMid: 0.5 })).toBe(1);
  });

  it("the ease reads a live reduced-motion flag", () => {
    let reduced = false;
    const ease = createEmotionEase(() => reduced);
    ease.set("delighted", 0);
    expect(ease.at(10).strength).toBeLessThan(1);
    reduced = true;
    expect(ease.at(10).strength).toBe(1);
  });
});

describe("the player's mouth API", () => {
  function player(r: Rig) {
    const clocks: (FrameClock | undefined)[] = [];
    const renderer: Renderer = {
      setRig: () => undefined,
      setLook: () => undefined,
      draw: (_p, _l, clock) => void clocks.push(clock),
      resize: () => undefined,
      info: () => ({ mode: "2d", drawCalls: 0, textureUploads: 0 }),
      dispose: () => undefined,
    };
    const canvas = stand<HTMLCanvasElement>({ ownerDocument: { defaultView: null }, parentElement: null, width: 640, height: 480, closest: () => null });
    return { p: runPlayer(canvas, { rig: r, look: lookOf(r, "neutral"), assets: {}, autoSize: false, reducedMotion: false }, () => renderer), clocks };
  }

  it("setMouthShapes drives the drawn mouth and mouth() reads it back; undefined returns to the level", () => {
    const { p, clocks } = player(withMouth);
    p.setLevel(0.9);
    p.setMouthShapes?.({ ...restWeights(), rest: 0, closed: 1 });
    p.renderFrame(1 / 60);
    expect(p.mouth?.()?.params.press).toBe(1);
    expect(clocks.at(-1)?.mouth).toBe(p.mouth?.());
    p.setMouthShapes?.(undefined);
    p.renderFrame(1 / 60);
    expect(p.mouth?.()?.params.open).toBeGreaterThan(0.5);
    p.dispose();
    expect(p.mouth?.()).toBeUndefined();
  });

  it("a rig without mouth ignores the shapes", () => {
    const { p, clocks } = player(plain);
    p.setMouthShapes?.({ ...restWeights(), rest: 0, openWide: 1 });
    p.setEmotion("delighted");
    p.renderFrame(1 / 60);
    expect(p.mouth?.()).toBeUndefined();
    expect(clocks.at(-1)?.mouth).toBeUndefined();
  });
});
