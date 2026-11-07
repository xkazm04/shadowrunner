// forge-creator S1: the face-gate reading. `readFaceGate` is the one reader (job parser, client
// view, library record): on-contract readings survive with their numbers at one decimal, malformed
// entries are dropped (never the record), and the whole note stays tiny.
import { EXPRESSION_FAMILIES } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FACE_GATE_REASONS, GATE_ATTEMPTS_MAX, GATE_NUMBER_MAX, gateReading, readFaceGate, readGateReading, round1, type FaceGate, type FaceGateReading } from "./faceGate.js";
import { toJobView } from "./job.js";
import { parseForgeJob } from "./validate.js";

const num = fc.double({ min: 0, max: GATE_NUMBER_MAX, noNaN: true });
const reading: fc.Arbitrary<FaceGateReading> = fc
  .record(
    {
      reason: fc.constantFrom(...FACE_GATE_REASONS),
      attempts: fc.integer({ min: 1, max: GATE_ATTEMPTS_MAX }),
      irisDriftPx: num,
      outsideBandMean: num,
      drift: num,
      limit: num,
    },
    { requiredKeys: ["reason"] },
  )
  .map(({ reason, ...rest }) => gateReading(reason, rest));
const gate: fc.Arbitrary<FaceGate> = fc.dictionary(fc.constantFrom(...EXPRESSION_FAMILIES), reading, { minKeys: 1 });
/** Off-contract values a reading's field might hold. */
const junk = fc.oneof(fc.constant(null), fc.constant(-1), fc.constant(Number.NaN), fc.constant(Infinity), fc.constant(GATE_NUMBER_MAX + 1), fc.string(), fc.boolean(), fc.constant([]));

const decimals = (n: number): boolean => Math.abs(n * 10 - Math.round(n * 10)) < 1e-6;

describe("readFaceGate", () => {
  it("keeps every on-contract reading as it was written, numbers at one decimal", () => {
    fc.assert(
      fc.property(gate, (g) => {
        const read = readFaceGate(JSON.parse(JSON.stringify(g)));
        expect(read).toEqual(g);
        for (const r of Object.values(read ?? {})) for (const k of ["irisDriftPx", "outsideBandMean", "drift", "limit"] as const) if (r[k] !== undefined) expect(decimals(r[k])).toBe(true);
      }),
    );
  });

  it("never throws, is idempotent, and drops malformed entries without losing the good ones", () => {
    fc.assert(
      fc.property(gate, fc.constantFrom(...EXPRESSION_FAMILIES), fc.constantFrom("reason", "attempts", "irisDriftPx", "outsideBandMean", "drift", "limit"), junk, fc.anything(), (g, family, field, bad, any) => {
        expect(readFaceGate(readFaceGate(any))).toEqual(readFaceGate(any));
        const spoiled: Record<string, unknown> = { ...g, [family]: { ...(g[family] ?? { reason: "iris" }), [field]: bad }, mood: { reason: "iris" } };
        const read = readFaceGate(spoiled) ?? {};
        expect(family in read).toBe(false);
        expect("mood" in read).toBe(false);
        for (const f of EXPRESSION_FAMILIES) if (f !== family) expect(read[f]).toEqual(g[f]);
      }),
    );
  });

  it("is undefined for anything with no readable entry", () => {
    for (const v of [undefined, null, 3, "x", [], {}, { joy: null }, { joy: { reason: "cosmic" } }, { mood: { reason: "iris" } }]) expect(readFaceGate(v), JSON.stringify(v)).toBeUndefined();
  });

  it("stays tiny: six full readings serialise under 1 KB", () => {
    fc.assert(fc.property(fc.tuple(...EXPRESSION_FAMILIES.map(() => reading)), (rs) => {
      const g: FaceGate = Object.fromEntries(EXPRESSION_FAMILIES.map((f, i) => [f, rs[i]]));
      expect(JSON.stringify(g).length).toBeLessThan(1024);
    }));
  });

  it("gateReading rounds, drops non-finite numbers and attempts outside 1..max", () => {
    expect(gateReading("iris", { irisDriftPx: 7.2349, limit: 4, attempts: 3 })).toEqual({ reason: "iris", irisDriftPx: 7.2, limit: 4, attempts: 3 });
    expect(gateReading("band", { outsideBandMean: Number.NaN, attempts: 0 })).toEqual({ reason: "band" });
    expect(round1(-0.01)).toBe(0);
    expect(Object.is(round1(-0.01), -0)).toBe(false);
    expect(readGateReading({ reason: "budget", extra: 1 })).toEqual({ reason: "budget" });
  });
});

describe("the job record and the view", () => {
  const base = { jobId: "j", plane: "live", mode: "prompt", status: "done", createdAt: 1, expressions: { joy: "skipped" } };

  it("parseForgeJob keeps a gate, drops malformed readings and never refuses the job for them; toJobView forwards it", () => {
    fc.assert(
      fc.property(gate, (g) => {
        const job = parseForgeJob(JSON.stringify({ ...base, expressionGate: { ...g, mood: 1 } }));
        expect(job?.expressionGate).toEqual(g);
        if (job !== undefined) expect(toJobView(job).expressionGate).toEqual(g);
      }),
    );
    const bad = parseForgeJob(JSON.stringify({ ...base, expressionGate: { joy: { reason: "iris", irisDriftPx: "7" } } }));
    expect(bad).toBeDefined();
    expect(bad !== undefined && "expressionGate" in bad).toBe(false);
    const none = parseForgeJob(JSON.stringify(base));
    expect(none !== undefined && "expressionGate" in toJobView(none)).toBe(false);
  });
});
