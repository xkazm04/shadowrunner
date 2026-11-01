import { describe, expect, it } from "vitest";
import { PACKAGE } from "@sr/rig";

describe("@sr/rig", () => {
  it("resolves by its wire-level name to the TypeScript source", () => {
    expect(PACKAGE).toBe("@sr/rig");
  });
});
