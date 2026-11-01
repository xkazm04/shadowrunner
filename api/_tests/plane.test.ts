// Lives under an underscore folder so Vercel does not deploy it as a function.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PLANE_HEADER } from "@sr/engine";
import { engineState, plane, planeFromRequest } from "../_lib/plane.js";

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

describe("planeFromRequest", () => {
  // A raw header bag rather than `Headers`, so values reach planeFromRequest unnormalised.
  const request = (header: string | undefined) => ({
    headers: { get: (name: string) => (name.toLowerCase() === PLANE_HEADER ? (header ?? null) : null) },
  });
  const replaySpelling = fc
    .tuple(fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }), fc.constantFrom("", " ", "\t"), fc.constantFrom("", " ", "\t"))
    .map(([upper, before, after]) => `${before}${[..."replay"].map((ch, i) => (upper[i] ? ch.toUpperCase() : ch)).join("")}${after}`);
  // Draws "live" spellings on purpose: fc.string() alone would almost never try to force live.
  const anyHeader = fc.option(fc.oneof(fc.string(), liveSpelling, replaySpelling), { nil: undefined });
  const anyEnvPlane = fc.option(fc.oneof(fc.string(), liveSpelling), { nil: undefined });

  it("never serves live unless SR_PLANE is live: the header can only force replay", () => {
    fc.assert(
      fc.property(anyHeader, anyEnvPlane, (header, srPlane) => {
        const env = { SR_PLANE: srPlane };
        const served = planeFromRequest(request(header), env);
        if (served === "live") expect(plane(env)).toBe("live");
        return served === "replay" || plane(env) === "live";
      }),
    );
  });

  it("serves replay on a live deploy for any spelling of x-sr-plane: replay", () => {
    fc.assert(fc.property(replaySpelling, (header) => planeFromRequest(request(header), { SR_PLANE: "live" }) === "replay"));
    expect(planeFromRequest(request("live, replay"), { SR_PLANE: "live" })).toBe("replay");
  });

  it("follows SR_PLANE when the header is absent or is anything but replay", () => {
    const notReplay = fc.option(fc.oneof(fc.string(), liveSpelling), { nil: undefined }).filter(
      (h) => h === undefined || !h.split(",").some((v) => v.trim().toLowerCase() === "replay"),
    );
    fc.assert(
      fc.property(notReplay, anyEnvPlane, (header, srPlane) => {
        const env = { SR_PLANE: srPlane };
        return planeFromRequest(request(header), env) === plane(env);
      }),
    );
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
