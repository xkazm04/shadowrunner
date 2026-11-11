// Morph round 3 (companion-lanes): `MorphKey.part` on the wire, and the plan's colour scale beside
// its motion weight - a lower face key gives way to a speaking mouth, a gaze key shows no paint
// under an expression - with the cap, order and reuse of the plan kept.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FACE_DEFAULTS } from "../face.js";
import { MORPH_MAX_ACTIVE, morphPlan, type MorphInputs } from "../morph.js";
import { serializeRig } from "../serialize.js";
import type { MorphKey, Rig, RigMorph } from "../types.js";
import { parseRigJson, validateRig } from "../validate.js";
import { morphRig } from "./morphRig.js";

const box = (id: string, track: MorphKey["track"], over: Partial<MorphKey> = {}): MorphKey => ({ id, track, bbox: [70, 70, 120, 130], cell: [0, 0, 10, 10], ...over });
const PARTS: MorphKey[] = [
  box("joy_up", "joy", { part: "upper" }),
  box("joy_low", "joy", { part: "lower" }),
  box("open", "openMid"),
  box("look_l", "gazeL"),
  box("look_r", "gazeR"),
  box("blink", "blink"),
];
const rigWith = (keys: MorphKey[]): Rig => {
  const rig = morphRig();
  delete rig.morph?.flow;
  return { ...rig, morph: { ...(rig.morph as RigMorph), keys } };
};
const REST: MorphInputs = { blink: 0, emotion: "neutral", face: FACE_DEFAULTS };
const plan = (keys: MorphKey[], inputs: Partial<MorphInputs>) => {
  const morph = rigWith(keys).morph as RigMorph;
  const p = morphPlan(morph, { ...REST, ...inputs });
  const of = (id: string): { w: number; colour: number; active: boolean } => {
    const i = morph.keys.findIndex((k) => k.id === id);
    return { w: p.weights[i] ?? 0, colour: p.colour[i] ?? 0, active: Array.from(p.active.subarray(0, p.count)).includes(i) };
  };
  return { p, of };
};

describe("MorphKey.part on the wire", () => {
  it("an upper and a lower key share a stop; it round-trips in contract order", () => {
    const rig = rigWith(PARTS);
    const result = validateRig(JSON.parse(serializeRig(rig)));
    expect(result.ok ? [] : result.errors).toEqual([]);
    const back = parseRigJson(serializeRig(rig));
    expect(back.ok && back.value.morph?.keys[1]).toEqual(PARTS[1]);
    expect(Object.keys((JSON.parse(serializeRig(rig)) as { morph: { keys: object[] } }).morph.keys[0] ?? {}).at(-1)).toBe("part");
  });

  it.each<[string, MorphKey[], string]>([
    ["a part on a gaze key", [box("look", "gazeL", { part: "upper" })], "$.morph.keys[0].part"],
    ["a part that is not upper or lower", [box("joy", "joy", { part: "middle" as MorphKey["part"] })], "$.morph.keys[0].part"],
    ["two lower keys at one stop", [box("a", "joy", { part: "lower" }), box("b", "joy", { part: "lower" })], "$.morph.keys[1].at"],
    ["a whole-face key beside parts", [box("a", "joy", { part: "upper" }), box("b", "joy", { at: 0.5 })], "$.morph.keys[1].part"],
  ])("refuses %s", (_label, keys, path) => {
    const result = validateRig(JSON.parse(serializeRig(rigWith(keys))));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContainEqual(expect.objectContaining({ code: "bad_shape", path }));
  });
});

describe("colour and motion", () => {
  it("a lower face key: colour 1 - speak, motion w (1 - speak / 2); the upper key untouched; colour 0 stays active", () => {
    for (const [speak, colour, w] of [[0, 1, 1], [0.5, 0.5, 0.75], [1, 0, 0.5]] as const) {
      const { of } = plan(PARTS, { emotion: "amused", speak });
      expect(of("joy_low")).toEqual({ w, colour, active: true });
      expect(of("joy_up")).toEqual({ w: 1, colour: 1, active: true });
    }
  });

  it("a gaze key: colour and motion both 1 - E (the family values' sum, at most 1)", () => {
    expect(plan(PARTS, { gaze: { x: -0.5, y: 0 } }).of("look_l")).toEqual({ w: 0.5, colour: 1, active: true });
    expect(plan(PARTS, { emotion: "furious", gaze: { x: -0.5, y: 0 } }).of("look_l")).toEqual({ w: 0, colour: 0, active: false });
    expect(plan(PARTS, { emotion: "amused", mood: { from: "neutral", mix: 0.5 }, gaze: { x: 1, y: 0 } }).of("look_r")).toEqual({ w: 0.5, colour: 0.5, active: true });
  });

  it("a blink stop below the half yields to a held expression like gaze; the half and later stops do not", () => {
    const STOPS = [box("b_q", "blink", { at: 0.25 }), box("b_h", "blink", { at: 0.5 }), box("b_3q", "blink", { at: 0.75 }), box("b", "blink")];
    expect(plan(STOPS, { blink: 0.25 }).of("b_q")).toEqual({ w: 1, colour: 1, active: true });
    expect(plan(STOPS, { emotion: "furious", blink: 0.25 }).of("b_q")).toEqual({ w: 0, colour: 0, active: false });
    const mid = plan(STOPS, { emotion: "furious", blink: 0.375 });
    expect(mid.of("b_q")).toEqual({ w: 0, colour: 0, active: false });
    expect(mid.of("b_h")).toEqual({ w: 0.5, colour: 1, active: true });
    expect(plan(STOPS, { emotion: "furious", blink: 0.75 }).of("b_3q")).toEqual({ w: 1, colour: 1, active: true });
  });

  it("every other key shows its colour in full, speaking or not", () => {
    const { of } = plan(PARTS, { emotion: "amused", blink: 1, shapes: { openMid: 0.7 }, speak: 1 });
    expect(of("open")).toEqual({ w: 0.7, colour: 1, active: true });
    expect(of("blink")).toEqual({ w: 1, colour: 1, active: true });
  });

  it("colours stay in [0, 1], the cap and order hold, the plan is reused (property)", () => {
    const morph = rigWith(PARTS).morph as RigMorph;
    const first = morphPlan(morph, REST);
    const unit = fc.double({ min: -0.5, max: 1.5, noNaN: true });
    fc.assert(
      fc.property(unit, unit, unit, fc.constantFrom("neutral", "amused", "furious", "smug") as fc.Arbitrary<MorphInputs["emotion"]>, (speak, gx, blink, emotion) => {
        const p = morphPlan(morph, { ...REST, speak, blink, emotion, gaze: { x: gx, y: 0 }, shapes: { openMid: 0.5 } });
        expect(p).toBe(first);
        expect(p.count).toBeLessThanOrEqual(MORPH_MAX_ACTIVE);
        for (const c of p.colour) expect(c >= 0 && c <= 1).toBe(true);
        const active = Array.from(p.active.subarray(0, p.count));
        for (let i = 0; i < morph.keys.length; i += 1) expect(active.includes(i)).toBe((p.weights[i] ?? 0) > 0.002);
      }),
    );
  });
});
