import { describe, expect, it } from "vitest";
import { LIP_DRIVERS, notBuilt } from "../lip/index.js";
import { createL1 } from "../lip/l1.js";
import { createL2 } from "../lip/l2.js";
import { SCENE_DRIVERS } from "../scene/index.js";
import { createS1 } from "../scene/s1.js";
import type { LipContext } from "../types.js";

// Unbuilt slots must fail loudly with a sentence (the page reports it to the director as an error).
describe("page arm registries", () => {
  it("lip L1 and L2 are built (WP3; lip/mouth/__tests__ drive them), and an unbuilt slot names itself", () => {
    expect(LIP_DRIVERS.L1).toBe(createL1);
    expect(LIP_DRIVERS.L2).toBe(createL2);
    expect(() => notBuilt("L2", "a test slot")({} as LipContext)).toThrow(/^Lip arm L2 is not built yet: it is a test slot[.] /);
  });

  it("scene S1 is built (WP2; s1.test.ts drives it with a canvas mock)", () => {
    expect(SCENE_DRIVERS.S1).toBe(createS1);
  });
});
