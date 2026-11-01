import { describe, expect, it } from "vitest";
import { applyLook, defaultLook, RIG_ERROR_CODES, RIG_VERSION, resolveGesture, serializeRig, validateRig, type Rig } from "@sr/rig";

describe("@sr/rig", () => {
  it("resolves by its wire-level name and exposes the public surface", () => {
    const rig: Rig = {
      version: RIG_VERSION,
      id: "surface",
      name: "Surface",
      width: 8,
      height: 8,
      source: "replay",
      fictional: true,
      palette: { glow: "#000000", eye: "#ffffff", rim: "#ffffff", mouth: "#000000" },
      layers: [],
    };
    expect(RIG_VERSION).toBe(1);
    expect(RIG_ERROR_CODES).toHaveLength(6);
    expect(validateRig(JSON.parse(serializeRig(rig)))).toEqual({ ok: true, value: rig });
    const look = defaultLook(rig);
    expect(applyLook(rig, look)).toEqual(rig);
    expect(resolveGesture({ ...look, emotion: "delighted" })).toBe("nod");
  });
});
