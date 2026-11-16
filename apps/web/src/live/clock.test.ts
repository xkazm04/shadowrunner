import { describe, expect, it } from "vitest";
import { audioStart, insertByPts, pickFrame, StreamClock } from "./clock";

describe("StreamClock", () => {
  it("plays each pts at its offset from the first pts, plus the delay", () => {
    const clock = new StreamClock(250);
    expect(clock.observe(4000, 10)).toBe(true);
    expect(clock.playAt(4000)).toBeCloseTo(10.25);
    expect(clock.playAt(4040)).toBeCloseTo(10.29);
    expect(clock.streamMs(10.25)).toBeCloseTo(4000);
    expect(clock.streamMs(11.25)).toBeCloseTo(5000);
    expect(clock.observe(4040, 10.04)).toBe(false);
  });

  it("re-anchors when the stream restarts or skips far ahead", () => {
    const clock = new StreamClock(250);
    clock.observe(60_000, 0);
    expect(clock.observe(0, 1)).toBe(true);
    expect(clock.playAt(0)).toBeCloseTo(1.25);
    expect(clock.observe(30_000, 2)).toBe(true);
    expect(clock.playAt(30_000)).toBeCloseTo(2.25);
  });

  it("keeps the playhead across a clock switch", () => {
    const clock = new StreamClock(250);
    clock.observe(0, 100); // wall clock
    const before = clock.streamMs(101);
    clock.rebase(101, 3); // the audio clock reads 3 at the same instant
    expect(clock.streamMs(3)).toBeCloseTo(before);
  });
});

describe("pickFrame", () => {
  const q = [{ pts: 0 }, { pts: 40 }, { pts: 80 }, { pts: 120 }];
  it("shows the newest due frame, releases the ones before it, keeps the rest", () => {
    expect(pickFrame(q, 90)).toEqual({ show: { pts: 80 }, stale: [{ pts: 0 }, { pts: 40 }], rest: [{ pts: 120 }] });
    expect(pickFrame(q, -1)).toEqual({ show: undefined, stale: [], rest: q });
    expect(pickFrame([], 100).show).toBeUndefined();
  });

  it("inserts out-of-order frames by pts", () => {
    const queue = [{ pts: 0 }, { pts: 80 }];
    insertByPts(queue, { pts: 40 });
    insertByPts(queue, { pts: 120 });
    expect(queue.map((f) => f.pts)).toEqual([0, 40, 80, 120]);
  });
});

describe("audioStart", () => {
  it("starts on time, or now with the late part skipped, or not at all", () => {
    expect(audioStart(5, 4, 1)).toEqual({ at: 5, offset: 0 });
    const late = audioStart(4, 4.25, 1);
    expect(late?.at).toBe(4.25);
    expect(late?.offset).toBeCloseTo(0.25);
    expect(audioStart(2, 4, 1)).toBeUndefined();
  });
});
