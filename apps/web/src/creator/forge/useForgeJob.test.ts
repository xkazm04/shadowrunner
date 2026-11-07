import { describe, expect, it } from "vitest";
import { testBriefs } from "../testFixtures";
import { JOB_KEY, pollDelay, POLL_MS, readStoredJob, SLOW_POLL_MS } from "./useForgeJob";

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("polling cadence", () => {
  it("polls every 1.5 s, then every 5 s after the first minute", () => {
    expect(pollDelay(0)).toBe(POLL_MS);
    expect(pollDelay(59_999)).toBe(POLL_MS);
    expect(pollDelay(60_000)).toBe(SLOW_POLL_MS);
  });
});

describe("readStoredJob", () => {
  it("reads a stored job and refuses anything else", () => {
    const job = { jobId: "j", startedAt: 5, request: { mode: "prompt", prompt: "a lantern for a head" } };
    expect(readStoredJob(memoryStorage({ [JOB_KEY]: JSON.stringify(job) }))).toEqual(job);
    expect(readStoredJob(memoryStorage({ [JOB_KEY]: "{not json" }))).toBeUndefined();
    expect(readStoredJob(memoryStorage({ [JOB_KEY]: JSON.stringify({ ...job, request: { mode: "video" } }) }))).toBeUndefined();
    expect(readStoredJob(memoryStorage())).toBeUndefined();
    expect(readStoredJob(undefined)).toBeUndefined();
  });
});

describe("readStoredJob, forge-creator L2", () => {
  it("keeps a cast job's candidate, so its retry casts again instead of painting a new portrait", () => {
    const job = { jobId: "j", startedAt: 5, request: { mode: "brief", brief: testBriefs()[0], candidate: { batchId: "b".repeat(32), index: 2 } } };
    expect(readStoredJob(memoryStorage({ [JOB_KEY]: JSON.stringify(job) }))).toEqual(job);
  });
});
