import { describe, expect, it } from "vitest";
import { PACKAGE } from "@sr/avatar";

describe("@sr/avatar", () => {
  it("resolves by its wire-level name to the TypeScript source", () => {
    expect(PACKAGE).toBe("@sr/avatar");
  });
});
