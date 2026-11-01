import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENGINE_STATES, parseHealth, PLANES, type Health } from "@sr/engine";

const healthArb: fc.Arbitrary<Health> = fc.record({
  plane: fc.constantFrom(...PLANES),
  engine: fc.constantFrom(...ENGINE_STATES),
  version: fc.string(),
});

describe("parseHealth", () => {
  it("accepts every well-formed body and keeps only the three fields", () => {
    fc.assert(
      fc.property(healthArb, fc.dictionary(fc.string(), fc.jsonValue()), (health, extra) => {
        expect(parseHealth({ ...extra, ...health })).toEqual(health);
      }),
    );
  });

  it("rejects a body with any field missing or of the wrong kind", () => {
    const field = fc.constantFrom("plane", "engine", "version");
    const bad = fc.oneof(fc.constant(undefined), fc.integer(), fc.constant("unknown"), fc.constant(null));
    fc.assert(
      fc.property(healthArb, field, bad, (health, key, value) => {
        if (key === "version" && typeof value === "string") return;
        expect(parseHealth({ ...health, [key]: value })).toBeUndefined();
      }),
    );
    for (const body of [null, "ok", 3, [], { ok: true }]) expect(parseHealth(body)).toBeUndefined();
  });

  it("rejects a plane or engine outside the contract", () => {
    expect(parseHealth({ plane: "staging", engine: "scripted", version: "x" })).toBeUndefined();
    expect(parseHealth({ plane: "replay", engine: "gpt", version: "x" })).toBeUndefined();
  });
});
