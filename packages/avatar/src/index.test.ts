import { describe, expect, it } from "vitest";
import { initialState, PACKAGE, step, toDrive } from "@sr/avatar";
import { initialState as ownInitialState } from "./driver/state.js";
import { step as ownStep } from "./driver/step.js";
import { toDrive as ownToDrive } from "./driver/drive.js";

describe("@sr/avatar", () => {
  it("resolves by its wire-level name to the TypeScript source", () => {
    expect(PACKAGE).toBe("@sr/avatar");
  });

  it("re-exports the driver (state, step, toDrive)", () => {
    expect(initialState).toBe(ownInitialState);
    expect(step).toBe(ownStep);
    expect(toDrive).toBe(ownToDrive);
  });
});
