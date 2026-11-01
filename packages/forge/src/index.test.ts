import { describe, expect, it } from "vitest";
import { PACKAGE } from "@sr/forge";

describe("@sr/forge", () => {
  it("resolves by its wire-level name to the TypeScript source", () => {
    expect(PACKAGE).toBe("@sr/forge");
  });
});
