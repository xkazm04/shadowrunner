// perfection-pass task 7: the history rules, with properties (design "Testing": undo/redo inverse).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canRedo, canUndo, COALESCE_MS, createHistory, push, redo, seal, undo, type History } from "./lookHistory";

/** Distinct values, so a push never repeats the present. */
const steps = fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 40 });

const fromSteps = (values: readonly number[], limit = 100): History<number> =>
  values.reduce((h, v, i) => push(h, v, { at: i * 1000 }), createHistory(0, { limit }));

describe("lookHistory", () => {
  it("undo n times then redo n times is the identity on the present (property)", () => {
    fc.assert(
      fc.property(steps, fc.nat(), (values, k) => {
        const h = fromSteps(values);
        const n = k % (values.length + 1);
        let back = h;
        for (let i = 0; i < n; i += 1) back = undo(back);
        expect(back.present).toBe(n === values.length ? 0 : values[values.length - 1 - n]);
        let forth = back;
        for (let i = 0; i < n; i += 1) forth = redo(forth);
        expect(forth.present).toBe(h.present);
        expect(forth.past).toEqual(h.past);
        expect(forth.future).toEqual([]);
      }),
    );
  });

  it("a push after an undo drops the redo branch (property)", () => {
    fc.assert(
      fc.property(steps, (values) => {
        const h = push(undo(fromSteps(values)), -1, { at: 1e9 });
        expect(canRedo(h)).toBe(false);
        expect(undo(h).present).toBe(values.length > 1 ? values[values.length - 2] : 0);
      }),
    );
  });

  it("keeps at most `limit` steps of past, oldest dropped, and `opened` never moves (property)", () => {
    fc.assert(
      fc.property(steps, fc.integer({ min: 1, max: 10 }), (values, limit) => {
        const h = fromSteps(values, limit);
        expect(h.past.length).toBe(Math.min(values.length, limit));
        expect(h.opened).toBe(0);
        let back = h;
        while (canUndo(back)) back = undo(back);
        expect(back.present).toBe(values.length > limit ? values[values.length - 1 - limit] : 0);
      }),
    );
  });

  it("pushing the present is not a step; undo and redo at the ends change nothing", () => {
    const h = createHistory("a");
    expect(push(h, "a")).toBe(h);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("one group coalesces within COALESCE_MS of its last change; seal or another group or a pause splits", () => {
    let h = createHistory(0);
    h = push(h, 1, { group: "s", at: 0 });
    h = push(h, 2, { group: "s", at: COALESCE_MS });
    h = push(h, 3, { group: "s", at: 2 * COALESCE_MS });
    expect(h.past).toEqual([0]);
    h = push(h, 4, { group: "s", at: 3 * COALESCE_MS + 1 });
    expect(h.past).toEqual([0, 3]);
    h = push(seal(h), 5, { group: "s", at: 3 * COALESCE_MS + 2 });
    expect(h.past).toEqual([0, 3, 4]);
    h = push(h, 6, { group: "t", at: 3 * COALESCE_MS + 3 });
    expect(h.past).toEqual([0, 3, 4, 5]);
    h = push(h, 7, { at: 3 * COALESCE_MS + 4 });
    h = push(h, 8, { at: 3 * COALESCE_MS + 5 });
    expect(h.past).toEqual([0, 3, 4, 5, 6, 7]);
  });

  it("undo ends an open group, so a drag resumed after it is a new step", () => {
    let h = push(push(createHistory(0), 1, { at: 0 }), 2, { group: "s", at: 10 });
    h = undo(h);
    h = push(h, 3, { group: "s", at: 20 });
    expect([h.past, h.present]).toEqual([[0, 1], 3]);
  });
});
