// Layer.emissive (cast-forge task 12 follow-up, design.md "Emissive per layer"). Properties over
// arbitrary valid rigs with motion, every gesture at its peak: a layer without `emissive` poses
// exactly as before the field existed (the kind rule, written out here as the oracle: glare x1.6 on
// an eye, flare x2 on eye/crown/accessory, then the pulse); `emissive: false` takes no gesture light
// gain on any kind (its tint is its own pulse alone); `emissive: true` takes the flare on any kind.
// validateRig accepts both booleans and serializeRig round-trips them; anything else is bad_shape at
// `$.layers[i].emissive`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { motionAt } from "../motion.js";
import { EMISSIVE_KINDS, GESTURE_DURATION_S, isEmissive, poseLayers, type Drive } from "../pose.js";
import { serializeRig } from "../serialize.js";
import type { Gesture, Layer, LayerKind, Rig } from "../types.js";
import { parseRigJson, validateRig } from "../validate.js";
import { LAYER_KINDS, rigArb } from "./arb.js";

const GESTURES: readonly Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];
const arbEmissive = fc.constantFrom<boolean | undefined>(undefined, true, false);

/** A valid rig with motion; each layer's emissive is absent, true or false. */
const arbEmissiveRig = (choices: fc.Arbitrary<boolean | undefined>): fc.Arbitrary<Rig> =>
  rigArb({ minLayers: 1, maxLayers: 7, motion: true }).chain((rig) =>
    fc.array(choices, { minLength: rig.layers.length, maxLength: rig.layers.length }).map((flags) => ({
      ...rig,
      layers: rig.layers.map((l, i): Layer => {
        const emissive = flags[i];
        return { ...l, ...(emissive === undefined ? {} : { emissive }) };
      }),
    })),
  );

/** The tint rule before Layer.emissive existed (rig-core design.md), at a gesture's peak. */
function kindTint(kind: LayerKind, gesture: Gesture | undefined): number {
  const eye = kind === "eye" && gesture === "glare" ? 1.6 : 1;
  return eye * (EMISSIVE_KINDS.has(kind) && gesture === "flare" ? 2 : 1);
}

const peak = (t: number, gesture: Gesture | undefined): Drive => ({
  t,
  headYaw: 0,
  headPitch: 0,
  jawOpen: 0,
  blink: 0,
  ...(gesture === undefined ? {} : { gesture: { name: gesture, startedAt: t - GESTURE_DURATION_S / 2 } }),
});
const arbT = fc.integer({ min: 0, max: 20_000 }).map((i) => i / 100);
const arbGesture = fc.option(fc.constantFrom(...GESTURES), { nil: undefined });

function tints(rig: Rig, drive: Drive): Map<string, number> {
  return new Map(poseLayers(rig, { palette: rig.palette, hidden: [], emotion: "neutral" }, drive).map((p) => [p.name, p.tint]));
}

describe("Layer.emissive", () => {
  it("absent: every kind poses as before the field (the kind rule times its pulse)", () => {
    fc.assert(
      fc.property(arbEmissiveRig(fc.constant(undefined)), arbT, arbGesture, (rig, t, gesture) => {
        const got = tints(rig, peak(t, gesture));
        for (const layer of rig.layers) {
          if (!got.has(layer.name)) continue; // visible: false
          const expected = kindTint(layer.kind, gesture) * motionAt(layer.motion, t, false).gain;
          expect(got.get(layer.name), `${layer.kind} ${layer.name}`).toBeCloseTo(expected, 9);
          expect(isEmissive(layer)).toBe(EMISSIVE_KINDS.has(layer.kind));
        }
      }),
    );
  });

  it("absent is the same as the kind's default written out", () => {
    fc.assert(
      fc.property(arbEmissiveRig(fc.constant(undefined)), arbT, arbGesture, (rig, t, gesture) => {
        const explicit = { ...rig, layers: rig.layers.map((l) => ({ ...l, emissive: EMISSIVE_KINDS.has(l.kind) })) };
        expect(poseLayers(explicit, { palette: rig.palette, hidden: [], emotion: "neutral" }, peak(t, gesture))).toEqual(
          poseLayers(rig, { palette: rig.palette, hidden: [], emotion: "neutral" }, peak(t, gesture)),
        );
      }),
    );
  });

  it("false: no gesture light gain on any kind, only its own pulse; true: the flare on any kind", () => {
    fc.assert(
      fc.property(arbEmissiveRig(arbEmissive), arbT, arbGesture, (rig, t, gesture) => {
        const got = tints(rig, peak(t, gesture));
        for (const layer of rig.layers) {
          if (!got.has(layer.name)) continue; // visible: false
          const gain = motionAt(layer.motion, t, false).gain;
          const tint = got.get(layer.name) ?? NaN;
          if (layer.emissive === false) expect(tint, layer.name).toBeCloseTo(gain, 9);
          if (layer.emissive === true && gesture === "flare") expect(tint, layer.name).toBeCloseTo(2 * gain, 9);
        }
      }),
    );
  });

  it("validateRig accepts both booleans on every kind, and serializeRig round-trips them", () => {
    fc.assert(
      fc.property(arbEmissiveRig(arbEmissive), (rig) => {
        const checked = validateRig(rig);
        expect(checked.ok).toBe(true);
        const back = parseRigJson(serializeRig(rig));
        expect(back.ok).toBe(true);
        if (back.ok) expect(back.value.layers.map((l) => l.emissive)).toEqual(rig.layers.map((l) => l.emissive));
      }),
    );
    expect(LAYER_KINDS.every((kind) => typeof isEmissive({ kind }) === "boolean")).toBe(true);
  });

  it("rejects a non-boolean emissive at its path", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1, maxLayers: 4 }), fc.nat(), fc.constantFrom<unknown>(null, 0, 1, "true", "false", [], {}), (rig, pick, bad) => {
        const i = pick % rig.layers.length;
        const raw = { ...rig, layers: rig.layers.map((l, j) => (j === i ? { ...l, emissive: bad } : l)) };
        const checked = validateRig(raw);
        expect(checked.ok).toBe(false);
        if (!checked.ok) expect(checked.errors.map((e) => e.path)).toContain(`$.layers[${i}].emissive`);
      }),
    );
  });
});
