// Lives under an underscore folder so Vercel does not deploy it as a function.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { engineState, plane } from "../_lib/plane.js";

/** "live" in any letter case, padded with any whitespace. */
const liveSpelling = fc
  .tuple(
    fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    fc.constantFrom("", " ", "\t", "\n", "  "),
    fc.constantFrom("", " ", "\t", "\n", "  "),
  )
  .map(([upper, before, after]) => {
    const word = [..."live"].map((ch, i) => (upper[i] ? ch.toUpperCase() : ch)).join("");
    return `${before}${word}${after}`;
  });

const notLive = fc.string().filter((s) => s.trim().toLowerCase() !== "live");

describe("plane", () => {
  it("defaults to replay when SR_PLANE is unset", () => {
    expect(plane({})).toBe("replay");
  });

  it("is live for any spelling of live", () => {
    fc.assert(fc.property(liveSpelling, (value) => plane({ SR_PLANE: value }) === "live"));
  });

  it("is replay for every other value, so a typo never turns on paid calls", () => {
    fc.assert(fc.property(notLive, (value) => plane({ SR_PLANE: value }) === "replay"));
  });
});

describe("engineState", () => {
  // Whitespace-only keys are drawn on purpose: fc.string() alone almost never produces them.
  const anyKey = fc.option(fc.oneof(fc.string(), fc.constantFrom("", " ", "\t", " \n ")), { nil: undefined });

  it("is scripted on replay whether or not a key is present", () => {
    fc.assert(fc.property(anyKey, (key) => engineState("replay", { ANTHROPIC_API_KEY: key }) === "scripted"));
  });

  it("is anthropic on live with a key, offline without one", () => {
    fc.assert(
      fc.property(anyKey, (key) => {
        const expected = key !== undefined && key.trim() !== "" ? "anthropic" : "offline";
        return engineState("live", { ANTHROPIC_API_KEY: key }) === expected;
      }),
    );
  });
});
