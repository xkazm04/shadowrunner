// An eye's own blink, Motion.blink (cast-forge task 6, the Tallyman's six eyes counting one at a
// time): the closure is a half-sine over OWN_BLINK_S once per cycle and 0 otherwise, periodic in
// 1 / freq, zero when still; poseLayers squashes only that eye, by the larger of its own closure and
// Drive.blink; validateRig accepts it on an eye, rejects it elsewhere and out of range, and the
// serializer round-trips it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OWN_BLINK_S, ownBlinkAt } from "../motion.js";
import { poseLayers, type Drive } from "../pose.js";
import { serializeRig } from "../serialize.js";
import type { BlinkMotion, Layer, Motion, Rig } from "../types.js";
import { validateRig, type RigError } from "../validate.js";
import { arbFreq, arbPhase } from "./arb.js";

const arbBlink: fc.Arbitrary<BlinkMotion> = fc.record({ freq: arbFreq, phase: arbPhase }, { requiredKeys: ["freq"] });
const arbT = fc.integer({ min: 0, max: 600_000 }).map((i) => i / 1000);

const layer = (name: string, z: number, kind: Layer["kind"], motion?: Motion): Layer => ({
  name,
  z,
  kind,
  file: `${name}.png`,
  bbox: [100 + 60 * z, 100, 40, 20],
  anchor: [120 + 60 * z, 110],
  ...(motion === undefined ? {} : { motion }),
});
const rigOf = (layers: Layer[]): Rig => ({
  version: 1,
  id: "t",
  name: "T",
  width: 1024,
  height: 1024,
  source: "replay",
  palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
  layers,
});
const drive = (t: number, extra: Partial<Drive> = {}): Drive => ({ t, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, ...extra });
const squashOf = (rig: Rig, d: Drive, name: string): number => {
  const pose = poseLayers(rig, { palette: rig.palette, hidden: [], emotion: "neutral" }, d).find((p) => p.name === name);
  if (pose === undefined) throw new Error(`no pose for ${name}`);
  return pose.scale[1] / pose.scale[0];
};

describe("ownBlinkAt", () => {
  it("is a closure in [0, 1], shut only in the first OWN_BLINK_S of each cycle, periodic in 1 / freq", () => {
    fc.assert(
      fc.property(arbBlink, arbT, fc.integer({ min: 1, max: 3 }), (blink, t, n) => {
        const c = ownBlinkAt({ blink }, t);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        const cycle = blink.freq * t + (blink.phase ?? 0);
        const since = (cycle - Math.floor(cycle)) / blink.freq;
        if (since >= OWN_BLINK_S + 1e-6) expect(c).toBe(0);
        expect(Math.abs(ownBlinkAt({ blink }, t + n / blink.freq) - c)).toBeLessThanOrEqual(1e-5);
      }),
    );
  });

  it("is shut at the middle of its blink, at the cycle start set by the phase", () => {
    const blink: BlinkMotion = { freq: 0.25, phase: 0.5 };
    // The cycle starts where 0.25 t + 0.5 is whole: t = 2, 6, ...; shut at t = 2 + OWN_BLINK_S / 2.
    expect(ownBlinkAt({ blink }, 2 + OWN_BLINK_S / 2)).toBeCloseTo(1, 9);
    expect(ownBlinkAt({ blink }, 6 + OWN_BLINK_S / 2)).toBeCloseTo(1, 9);
    expect(ownBlinkAt({ blink }, 1)).toBe(0);
    expect(ownBlinkAt({ blink }, 2 + OWN_BLINK_S + 0.01)).toBe(0);
  });

  it("is 0 when still, absent, without a blink, or at a non-finite t", () => {
    fc.assert(
      fc.property(arbBlink, arbT, (blink, t) => {
        expect(ownBlinkAt({ blink }, t, true)).toBe(0);
        expect(ownBlinkAt(undefined, t)).toBe(0);
        expect(ownBlinkAt({ pulse: { amp: 1, freq: 1 } }, t)).toBe(0);
        expect(ownBlinkAt({ blink }, Number.NaN)).toBe(0);
      }),
    );
  });
});

describe("poseLayers with an eye's own blink", () => {
  const blink: BlinkMotion = { freq: 0.5, phase: 0 };
  const mid = OWN_BLINK_S / 2;
  const rig = rigOf([layer("head", 0, "head"), layer("eye_a", 1, "eye", { blink }), layer("eye_b", 2, "eye", { blink: { freq: 0.5, phase: 0.5 } }), layer("eye_c", 3, "eye")]);

  it("squashes only the eye whose blink is running, the others stay open", () => {
    expect(squashOf(rig, drive(mid), "eye_a")).toBeCloseTo(0.1, 9);
    expect(squashOf(rig, drive(mid), "eye_b")).toBe(1);
    expect(squashOf(rig, drive(mid), "eye_c")).toBe(1);
    expect(squashOf(rig, drive(1 + mid), "eye_b")).toBeCloseTo(0.1, 9);
    expect(squashOf(rig, drive(1 + mid), "eye_a")).toBe(1);
    expect(squashOf(rig, drive(mid), "head")).toBe(1);
  });

  it("takes the larger of its own closure and Drive.blink, and is open when still", () => {
    expect(squashOf(rig, drive(1 + mid, { blink: 0.5 }), "eye_a")).toBeCloseTo(0.55, 9);
    expect(squashOf(rig, drive(mid, { blink: 0.5 }), "eye_a")).toBeCloseTo(0.1, 9);
    expect(squashOf(rig, drive(mid, { still: true }), "eye_a")).toBe(1);
    expect(squashOf(rig, drive(mid, { still: true, blink: 1 }), "eye_a")).toBeCloseTo(0.1, 9);
  });
});

describe("validateRig and serializeRig with Motion.blink", () => {
  const errorsOf = (input: unknown): RigError[] => {
    const result = validateRig(input);
    if (result.ok) throw new Error("expected validation to fail");
    return result.errors;
  };

  it("accepts every in-range blink on an eye layer and round-trips it", () => {
    fc.assert(
      fc.property(arbBlink, (blink) => {
        const rig = rigOf([layer("head", 0, "head"), layer("eye", 1, "eye", { blink })]);
        const result = validateRig(JSON.parse(serializeRig(rig)));
        expect(result.ok && result.value.layers[1]?.motion).toEqual({ blink });
      }),
    );
  });

  it("rejects a blink on a layer that is not an eye", () => {
    const errors = errorsOf(rigOf([layer("head", 0, "head", { blink: { freq: 0.5 } })]));
    expect(errors.map((e) => [e.code, e.path])).toEqual([["bad_shape", "$.layers[0].motion.blink"]]);
  });

  it("reports every out-of-range field at its path", () => {
    const bad = rigOf([layer("eye", 0, "eye")]);
    const wire = JSON.parse(serializeRig(bad)) as { layers: Record<string, unknown>[] };
    const eye = wire.layers[0];
    if (eye === undefined) throw new Error("no layer");
    eye.motion = { blink: { freq: 3, phase: 1 } };
    expect(errorsOf(wire).map((e) => e.path)).toEqual(["$.layers[0].motion.blink.freq", "$.layers[0].motion.blink.phase"]);
    eye.motion = { blink: 0.5 };
    expect(errorsOf(wire).map((e) => e.path)).toEqual(["$.layers[0].motion.blink"]);
  });
});
