// Rig.motion and Look.motion (perfection-pass V1): `spring` in [0, 2]; validateRig reports a bad one
// as `bad_shape` at its path, keeps a good one and serializeRig writes it back; readLook drops a bad
// one and keeps the look.
import { describe, expect, it } from "vitest";
import { defaultLook } from "../look.js";
import { readLook } from "../readLook.js";
import { serializeRig } from "../serialize.js";
import type { Rig } from "../types.js";
import { parseRigJson, validateRig } from "../validate.js";
import { readRigMotion } from "../validateMotion.js";

const RIG: Rig = {
  version: 1,
  id: "m",
  name: "M",
  width: 100,
  height: 100,
  source: "forge",
  palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
  layers: [{ name: "head", z: 0, kind: "head", file: "head.png", bbox: [10, 10, 80, 80], anchor: [50, 80] }],
};

describe("Rig.motion", () => {
  it("keeps a spring in [0, 2] and round-trips it", () => {
    for (const spring of [0, 0.5, 2]) {
      const result = validateRig({ ...RIG, motion: { spring } });
      expect(result.ok && result.value.motion).toEqual({ spring });
      const back = parseRigJson(serializeRig({ ...RIG, motion: { spring } }));
      expect(back.ok && back.value.motion).toEqual({ spring });
    }
    const empty = validateRig({ ...RIG, motion: {} });
    expect(empty.ok && empty.value.motion).toEqual({});
    const none = validateRig(RIG);
    expect(none.ok && "motion" in none.value).toBe(false);
  });

  it("reports a bad one as bad_shape at its path", () => {
    for (const [motion, path] of [[{ spring: 2.5 }, "$.motion.spring"], [{ spring: -0.1 }, "$.motion.spring"], [{ spring: "1" }, "$.motion.spring"], [3, "$.motion"]] as const) {
      const result = validateRig({ ...RIG, motion });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ code: "bad_shape", path }));
    }
    expect(readRigMotion({ spring: Number.NaN }, "$.motion").problems).toHaveLength(1);
  });
});

describe("Look.motion", () => {
  it("readLook keeps a good spring and drops a bad one, never the look", () => {
    const look = defaultLook(RIG);
    expect(readLook({ ...look, motion: { spring: 1.5 } })?.motion).toEqual({ spring: 1.5 });
    const bad = readLook({ ...look, motion: { spring: 7 } });
    expect(bad).toBeDefined();
    expect(bad !== undefined && "motion" in bad).toBe(false);
  });
});
