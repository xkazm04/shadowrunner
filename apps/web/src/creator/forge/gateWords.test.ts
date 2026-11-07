// forge-creator S1: a gate reading in plain words. Every reason has its own words, the number is
// written at one decimal at most, the limit follows it, and tries are named only past the first.
import { FACE_GATE_REASONS, gateReading, type FaceGateReason } from "@sr/forge/faceGate";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gateLine, gateWords, num } from "./gateWords";

const LEADS: Readonly<Record<FaceGateReason, string>> = {
  iris: "the eyes moved",
  band: "it repainted outside the brows",
  drift: "the edit drifted",
  no_change: "the edit changed nothing",
  budget: "the daily budget ran out",
  failed: "the edit failed",
};

describe("gateWords", () => {
  it("says the examples the Face tab shows", () => {
    expect(gateWords(gateReading("iris", { irisDriftPx: 7.2, limit: 4 }))).toBe("the eyes moved 7.2 px (limit 4)");
    expect(gateWords({ reason: "drift", drift: 23.4, limit: 20 })).toBe("the edit drifted (23.4, limit 20)");
    expect(gateLine({ reason: "iris", irisDriftPx: 12, limit: 4, attempts: 3 })).toBe("the eyes moved 12 px (limit 4), 3 tries");
    expect(gateLine({ reason: "no_change", attempts: 1 })).toBe("the edit changed nothing");
  });

  it("every reading leads with its reason's words, carries its rounded numbers, and never says NaN or undefined", () => {
    const n = fc.double({ min: 0, max: 10_000, noNaN: true });
    fc.assert(
      fc.property(
        fc.constantFrom(...FACE_GATE_REASONS),
        fc.record({ attempts: fc.integer({ min: 1, max: 99 }), irisDriftPx: n, outsideBandMean: n, drift: n, limit: n }, { requiredKeys: [] }),
        (reason, fields) => {
          const reading = gateReading(reason, fields);
          const line = gateLine(reading);
          expect(line.startsWith(LEADS[reason])).toBe(true);
          expect(line).not.toMatch(/NaN|undefined|null/);
          const own = reason === "iris" ? reading.irisDriftPx : reason === "band" ? reading.outsideBandMean : reason === "drift" ? reading.drift : undefined;
          if (own !== undefined) expect(line).toContain(num(own));
          if (own !== undefined && reading.limit !== undefined) expect(line).toContain(`limit ${num(reading.limit)}`);
          expect(line.includes("tries")).toBe((reading.attempts ?? 0) > 1);
        },
      ),
    );
  });

  it("num writes one decimal at most", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10_000, noNaN: true }), (v) => {
        expect(num(v)).toMatch(/^\d+(\.\d)?$/);
      }),
    );
  });
});
