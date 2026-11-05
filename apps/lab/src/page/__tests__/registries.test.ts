import { describe, expect, it } from "vitest";
import { createLipDriver } from "../lip/index.js";
import { createSceneDriver } from "../scene/index.js";
import type { LipContext, SceneContext } from "../types.js";

// Unbuilt slots must fail loudly with a sentence (the page reports it to the director as an error).
describe("page arm registries", () => {
  it("lip L1 and L2 are not built", () => {
    for (const id of ["L1", "L2"] as const) {
      expect(() => createLipDriver(id, {} as LipContext)).toThrow(new RegExp(`^Lip arm ${id} is not built yet: it is WP3's .*[.]$`));
    }
  });

  it("scene S1 is not built", () => {
    expect(() => createSceneDriver("S1", {} as SceneContext)).toThrow(/^Scene arm S1 is not built yet: it is WP2's .*[.]$/);
  });
});
