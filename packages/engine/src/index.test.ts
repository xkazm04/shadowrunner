import { describe, expect, it } from "vitest";
import { PACKAGE } from "@sr/engine";

describe("@sr/engine", () => {
  it("resolves by its wire-level name to the TypeScript source", () => {
    expect(PACKAGE).toBe("@sr/engine");
  });
});
