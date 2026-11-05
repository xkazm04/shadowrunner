import { describe, expect, it } from "vitest";
import { createControlArm, type ControlContext } from "../arms/control/index.js";
import { createOutputArm, type OutputContext } from "../output/index.js";

// Unbuilt slots must fail loudly with a sentence (never fall back to another arm).
// The page registries (lip, scene) are tested in page/__tests__/registries.test.ts.
describe("director arm registries", () => {
  it("control C1 and C2 are not built", () => {
    for (const id of ["C1", "C2"] as const) {
      expect(() => createControlArm(id, {} as ControlContext)).toThrow(new RegExp(`^Control arm ${id} is not built yet: it is WP2's .*[.]$`));
    }
  });

  it("output O1 is not built", () => {
    expect(() => createOutputArm("O1", {} as OutputContext)).toThrow(/^Output arm O1 is not built yet: it is WP4's .*[.]$/);
  });
});
