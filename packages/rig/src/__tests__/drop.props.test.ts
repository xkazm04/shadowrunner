// Layer.drop (cast-forge task 3): a jaw layer's own travel. Properties over arbitrary valid rigs whose
// jaw layers carry an in-range drop (or none): jawOpen moves each jaw by exactly its own drop (the
// default JAW_DROP when absent) times rig height times the change in jawOpen, along its turned down
// axis; nothing else moves. validateRig accepts every in-range drop on a jaw and serializeRig
// round-trips it; it rejects a drop out of range or on a layer that is not a jaw, at the drop's path.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JAW_DROP, JAW_DROP_MAX, JAW_DROP_MIN, poseLayers, type Drive } from "../pose.js";
import { serializeRig } from "../serialize.js";
import type { Layer, Rig } from "../types.js";
import { parseRigJson, validateRig } from "../validate.js";
import { nth, rigArb } from "./arb.js";

const between = (min: number, max: number): fc.Arbitrary<number> => fc.integer({ min: 0, max: 10_000 }).map((i) => min + ((max - min) * i) / 10_000);
const arbDrop = fc.option(between(JAW_DROP_MIN, JAW_DROP_MAX), { nil: undefined });

/** A valid rig with at least one jaw layer; every jaw layer may carry its own drop. */
const arbDropRig: fc.Arbitrary<Rig> = rigArb({ minLayers: 1, maxLayers: 6 }).chain((rig) =>
  fc.tuple(fc.nat(), fc.array(arbDrop, { minLength: rig.layers.length, maxLength: rig.layers.length })).map(([pick, drops]) => {
    const forced = pick % rig.layers.length;
    const layers = rig.layers.map((l, i): Layer => {
      const kind = i === forced ? "jaw" : l.kind;
      const drop = drops[i];
      return { ...l, kind, ...(kind === "jaw" && drop !== undefined ? { drop } : {}) };
    });
    return { ...rig, layers };
  }),
);

const arbDrive: fc.Arbitrary<Drive> = fc.record({ t: between(0, 100), headYaw: between(-30, 30), headPitch: between(-20, 20), jawOpen: between(-0.5, 1.5), blink: between(0, 1) });
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

describe("Layer.drop", () => {
  it("jawOpen moves each jaw by its own drop (JAW_DROP when absent) along its down axis, and nothing else", () => {
    fc.assert(
      fc.property(arbDropRig, arbDrive, between(-0.5, 1.5), (rig, drive, jaw2) => {
        expect(validateRig(rig).ok).toBe(true);
        const look = { palette: rig.palette, hidden: [], emotion: "neutral" as const };
        const before = new Map(poseLayers(rig, look, drive).map((p) => [p.name, p]));
        const after = new Map(poseLayers(rig, look, { ...drive, jawOpen: jaw2 }).map((p) => [p.name, p]));
        for (const layer of rig.layers) {
          const p = before.get(layer.name);
          const q = after.get(layer.name);
          if (p === undefined || q === undefined) continue;
          if (layer.kind !== "jaw") {
            expect(q).toEqual(p);
            continue;
          }
          const travel = (clamp01(jaw2) - clamp01(drive.jawOpen)) * (layer.drop ?? JAW_DROP) * rig.height;
          const tol = 1e-9 * Math.max(1, rig.height);
          expect(Math.abs(q.x - p.x - -Math.sin(p.rotation) * travel), `${layer.name} dx`).toBeLessThanOrEqual(tol);
          expect(Math.abs(q.y - p.y - Math.cos(p.rotation) * travel), `${layer.name} dy`).toBeLessThanOrEqual(tol);
        }
      }),
    );
  });

  it("validateRig accepts every in-range drop on a jaw, and serializeRig round-trips it", () => {
    fc.assert(
      fc.property(arbDropRig, (rig) => {
        const checked = validateRig(rig);
        expect(checked.ok).toBe(true);
        const back = parseRigJson(serializeRig(rig));
        expect(back.ok && back.value.layers.map((l) => l.drop)).toEqual(rig.layers.map((l) => l.drop));
      }),
    );
  });

  it("rejects a drop out of range, of the wrong type, or on a layer that is not a jaw, at its path", () => {
    const bad: unknown[] = [JAW_DROP_MIN - 0.001, JAW_DROP_MAX + 0.001, -1, Number.NaN, "0.02", null];
    fc.assert(
      fc.property(arbDropRig, fc.nat(), fc.constantFrom(...bad), fc.boolean(), (rig, pick, value, offJaw) => {
        const i = pick % rig.layers.length;
        const target = nth(rig.layers, i);
        const layers = rig.layers.map((l, j) => (j !== i ? l : offJaw ? { ...l, kind: target.kind === "jaw" ? "eye" : target.kind, drop: 0.02 } : { ...l, kind: "jaw", drop: value }));
        const result = validateRig({ ...rig, layers });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.map((e) => e.path)).toContain(`$.layers[${i}].drop`);
      }),
    );
  });
});
