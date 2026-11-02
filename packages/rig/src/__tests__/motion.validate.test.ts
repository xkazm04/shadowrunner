// Layer.motion in validateRig and serializeRig (cast-forge task 1, req 1.1-1.2): every in-range
// motion is accepted and round-trips; each out-of-range field is rejected alone as `bad_shape` at
// its exact path; several faults are all reported; absent motion is omitted on the wire.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { serializeRig } from "../serialize.js";
import type { Layer, Rig } from "../types.js";
import { parseRigJson, validateRig, type RigError } from "../validate.js";
import { arbFloat, arbPulse, nth, rigArb } from "./arb.js";

type Json = Record<string, unknown>;
const wire = (rig: Rig): { layers: Json[] } & Json => JSON.parse(serializeRig(rig)) as { layers: Json[] } & Json;

function errorsOf(input: unknown): RigError[] {
  const result = validateRig(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

/** A valid rig whose layer `i` carries both a float and a pulse. */
const arbScene = rigArb({ minLayers: 1, maxLayers: 5 }).chain((rig) =>
  fc.tuple(fc.constant(rig), fc.nat(), arbFloat(rig.width, rig.height), arbPulse).map(([r, pick, float, pulse]) => {
    const i = pick % r.layers.length;
    const layers = r.layers.map((l, j): Layer => (j === i ? { ...l, motion: { float: { ...float }, pulse: { ...pulse } } } : l));
    return { rig: { ...r, layers }, i };
  }),
);

/** One out-of-range value per field, given the canvas; each is just past its bound or of the wrong type. */
interface Fault {
  field: string;
  path: (i: number) => string;
  set: (motion: Json, width: number, height: number) => void;
}
const obj = (value: unknown): Json => value as Json;
const FAULTS: Fault[] = [
  { field: "float.amp[0] > 0.05 w", path: (i) => `$.layers[${i}].motion.float.amp[0]`, set: (m, w) => void ((obj(m.float).amp as number[])[0] = 0.05 * w + 0.25) },
  { field: "float.amp[0] < 0", path: (i) => `$.layers[${i}].motion.float.amp[0]`, set: (m) => void ((obj(m.float).amp as number[])[0] = -0.5) },
  { field: "float.amp[1] > 0.05 h", path: (i) => `$.layers[${i}].motion.float.amp[1]`, set: (m, _w, h) => void ((obj(m.float).amp as number[])[1] = 0.05 * h + 0.25) },
  { field: "float.amp not a pair", path: (i) => `$.layers[${i}].motion.float.amp`, set: (m) => void (obj(m.float).amp = [1]) },
  { field: "float.freq < 0.02", path: (i) => `$.layers[${i}].motion.float.freq`, set: (m) => void (obj(m.float).freq = 0.019) },
  { field: "float.freq > 2", path: (i) => `$.layers[${i}].motion.float.freq`, set: (m) => void (obj(m.float).freq = 2.01) },
  { field: "float.rot_deg > 15", path: (i) => `$.layers[${i}].motion.float.rot_deg`, set: (m) => void (obj(m.float).rot_deg = 15.5) },
  { field: "float.rot_deg < 0", path: (i) => `$.layers[${i}].motion.float.rot_deg`, set: (m) => void (obj(m.float).rot_deg = -1) },
  { field: "float.phase = 1", path: (i) => `$.layers[${i}].motion.float.phase`, set: (m) => void (obj(m.float).phase = 1) },
  { field: "float.phase < 0", path: (i) => `$.layers[${i}].motion.float.phase`, set: (m) => void (obj(m.float).phase = -0.1) },
  { field: "pulse.amp > 1", path: (i) => `$.layers[${i}].motion.pulse.amp`, set: (m) => void (obj(m.pulse).amp = 1.01) },
  { field: "pulse.amp < 0", path: (i) => `$.layers[${i}].motion.pulse.amp`, set: (m) => void (obj(m.pulse).amp = -0.01) },
  { field: "pulse.freq < 0.02", path: (i) => `$.layers[${i}].motion.pulse.freq`, set: (m) => void (obj(m.pulse).freq = 0) },
  { field: "pulse.freq > 2", path: (i) => `$.layers[${i}].motion.pulse.freq`, set: (m) => void (obj(m.pulse).freq = 3) },
  { field: "pulse.phase = 1", path: (i) => `$.layers[${i}].motion.pulse.phase`, set: (m) => void (obj(m.pulse).phase = 1) },
  { field: "pulse.freq not a number", path: (i) => `$.layers[${i}].motion.pulse.freq`, set: (m) => void (obj(m.pulse).freq = "fast") },
  { field: "float not an object", path: (i) => `$.layers[${i}].motion.float`, set: (m) => void (m.float = 7) },
];

describe("validateRig: Layer.motion", () => {
  it("accepts every in-range motion and round-trips it through serializeRig unchanged", () => {
    fc.assert(
      fc.property(rigArb({ motion: true }), (rig) => {
        expect(validateRig(rig)).toEqual({ ok: true, value: rig });
        expect(parseRigJson(serializeRig(rig))).toEqual({ ok: true, value: rig });
      }),
    );
  });

  for (const fault of FAULTS) {
    it(`rejects ${fault.field} alone, as bad_shape at its exact path`, () => {
      fc.assert(
        fc.property(arbScene, ({ rig, i }) => {
          const json = wire(rig);
          const layer = nth(json.layers, i);
          fault.set(obj(layer.motion), rig.width, rig.height);
          const errors = errorsOf(json);
          expect(errors.map((e) => ({ code: e.code, path: e.path, layer: e.layer }))).toEqual([{ code: "bad_shape", path: fault.path(i), layer: nth(rig.layers, i).name }]);
        }),
      );
    });
  }

  it("reports every motion fault of a layer, not just the first", () => {
    fc.assert(
      fc.property(arbScene, ({ rig, i }) => {
        const json = wire(rig);
        const motion = obj(nth(json.layers, i).motion);
        obj(motion.float).freq = 9;
        obj(motion.float).rot_deg = 99;
        obj(motion.pulse).amp = 2;
        obj(motion.pulse).phase = 1.5;
        const paths = errorsOf(json).map((e) => e.path);
        const at = `$.layers[${i}].motion`;
        expect(paths).toEqual([`${at}.float.freq`, `${at}.float.rot_deg`, `${at}.pulse.amp`, `${at}.pulse.phase`]);
      }),
    );
  });

  it("rejects a motion that is not an object, and accepts motion with neither curve", () => {
    const base: Rig = { version: 1, id: "m", name: "m", width: 100, height: 100, source: "forge", palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" }, layers: [] };
    const layer = { name: "a", z: 0, kind: "crown", file: "a.png", bbox: [0, 0, 10, 10], anchor: [5, 5] };
    expect(errorsOf({ ...base, layers: [{ ...layer, motion: null }] }).map((e) => e.path)).toEqual(["$.layers[0].motion"]);
    expect(errorsOf({ ...base, layers: [{ ...layer, motion: [1] }] }).map((e) => e.path)).toEqual(["$.layers[0].motion"]);
    expect(validateRig({ ...base, layers: [{ ...layer, motion: {} }] }).ok).toBe(true);
  });

  it("drops fields outside the motion contract", () => {
    const result = validateRig({
      version: 1, id: "m", name: "m", width: 100, height: 100, source: "forge",
      palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
      layers: [{ name: "a", z: 0, kind: "crown", file: "a.png", bbox: [0, 0, 10, 10], anchor: [5, 5], motion: { float: { amp: [1, 2], freq: 0.2, extra: 1 }, wobble: true } }],
    });
    expect(result.ok && result.value.layers[0]?.motion).toEqual({ float: { amp: [1, 2], freq: 0.2 } });
  });
});

describe("serializeRig: Layer.motion", () => {
  it("omits motion when absent and writes no null", () => {
    fc.assert(
      fc.property(rigArb(), (rig) => {
        const text = serializeRig(rig);
        expect(text).not.toContain('"motion"');
        expect(text).not.toContain("null");
      }),
    );
  });

  it("writes motion last in a layer, with keys in contract order", () => {
    fc.assert(
      fc.property(arbScene, ({ rig, i }) => {
        const layer = nth(wire(rig).layers, i);
        const keys = Object.keys(layer);
        expect(keys[keys.length - 1]).toBe("motion");
        const motion = obj(layer.motion);
        expect(Object.keys(motion)).toEqual(["float", "pulse"]);
        expect(Object.keys(obj(motion.float))).toEqual(["amp", "freq", "rot_deg", "phase"].filter((k) => k in obj(motion.float)));
        expect(Object.keys(obj(motion.pulse))).toEqual(["amp", "freq", "phase"].filter((k) => k in obj(motion.pulse)));
      }),
    );
  });
});
