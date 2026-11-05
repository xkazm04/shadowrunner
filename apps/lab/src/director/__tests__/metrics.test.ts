import { describe, expect, it } from "vitest";
import { BASELINE } from "../../contract.js";
import { computeMetrics, percentile, type RunObservations } from "../metrics.js";

const base: RunObservations = {
  runId: "r",
  config: { ...BASELINE, scenario: "s", seed: 1 },
  durationMs: 12_345,
  turnArrivals: new Map([
    [1, 100],
    [2, 5000],
    [3, 9000],
  ]),
  firstUtterance: new Map([
    [1, "a"],
    [3, "c"],
  ]),
  audioStarts: new Map([
    ["a", 2100],
    ["c", 12000],
  ]),
  fps: [60, 60, 59, 58, 30, 61, 60, 60, 60, 59],
};

describe("metrics", () => {
  it("nearest-rank percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toBe(1);
  });

  it("measures latency per turn that spoke and ttfa on the first turn", () => {
    expect(computeMetrics(base)).toEqual({
      runId: "r",
      config: base.config,
      durationS: 12.3,
      ttfaMs: 2000,
      turnLatencyMs: [2000, 3000],
      fpsP50: 60,
      fpsP5: 30,
    });
  });

  it("omits what was not measured, never writes 0 for it", () => {
    const m = computeMetrics({ ...base, firstUtterance: new Map([[2, "x"]]), fps: [] });
    expect(m).not.toHaveProperty("ttfaMs");
    expect(m).not.toHaveProperty("fpsP50");
    expect(m).not.toHaveProperty("avOffsetMs");
    expect(m).not.toHaveProperty("costUsd");
  });

  it("reports usage, CPU and backend when present", () => {
    const m = computeMetrics({ ...base, usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.0012345678, controlErrors: 1 }, cpuPct: 41.26, renderBackend: "gpu", dropped: 3 });
    expect(m).toMatchObject({ tokensIn: 10, tokensOut: 5, costUsd: 0.001235, controlErrors: 1, cpuPct: 41.3, renderBackend: "gpu", droppedFrames: 3 });
  });
});
