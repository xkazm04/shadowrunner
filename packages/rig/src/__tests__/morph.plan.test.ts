// The morph plan (companion-lanes requirement 2, design "Tracks"): the stop rule, mouth
// normalisation, the cap of 8, the compositing order, retired families, the gaze's sign and range,
// and the plan's invariants under random inputs. Also the pose pieces a morph rig takes: the turn's
// face from `morph.eyes`, breathing.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { breathes } from "../eyes.js";
import { FACE_DEFAULTS, resolveFace, type ResolvedFace } from "../face.js";
import { hasMorphGaze, MORPH_MAX_ACTIVE, MORPH_TRACKS, morphGroupIndex, morphHas, morphPlan, selectMorphKeys, type MorphInputs } from "../morph.js";
import { FACE_OF_EYES, MORPH_EYE_WIDTH, turnHead } from "../turn.js";
import type { Emotion, MorphKey, MorphTrack, RigMorph } from "../types.js";
import { MORPH_KEYS, morphRig } from "./morphRig.js";

const REST: MorphInputs = { blink: 0, emotion: "neutral", face: FACE_DEFAULTS };
const morphOf = (keys: MorphKey[]): RigMorph => ({ layer: "head", atlas: "a.webp", keys, eyes: [[0, 0], [10, 0]] });
const at = (morph: RigMorph, inputs: Partial<MorphInputs>): Record<string, number> => {
  const plan = morphPlan(morph, { ...REST, ...inputs });
  return Object.fromEntries(morph.keys.map((k, i) => [k.id, Math.round((plan.weights[i] ?? 0) * 1e6) / 1e6]));
};
const key = (id: string, track: MorphTrack, a?: number): MorphKey => ({ id, track, ...(a === undefined ? {} : { at: a }), bbox: [0, 0, 4, 4], cell: [0, 0, 4, 4] });

describe("the stop rule", () => {
  const morph = morphRig().morph as RigMorph;
  it.each([
    [0, 0, 0],
    [0.25, 0.5, 0],
    [0.5, 1, 0],
    [0.75, 0.5, 0.5],
    [1, 0, 1],
  ])("blink %f: half-closed %f, closed %f", (blink, half, closed) => {
    expect(at(morph, { blink })).toMatchObject({ blink_half: half, blink: closed });
  });

  it("a single stop at 1 follows its track; stops at .25, .5, 1 hand over in turn", () => {
    expect(at(morph, { shapes: { openWide: 0.3 } })).toMatchObject({ open_wide: 0.3, round: 0 });
    const three = morphOf([key("c", "joy", 1), key("a", "joy", 0.25), key("b", "joy", 0.5)]);
    const joy = (v: number): Record<string, number> => at(three, { emotion: "amused", face: { ...FACE_DEFAULTS, expression: { strength: v, faces: {} } } });
    expect(joy(0.125)).toEqual({ c: 0, a: 0.5, b: 0 });
    expect(joy(0.375)).toEqual({ c: 0, a: 0.5, b: 0.5 });
    expect(joy(0.75)).toEqual({ c: 0.5, a: 0, b: 0.5 });
    expect(joy(1)).toEqual({ c: 1, a: 0, b: 0 });
  });
});

describe("track values", () => {
  const morph = morphRig().morph as RigMorph;
  it("mouth shapes above a total of 1 are normalised; rest and unknown shapes are ignored", () => {
    expect(at(morph, { shapes: { openWide: 0.8, round: 0.6, rest: 5 } })).toMatchObject({ open_wide: 0.571429, round: 0.428571 });
    expect(at(morph, { shapes: { openWide: 0.4, round: 0.3, rest: 0.3 } })).toMatchObject({ open_wide: 0.4, round: 0.3 });
    expect(at(morph, { shapes: { openWide: Number.NaN, round: -1 } })).toMatchObject({ open_wide: 0, round: 0 });
  });

  it("faces: the mood crossfade, one family once, times strength, retired gives 0", () => {
    expect(at(morph, { emotion: "amused" }).joy).toBe(1);
    expect(at(morph, { emotion: "amused", mood: { from: "neutral", mix: 0.5 } }).joy).toBe(0.5);
    expect(at(morph, { emotion: "delighted", mood: { from: "amused", mix: 0.3 } }).joy).toBe(1);
    expect(at(morph, { emotion: "neutral", mood: { from: "amused", mix: 0.25 } }).joy).toBeCloseTo(1 - 0.15625, 6);
    expect(at(morph, { emotion: "amused", face: resolveFace({ face: { expression: { strength: 0.4 } } }) }).joy).toBe(0.4);
    expect(at(morph, { emotion: "amused", face: resolveFace({ face: { expression: { faces: { joy: "procedural" } } } }) }).joy).toBe(0);
  });

  it("gaze: L for x < 0, R for x > 0 (the picture's sides), U for y < 0, scaled by range / 0.6", () => {
    expect(at(morph, { gaze: { x: -0.5, y: 0 } })).toMatchObject({ look_l: 0.5, look_r: 0 });
    expect(at(morph, { gaze: { x: 0.5, y: 0 } })).toMatchObject({ look_l: 0, look_r: 0.5 });
    const narrow: ResolvedFace = { ...FACE_DEFAULTS, gaze: { ...FACE_DEFAULTS.gaze, range: 0.3 } };
    expect(at(morph, { gaze: { x: 1, y: 0 }, face: narrow }).look_r).toBe(0.5);
    const wide: ResolvedFace = { ...FACE_DEFAULTS, gaze: { ...FACE_DEFAULTS.gaze, range: 1 } };
    expect(at(morph, { gaze: { x: 0.9, y: 0 }, face: wide }).look_r).toBe(1);
    const updown = morphOf([key("u", "gazeU"), key("d", "gazeD")]);
    expect(at(updown, { gaze: { x: 0, y: -0.3 } })).toEqual({ u: 0.3, d: 0 });
    expect(at(updown, { gaze: { x: 0, y: 0.3 } })).toEqual({ u: 0, d: 0.3 });
  });
});

describe("the active list", () => {
  it("is ordered face < gaze < mouth < blink, then by position in morph.keys", () => {
    const morph = morphRig().morph as RigMorph;
    const plan = morphPlan(morph, { ...REST, blink: 1, emotion: "amused", mood: { from: "neutral", mix: 0.5 }, gaze: { x: 0.3, y: 0 }, shapes: { openWide: 0.5, round: 0.5 } });
    expect(Array.from(plan.active.subarray(0, plan.count), (i) => morph.keys[i]?.id)).toEqual(["joy", "look_r", "open_wide", "round", "blink"]);
  });

  it("drops weights at or below 0.002 and keeps at most 8, the lowest dropped (a tie drops the later)", () => {
    const tracks: MorphTrack[] = ["joy", "anger", "gloom", "gazeL", "gazeU", "openWide", "round", "closed", "teeth", "blink"];
    const morph = morphOf(tracks.map((t, i) => key(`k${i}`, t)));
    const plan = morphPlan(morph, { ...REST, blink: 0.002 });
    expect(plan.count).toBe(0);
    for (let i = 0; i < tracks.length; i += 1) plan.weights[i] = [0.9, 0.3, 0.3, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.95][i] ?? 0;
    selectMorphKeys(plan);
    expect(plan.count).toBe(MORPH_MAX_ACTIVE);
    const ids = Array.from(plan.active.subarray(0, plan.count), (i) => morph.keys[i]?.id);
    // k1 (anger .3) stays, k2 (gloom .3) and k8 (teeth .3) go: of three tied lowest, the two that composite later.
    expect(ids).toEqual(["k0", "k1", "k3", "k4", "k5", "k6", "k7", "k9"]);
    expect(plan.weights[2]).toBe(0);
    expect(plan.weights[8]).toBe(0);
  });

  it("reuses one plan per morph (no allocation per frame)", () => {
    const morph = morphRig().morph as RigMorph;
    const a = morphPlan(morph, REST);
    const b = morphPlan(morph, { ...REST, blink: 1 });
    expect(b).toBe(a);
    expect(a.weights).toBe(b.weights);
  });

  it("holds its invariants for any inputs (property)", () => {
    const morph = morphRig().morph as RigMorph;
    const unit = fc.double({ min: -0.5, max: 1.5, noNaN: true });
    const emotion = fc.constantFrom<Emotion>("neutral", "amused", "smug", "furious", "bored", "suspicious", "theatrical");
    fc.assert(
      fc.property(unit, fc.record({ x: unit, y: unit }), fc.dictionary(fc.constantFrom("openWide", "openMid", "round", "rest"), unit), emotion, emotion, fc.double({ min: 0, max: 1, noNaN: true }), (blink, gaze, shapes, from, emo, mix) => {
        const plan = morphPlan(morph, { ...REST, blink, gaze, shapes, emotion: emo, mood: { from, mix } });
        expect(plan.count).toBeLessThanOrEqual(MORPH_MAX_ACTIVE);
        const active = Array.from(plan.active.subarray(0, plan.count));
        morph.keys.forEach((k, i) => {
          const w = plan.weights[i] ?? 0;
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1 + 1e-12);
          expect(active.includes(i)).toBe(w > 0.002);
          if (!active.includes(i)) expect(w).toBe(0);
        });
        for (let n = 1; n < active.length; n += 1) {
          const [a, b] = [morph.keys[active[n - 1] ?? 0], morph.keys[active[n] ?? 0]];
          const order = morphGroupIndex(a?.track ?? "joy") - morphGroupIndex(b?.track ?? "joy") || (active[n - 1] ?? 0) - (active[n] ?? 0);
          expect(order).toBeLessThan(0);
        }
        // One track's stops never sum past 1.
        for (const track of MORPH_TRACKS) {
          const sum = morph.keys.reduce((s, k, i) => s + (k.track === track ? (plan.weights[i] ?? 0) : 0), 0);
          expect(sum).toBeLessThanOrEqual(1 + 1e-9);
        }
      }),
    );
  });
});

describe("what a morph rig takes from the pose", () => {
  it("groups present: a mouth key and gaze keys", () => {
    const rig = morphRig();
    expect(morphHas(rig.morph, "mouth")).toBe(true);
    expect(hasMorphGaze(rig)).toBe(true);
    expect(hasMorphGaze(morphRig(MORPH_KEYS.filter((k) => !k.track.startsWith("gaze"))))).toBe(false);
    expect(morphHas(undefined, "blink")).toBe(false);
  });

  it("the turn's face comes from morph.eyes when the head has no eye layer", () => {
    const rig = morphRig();
    const face = turnHead(rig)?.face;
    const d = 50;
    const rx = (FACE_OF_EYES * (d + MORPH_EYE_WIDTH * d)) / 2;
    expect(face?.cx).toBe(130);
    expect(face?.rx).toBeCloseTo(Math.min(70, rx), 9);
    expect(face?.cy).toBeGreaterThan(105);
    const plain = { ...rig };
    delete plain.morph;
    expect(turnHead(plain)?.face).toEqual({ cx: 130, cy: 120, rx: 70, ry: 90 });
  });

  it("a morph rig breathes; the same rig without morph keys does not", () => {
    const rig = morphRig();
    expect(breathes(rig, {})).toBe(true);
    const plain = { ...rig };
    delete plain.morph;
    expect(breathes(plain, {})).toBe(false);
  });
});
