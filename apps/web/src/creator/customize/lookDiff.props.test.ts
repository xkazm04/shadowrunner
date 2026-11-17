// rig/B (challenge-2026-11-17): Compare's change list over the looks the editor really makes. Any
// sequence of LookActions from the opened look gives a look whose changes (lookChanges) each revert
// alone through the reducer's "revert" action, and reverting them all is the look as opened.
import { defaultLook, EXPRESSION_FAMILIES, FACE_FIELDS, lookChanges, sameLook, type Emotion, type Palette } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { lookReducer, type LookAction } from "./lookReducer";

const rig = testRig();
const EMOTIONS: Emotion[] = ["neutral", "amused", "smug", "irritated", "furious", "delighted", "bored", "suspicious", "grim", "theatrical"];
const KEYS: (keyof Palette)[] = ["glow", "eye", "rim", "mouth"];
const LAYERS = rig.layers.map((l) => l.name);
const hexArb = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`);

const actionArb: fc.Arbitrary<LookAction> = fc.oneof(
  fc.record({ type: fc.constant("palette" as const), key: fc.constantFrom(...KEYS), value: fc.oneof(hexArb, fc.constantFrom(...Object.values(rig.palette))) }),
  fc.record({ type: fc.constant("toggle" as const), layer: fc.constantFrom(...LAYERS) }),
  fc.record({ type: fc.constant("emotion" as const), emotion: fc.constantFrom(...EMOTIONS) }),
  fc.constant({ type: "reset" as const, rig }),
  fc.record({ type: fc.constant("region" as const), key: fc.constantFrom("head/s1", "head/s2", "crown/s1"), value: fc.option(hexArb, { nil: null }) }),
  fc.record({ type: fc.constant("shape" as const), layer: fc.constantFrom(...LAYERS), value: fc.record({ size: fc.constantFrom(1, 1.2, 0.8), rot: fc.constantFrom(0, 10) }, { requiredKeys: [] }) }),
  fc.record({ type: fc.constant("shapeReset" as const), layer: fc.constantFrom(...LAYERS) }),
  fc.record({ type: fc.constant("face" as const), field: fc.constantFrom(...FACE_FIELDS), value: fc.constantFrom(0, 0.3, 0.6, 1, 1.5), rig: fc.constant(rig) }),
  fc.constant({ type: "faceReset" as const }),
  fc.record({ type: fc.constant("retire" as const), family: fc.constantFrom(...EXPRESSION_FAMILIES), retired: fc.boolean() }),
);

describe("the reducer's revert, over random edits from the opened look", () => {
  const opened = defaultLook(rig);

  it("reverting one change leaves exactly the others", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 12 }), (actions) => {
        const now = actions.reduce(lookReducer, opened);
        const changes = lookChanges(rig, opened, now);
        changes.forEach((change, i) => {
          const reverted = lookReducer(now, { type: "revert", from: opened, change });
          expect(lookChanges(rig, opened, reverted)).toEqual(changes.filter((_, j) => j !== i));
        });
      }),
    );
  });

  it("reverting every change in turn is the look as opened", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 12 }), (actions) => {
        const now = actions.reduce(lookReducer, opened);
        const back = lookChanges(rig, opened, now).reduce((look, change) => lookReducer(look, { type: "revert", from: opened, change }), now);
        expect(sameLook(back, opened)).toBe(true);
      }),
    );
  });
});
