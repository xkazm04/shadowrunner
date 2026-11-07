// Signature acts (tiger L1, act.ts): `s` seconds after an act the pose is the idle pose bit for
// bit, before its start too; an act naming a missing layer is a no-op; under reduced motion an
// act moves nothing (only the layer's light, for one beat); `readAct` keeps only good entries and
// a rig carrying acts round-trips through serializeRig / parseRigJson.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACT_S, ACT_STILL_GAIN, actMotionAt, actSeconds, readAct } from "../act.js";
import { motionAt } from "../motion.js";
import { poseLayers, type Drive } from "../pose.js";
import { serializeRig } from "../serialize.js";
import type { Layer, LayerAct, Look, Rig } from "../types.js";
import { parseRigJson } from "../validate.js";
import { nth, rigArb } from "./arb.js";

const lookOf = (rig: Rig): Look => ({ palette: rig.palette, hidden: [], emotion: "neutral" });
const driveAt = (t: number, still = false, act?: Drive["act"]): Drive => ({ t, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, ...(still ? { still } : {}), ...(act === undefined ? {} : { act }) });
const arbActField: fc.Arbitrary<LayerAct> = fc.record(
  { cue: fc.constant(["sold"]), gain: fc.integer({ min: 10, max: 30 }).map((g) => g / 10), s: fc.integer({ min: 6, max: 15 }).map((s) => s / 10) },
  { requiredKeys: ["cue"] },
);
/** A rig with motion where one layer (picked) carries an act. */
const arbActRig = fc
  .tuple(rigArb({ minLayers: 1, maxLayers: 6, motion: true }), fc.nat(), arbActField)
  .map(([rig, pick, act]) => {
    const target = nth(rig.layers, pick).name;
    return { rig: { ...rig, layers: rig.layers.map((l): Layer => (l.name === target ? { ...l, act } : l)) }, target, act };
  });
const arbT = fc.integer({ min: 0, max: 600_000 }).map((i) => i / 1000);

describe("act playback in poseLayers", () => {
  it("s seconds after an act (and before it starts) the pose equals idle, byte for byte", () => {
    fc.assert(
      fc.property(arbActRig, arbT, fc.integer({ min: 0, max: 5000 }), fc.boolean(), ({ rig, target, act }, start, after, still) => {
        const s = actSeconds(act);
        const later = start + s + after / 1000;
        const idle = poseLayers(rig, lookOf(rig), driveAt(later, still));
        expect(JSON.stringify(poseLayers(rig, lookOf(rig), driveAt(later, still, { layer: target, startedAt: start })))).toBe(JSON.stringify(idle));
        const before = Math.max(0, start - 0.25);
        if (before < start) expect(poseLayers(rig, lookOf(rig), driveAt(before, still, { layer: target, startedAt: start }))).toEqual(poseLayers(rig, lookOf(rig), driveAt(before, still)));
      }),
    );
  });

  it("an act naming a missing layer is a no-op", () => {
    fc.assert(
      fc.property(rigArb({ maxLayers: 6, motion: true }), arbT, fc.integer({ min: 0, max: 900 }), (rig, t, back) => {
        const act = { layer: "no_such_layer_0", startedAt: t - back / 1000 };
        const missing = rig.layers.some((l) => l.name === act.layer);
        fc.pre(!missing);
        expect(JSON.stringify(poseLayers(rig, lookOf(rig), driveAt(t, false, act)))).toBe(JSON.stringify(poseLayers(rig, lookOf(rig), driveAt(t))));
      }),
    );
  });

  it("under reduced motion an act moves nothing: only the layer's light, raised for one beat", () => {
    fc.assert(
      fc.property(arbActRig, arbT, fc.integer({ min: 0, max: 999 }), ({ rig, target, act }, start, frac) => {
        const t = start + (actSeconds(act) * frac) / 1000;
        const idle = poseLayers(rig, lookOf(rig), driveAt(t, true));
        const acted = poseLayers(rig, lookOf(rig), driveAt(t, true, { layer: target, startedAt: start }));
        acted.forEach((pose, i) => {
          const base = idle[i];
          expect({ ...pose, tint: 0 }).toEqual({ ...base, tint: 0 });
          if (pose.name !== target) expect(pose.tint).toBe(base?.tint);
        });
        const own = actMotionAt(nth(rig.layers.filter((l) => l.name === target), 0), t, true, { layer: target, startedAt: start }, rig.height);
        expect(own.gain).toBeCloseTo(frac < 500 ? ACT_STILL_GAIN : 1, 9);
      }),
    );
  });

  it("mid-act the part moves (a dip when it has no periodic motion), then returns", () => {
    const layer: Layer = { name: "hand_r", z: 1, kind: "accessory", file: "h.png", bbox: [0, 0, 10, 10], anchor: [5, 5], act: { cue: ["sold"] } };
    const mid = actMotionAt(layer, 0.5, false, { layer: "hand_r", startedAt: 0 }, 1000);
    expect(mid.dy).toBeGreaterThan(0);
    expect(actMotionAt(layer, ACT_S, false, { layer: "hand_r", startedAt: 0 }, 1000)).toEqual(motionAt(undefined, ACT_S));
  });
});

describe("readAct", () => {
  it("keeps only lowercase cue words (at most 3, each <= 24 chars) and in-range gain and s", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.string(), fc.stringMatching(/^[a-z]{1,30}$/), fc.integer()), { maxLength: 6 }), fc.double(), fc.double(), (cue, gain, s) => {
        const act = readAct({ cue, gain, s });
        if (act === undefined) return;
        expect(act.cue.length).toBeGreaterThanOrEqual(1);
        expect(act.cue.length).toBeLessThanOrEqual(3);
        for (const word of act.cue) expect(word).toMatch(/^[a-z][a-z0-9'-]{0,23}$/);
        if (act.gain !== undefined) expect(act.gain >= 1 && act.gain <= 3).toBe(true);
        if (act.s !== undefined) expect(act.s >= 0.6 && act.s <= 1.5).toBe(true);
      }),
    );
    expect(readAct({ cue: ["Sold", 3] })).toBeUndefined();
    expect(readAct({ cue: ["sold", "sold", "gone"], gain: 9 })).toEqual({ cue: ["sold", "gone"] });
    expect(readAct("sold")).toBeUndefined();
  });

  it("an act survives serializeRig -> parseRigJson on an accessory, and is dropped on a head", () => {
    const base: Rig = {
      version: 1, id: "r", name: "R", width: 100, height: 100, source: "forge", palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
      layers: [
        { name: "head", z: 0, kind: "head", file: "a.png", bbox: [0, 0, 10, 10], anchor: [5, 5], act: { cue: ["nod"] } },
        { name: "hand_r", z: 1, kind: "accessory", file: "b.png", bbox: [0, 0, 10, 10], anchor: [5, 5], act: { cue: ["sold"], gain: 2, s: 0.8 } },
      ],
    };
    const read = parseRigJson(serializeRig(base));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.layers[1]?.act).toEqual({ cue: ["sold"], gain: 2, s: 0.8 });
    expect(read.value.layers[0]?.act).toBeUndefined();
  });
});
