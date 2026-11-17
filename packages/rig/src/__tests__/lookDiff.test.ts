// rig/B (challenge-2026-11-17): what changed in a look since it was opened, one change reverted at a
// time. lookChanges names every change (area, key, label, before, after); revertChange sets one back
// to the opened value; sameLook is structural equality, blind to key order, and true iff there is no
// change. The action-sequence property over the creator's reducer lives beside it
// (apps/web/src/creator/customize/lookDiff.props.test.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EXPRESSION_FAMILIES } from "../control.js";
import { FACE_FIELDS, FACE_LIMITS, withFaceValue, withRetired } from "../face.js";
import { defaultLook } from "../look.js";
import { lookChanges, revertChange, sameLook } from "../lookDiff.js";
import type { Emotion, Gesture, Look, PartShape, Rig, RigFace } from "../types.js";

const rig: Rig = {
  version: 1,
  id: "diff-ghost",
  name: "Diff Ghost",
  width: 64,
  height: 64,
  source: "forge",
  fictional: true,
  palette: { glow: "#112233", eye: "#445566", rim: "#778899", mouth: "#aabbcc" },
  layers: [
    { name: "head", z: 1, kind: "head", file: "head.png", bbox: [16, 8, 32, 36], anchor: [32, 40] },
    {
      name: "horn",
      z: 2,
      kind: "accessory",
      file: "horn.png",
      bbox: [16, 0, 32, 10],
      anchor: [32, 8],
      follow: "head",
      regions: { map: "horn_regions.png", slots: [{ id: "s1", name: "Horn tip", hex: "#aa0000" }, { id: "s2", name: "Horn base", hex: "#00aa00" }] },
    },
    { name: "cape", z: 3, kind: "body", file: "cape.png", bbox: [8, 40, 48, 24], anchor: [32, 52] },
  ],
};

const opened = defaultLook(rig);
const p = opened.palette;

describe("lookChanges", () => {
  it("is empty for a look against itself, and blind to the key order of regions and face", () => {
    expect(lookChanges(rig, opened, opened)).toEqual([]);
    const a: Look = { ...opened, regions: { "horn/s1": "#010203", "horn/s2": "#040506" }, face: { gaze: { range: 0.3, saccadeRate: 2 }, motion: { tilt: 1.5 } } };
    const b: Look = { ...opened, regions: { "horn/s2": "#040506", "horn/s1": "#010203" }, face: { motion: { tilt: 1.5 }, gaze: { saccadeRate: 2, range: 0.3 } } };
    expect(lookChanges(rig, a, b)).toEqual([]);
  });

  it("names a palette change with its label, before and after", () => {
    expect(lookChanges(rig, defaultLook(rig), { ...defaultLook(rig), palette: { ...p, eye: "#ff0000" } })).toEqual([
      { area: "palette", key: "eye", label: "Eye colour", before: p.eye, after: "#ff0000" },
    ]);
  });

  it("labels a region by its layer and slot name; a shape by its layer; a face field by its path; a hidden layer by its name", () => {
    expect(lookChanges(rig, opened, { ...opened, regions: { "horn/s1": "#ff0000" } })).toEqual([
      expect.objectContaining({ area: "region", key: "horn/s1", label: "horn: Horn tip", after: "#ff0000" }),
    ]);
    const shape: PartShape = { size: 1.2, sx: 1, sy: 1, dx: 0, dy: 0, rot: 0 };
    expect(lookChanges(rig, opened, { ...opened, shape: { horn: shape } })).toEqual([expect.objectContaining({ area: "shape", key: "horn", after: shape })]);
    expect(lookChanges(rig, opened, { ...opened, face: { gaze: { range: 0.2 } } })).toEqual([expect.objectContaining({ area: "face", key: "gaze.range", after: 0.2 })]);
    expect(lookChanges(rig, opened, { ...opened, hidden: ["cape"] })).toEqual([expect.objectContaining({ area: "hidden", key: "cape", before: false, after: true })]);
  });

  it("covers emotion, gesture, retired faces, motion and turn, an absent side omitted", () => {
    const now: Look = { ...opened, emotion: "smug", gesture: "nod", face: { expression: { faces: { joy: "procedural" } } }, motion: { spring: 0.5 }, turn: { light: 0.2 } };
    expect(lookChanges(rig, opened, now).map((c) => [c.area, c.key])).toEqual([
      ["emotion", "emotion"],
      ["gesture", "gesture"],
      ["face", "expression.faces.joy"],
      ["motion", "motion.spring"],
      ["turn", "turn.light"],
    ]);
    const gesture = lookChanges(rig, opened, now).find((c) => c.area === "gesture");
    expect(gesture).toEqual({ area: "gesture", key: "gesture", label: "Gesture", after: "nod" });
  });
});

// ---- properties over generated looks of `rig` ----
const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`);
const EMOTIONS: Emotion[] = ["neutral", "amused", "smug", "irritated", "furious", "delighted", "bored", "suspicious", "grim", "theatrical"];
const GESTURES: Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];
const LAYERS = rig.layers.map((l) => l.name);
const tenth = (min: number, max: number): fc.Arbitrary<number> => fc.integer({ min: Math.round(min * 10), max: Math.round(max * 10) }).map((n) => n / 10);
const arbShape: fc.Arbitrary<PartShape> = fc.record({ size: tenth(0.5, 1.5), sx: tenth(0.5, 1.5), sy: tenth(0.5, 1.5), dx: tenth(-0.2, 0.2), dy: tenth(-0.2, 0.2), rot: fc.integer({ min: -30, max: 30 }) });
const arbFace: fc.Arbitrary<RigFace | undefined> = fc
  .tuple(
    fc.array(fc.tuple(fc.constantFrom(...FACE_FIELDS), fc.integer({ min: 0, max: 10 })), { maxLength: 4 }),
    fc.subarray([...EXPRESSION_FAMILIES]),
  )
  .map(([fields, families]) => {
    let face: RigFace | undefined;
    for (const [field, step] of fields) {
      const [min, max] = FACE_LIMITS[field];
      face = withFaceValue(face, field, min + ((max - min) * step) / 10);
    }
    for (const family of families) face = withRetired(face, family, true);
    return face === undefined || Object.keys(face).length === 0 ? undefined : face;
  });
const optional = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.option(arb, { nil: undefined });
const arbLook: fc.Arbitrary<Look> = fc
  .record({
    palette: fc.record({ glow: fc.constantFrom(p.glow, "#000000"), eye: fc.oneof(hex, fc.constant(p.eye)), rim: fc.constantFrom(p.rim, "#ffffff"), mouth: fc.constant(p.mouth) }),
    hidden: fc.shuffledSubarray(LAYERS),
    emotion: fc.constantFrom(...EMOTIONS),
    gesture: optional(fc.constantFrom(...GESTURES)),
    regions: optional(fc.dictionary(fc.constantFrom("horn/s1", "horn/s2"), hex, { minKeys: 1 })),
    shape: optional(fc.dictionary(fc.constantFrom(...LAYERS), arbShape, { minKeys: 1 })),
    face: arbFace,
    motion: optional(fc.record({ spring: tenth(0, 2) })),
    turn: optional(fc.record({ warp: tenth(0, 1), light: tenth(0, 1) }, { requiredKeys: [] })),
  })
  .map((r) => {
    const look: Look = { palette: r.palette, hidden: r.hidden, emotion: r.emotion };
    if (r.gesture !== undefined) look.gesture = r.gesture;
    if (r.regions !== undefined) look.regions = r.regions;
    if (r.shape !== undefined) look.shape = r.shape;
    if (r.face !== undefined) look.face = r.face;
    if (r.motion !== undefined) look.motion = r.motion;
    if (r.turn !== undefined && Object.keys(r.turn).length > 0) look.turn = r.turn;
    return look;
  });

/** `look` rebuilt with every object's keys (and `hidden`) reversed. */
function reordered(look: Look): Look {
  const flip = (v: unknown): unknown =>
    Array.isArray(v) ? [...v].reverse() : typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)])) : v;
  return flip(look) as Look;
}

describe("revertChange and sameLook (properties)", () => {
  it("reverting one change leaves exactly the others", () => {
    fc.assert(
      fc.property(arbLook, arbLook, (from, now) => {
        const changes = lookChanges(rig, from, now);
        changes.forEach((c, i) => {
          expect(lookChanges(rig, from, revertChange(now, from, c))).toEqual(changes.filter((_, j) => j !== i));
        });
      }),
    );
  });

  it("reverting every change in turn gives the look as opened", () => {
    fc.assert(
      fc.property(arbLook, arbLook, (from, now) => {
        const back = lookChanges(rig, from, now).reduce((look, c) => revertChange(look, from, c), now);
        expect(sameLook(back, from)).toBe(true);
      }),
    );
  });

  it("sameLook ignores key order and is true iff lookChanges is empty", () => {
    fc.assert(
      fc.property(arbLook, arbLook, (a, b) => {
        expect(sameLook(a, reordered(a))).toBe(true);
        expect(lookChanges(rig, a, reordered(a))).toEqual([]);
        expect(sameLook(a, b)).toBe(lookChanges(rig, a, b).length === 0);
      }),
    );
  });

  it("revertChange never modifies its inputs", () => {
    fc.assert(
      fc.property(arbLook, arbLook, (from, now) => {
        const [f, n] = [JSON.stringify(from), JSON.stringify(now)];
        for (const c of lookChanges(rig, from, now)) revertChange(now, from, c);
        expect([JSON.stringify(from), JSON.stringify(now)]).toEqual([f, n]);
      }),
    );
  });
});
