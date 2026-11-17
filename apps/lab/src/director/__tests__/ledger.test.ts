import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axisOf as boardAxisOf } from "../../board/board.js";
import type { RunConfig } from "../../contract.js";
import { axisOf } from "../config.js";
import { compareMetrics, listRuns, referenceRun, type LedgerRun, type MetricValues } from "../ledger.js";
import { formatVerdict } from "../ledgerFormat.js";

const base: RunConfig = { control: "C0", lip: "L0", scene: "S0", output: "O0", scenario: "haunt-01", seed: 7 };

function run(runId: string, config: RunConfig, metrics: MetricValues = { ttfaMs: 1000 }): LedgerRun {
  return { runId, dir: runId, status: "complete", config, metrics };
}

describe("compareMetrics", () => {
  it("signs each delta by the metric's direction", () => {
    const rows = compareMetrics({ ttfaMs: 1800, fpsP50: 58, controlErrors: 2 }, { ttfaMs: 1200, fpsP50: 60, controlErrors: 0 });
    expect(rows).toEqual([
      { key: "ttfaMs", a: 1800, b: 1200, delta: -600, verdict: "better" },
      { key: "fpsP50", a: 58, b: 60, delta: 2, verdict: "better" },
      { key: "controlErrors", a: 2, b: 0, delta: -2, verdict: "better" },
    ]);
  });

  it("calls a key only one run measured 'unmeasured', never a 0 delta", () => {
    const rows = compareMetrics({ ttfaMs: 900 }, { ttfaMs: 900, avOffsetMs: 40 });
    expect(rows).toEqual([
      { key: "ttfaMs", a: 900, b: 900, delta: 0, verdict: "same" },
      { key: "avOffsetMs", b: 40, verdict: "unmeasured" },
    ]);
    expect(formatVerdict(run("p", base, { ttfaMs: 900 }), run("c", base, { ttfaMs: 900, avOffsetMs: 40 }))).toContain("avOffsetMs - -> 40 unmeasured");
  });

  it("compares turn latency on its p50", () => {
    expect(compareMetrics({ turnLatencyMs: [900, 1500, 1100] }, { turnLatencyMs: [700, 800] })).toEqual([
      { key: "turnLatencyMs", a: 1100, b: 700, delta: -400, verdict: "better" },
    ]);
  });

  it("judges A/V offset by its size, not its sign", () => {
    expect(compareMetrics({ avOffsetMs: 60 }, { avOffsetMs: -20 })[0]).toMatchObject({ verdict: "better" });
  });

  it("is antisymmetric: swapping the runs negates every delta and flips better/worse", () => {
    const value = fc.option(fc.integer({ min: -5000, max: 5000 }), { nil: undefined });
    const metrics = fc.record({ ttfaMs: value, fpsP50: value, droppedFrames: value, avOffsetMs: value, costUsd: value });
    const clean = (m: Record<string, number | undefined>): MetricValues =>
      Object.fromEntries(Object.entries(m).filter((e): e is [string, number] => e[1] !== undefined));
    fc.assert(
      fc.property(metrics, metrics, (x, y) => {
        const ab = compareMetrics(clean(x), clean(y));
        const ba = compareMetrics(clean(y), clean(x));
        const flip = { better: "worse", worse: "better", same: "same", unmeasured: "unmeasured" } as const;
        expect(ba.map((r) => r.verdict)).toEqual(ab.map((r) => flip[r.verdict]));
        expect(ba.map((r) => (r.delta === undefined ? undefined : -r.delta + 0))).toEqual(ab.map((r) => (r.delta === undefined ? undefined : r.delta + 0)));
      }),
    );
  });
});

describe("referenceRun", () => {
  const current = run("20261117-120000-haunt-01-C0L1S0O0-s7", { ...base, lip: "L1" });

  it("picks the newest non-replay peer one axis away, or on the baseline", () => {
    const ledger = [
      current,
      run("20261117-110000-haunt-01-replay-s7", { ...base, replayOf: "x" }),
      run("20261117-100000-haunt-01-C1L2S0O0-s7", { ...base, control: "C1", lip: "L2" }),
      run("20261117-090000-haunt-01-C0L2S0O0-s7", { ...base, lip: "L2" }),
      run("20261117-080000-haunt-01-C0L0S0O0-s7", base),
    ];
    expect(referenceRun(ledger, current)?.runId).toBe("20261117-090000-haunt-01-C0L2S0O0-s7");
    const twoAway = run("20261117-130000-haunt-01-C1L1S1O0-s7", { ...base, control: "C1", lip: "L1", scene: "S1" });
    expect(referenceRun([twoAway, ...ledger], twoAway)?.runId).toBe("20261117-080000-haunt-01-C0L0S0O0-s7");
  });

  it("returns undefined across scenarios or seeds, and the report says so", () => {
    const ledger = [current, run("20261117-080000-haunt-01-C0L0S0O0-s3", { ...base, seed: 3 }), run("20261117-070000-face-01-C0L0S0O0-s7", { ...base, scenario: "face-01" })];
    expect(referenceRun(ledger, current)).toBeUndefined();
    expect(formatVerdict(undefined, current)).toBe("no comparable run (scenario haunt-01, seed 7)");
  });
});

describe("listRuns", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lab-ledger-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function folder(runId: string, config: RunConfig, metrics?: object): void {
    mkdirSync(join(root, runId), { recursive: true });
    writeFileSync(join(root, runId, "config.json"), JSON.stringify(config));
    if (metrics !== undefined) writeFileSync(join(root, runId, "metrics.json"), JSON.stringify({ runId, config, durationS: 1, ...metrics }));
  }

  it("lists every folder newest first, flags a crashed run, never throws", () => {
    folder("20261117-080000-haunt-01-C0L0S0O0-s7", base, { ttfaMs: 1200 });
    folder("20261117-100000-haunt-01-C0L1S0O0-s7", { ...base, lip: "L1" });
    folder("20261117-090000-face-01-C0L0S0O0-s7", { ...base, scenario: "face-01" }, { fpsP50: 60 });
    const rows = listRuns(root);
    expect(rows.map((r) => [r.runId, r.status])).toEqual([
      ["20261117-100000-haunt-01-C0L1S0O0-s7", "incomplete"],
      ["20261117-090000-face-01-C0L0S0O0-s7", "complete"],
      ["20261117-080000-haunt-01-C0L0S0O0-s7", "complete"],
    ]);
    expect(rows[2]?.metrics).toEqual({ ttfaMs: 1200 });
    expect(listRuns(root, { scenario: "haunt-01" }).map((r) => r.runId)).toEqual(["20261117-100000-haunt-01-C0L1S0O0-s7", "20261117-080000-haunt-01-C0L0S0O0-s7"]);
  });

  it("an unreadable config or a missing root is a row or nothing, not an error", () => {
    mkdirSync(join(root, "broken"));
    writeFileSync(join(root, "broken", "config.json"), "{not json");
    expect(listRuns(root).map((r) => r.status)).toEqual(["incomplete"]);
    expect(listRuns(join(root, "nope"))).toEqual([]);
  });
});

describe("axisOf", () => {
  it("is one rule: the board uses the director's", () => {
    expect(boardAxisOf).toBe(axisOf);
    expect(axisOf(base, { ...base, lip: "L1" })).toBe("lip");
  });
});
