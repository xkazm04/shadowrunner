// Properties of the rite's clock (costume 3.2): progress is bounded and never runs backwards, slots
// only fill forward (waiting -> found -> cut) as the job moves on, a cut part was found first, and
// a finished job has every slot cut.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testJob, testRig } from "../testFixtures";
import { clockText, countsAt, markOf, progressIn, RUN_STEPS, secText, slotsAt, startOf, type RunStep, type SlotState } from "./riteClock";

const STEPS = testJob().steps;
const stepArb = fc.constantFrom(...RUN_STEPS);
const pArb = fc.double({ min: 0, max: 1, noNaN: true });
const msArb = fc.double({ min: 0, max: 600_000, noNaN: true });
const RANK: Record<SlotState, number> = { waiting: 0, found: 1, cut: 2 };

/** A moment as (step rank, progress), ordered. */
const before = (a: [RunStep, number], b: [RunStep, number]): boolean =>
  RUN_STEPS.indexOf(a[0]) < RUN_STEPS.indexOf(b[0]) || (a[0] === b[0] && a[1] <= b[1]);

describe("progressIn", () => {
  it("is within 0..1 and grows with time, on a recording and on live", () => {
    fc.assert(
      fc.property(stepArb, msArb, msArb, fc.boolean(), (status, a, b, recorded) => {
        const steps = recorded ? STEPS : undefined;
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const pl = progressIn(status, lo, steps);
        const ph = progressIn(status, hi, steps);
        expect(pl >= 0 && ph <= 1).toBe(true);
        expect(ph).toBeGreaterThanOrEqual(pl);
      }),
    );
  });

  it("reaches 1 at the recorded hold, and done is always 1", () => {
    expect(progressIn("portrait", 1500, STEPS)).toBe(1);
    expect(progressIn("portrait", 750, STEPS)).toBeCloseTo(0.5);
    expect(progressIn("done", 0)).toBe(1);
    expect(startOf(STEPS, "cutting")).toBe(4500);
  });
});

describe("slots", () => {
  it("only move forward as the job moves on", () => {
    const layers = testRig().layers;
    fc.assert(
      fc.property(stepArb, pArb, stepArb, pArb, (s1, p1, s2, p2) => {
        const [a, b] = before([s1, p1], [s2, p2]) ? [[s1, p1] as const, [s2, p2] as const] : [[s2, p2] as const, [s1, p1] as const];
        const early = slotsAt(layers, a[0], a[1]);
        const late = slotsAt(layers, b[0], b[1]);
        for (const l of layers) expect(RANK[late[l.name] ?? "waiting"]).toBeGreaterThanOrEqual(RANK[early[l.name] ?? "waiting"]);
      }),
    );
  });

  it("never cut more than found, and both bounded by the parts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), stepArb, pArb, (parts, status, p) => {
        const c = countsAt(parts, status, p);
        expect(c.cut).toBeLessThanOrEqual(c.found);
        expect(c.found).toBeLessThanOrEqual(parts);
        expect(c.cut).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("show exactly the counts: cut slots are the cut parts, found-or-cut the found ones", () => {
    const layers = testRig().layers;
    const moving = layers.filter((l) => l.kind !== "static");
    fc.assert(
      fc.property(stepArb, pArb, (status, p) => {
        const slots = slotsAt(layers, status, p);
        const c = countsAt(moving.length, status, p);
        expect(moving.filter((l) => slots[l.name] === "cut")).toHaveLength(c.cut);
        expect(moving.filter((l) => slots[l.name] !== "waiting")).toHaveLength(c.found);
      }),
    );
  });

  it("are all cut when the job is done, and all waiting in the queue", () => {
    const layers = testRig().layers;
    expect(Object.values(slotsAt(layers, "done", 1)).every((s) => s === "cut")).toBe(true);
    expect(Object.values(slotsAt(layers, "queued", 1)).every((s) => s === "waiting")).toBe(true);
    expect(Object.keys(slotsAt(layers, "cutting", 0.5)).sort()).toEqual(layers.map((l) => l.name).sort());
  });
});

describe("marks and text", () => {
  it("follow the forge once a job exists", () => {
    expect(markOf("idle", 1)).toBe(1);
    expect(markOf("running", 0)).toBe(2);
    expect(markOf("done", 0)).toBe(3);
    expect(markOf("failed", 1, "describe")).toBe(0);
    expect(markOf("failed", 1, "forge")).toBe(2);
  });

  it("reads like the tape", () => {
    expect(clockText(3500)).toBe("03.5 s");
    expect(secText(2163)).toBe("2.16 s");
    expect(secText(17302)).toBe("17.3 s");
  });
});
