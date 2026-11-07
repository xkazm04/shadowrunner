// castState.ts (forge-creator L2): the casting sheet's state machine, as properties over random
// event sequences: views of other batches never land, a batch's status never moves back, "ready"
// only comes from a ready view of the current batch, re-rolls stop at zero, and a failure keeps the
// sheet that was on show.
import fc from "fast-check";
import type { CastStatus, CastView, CharacterBrief } from "@sr/forge/wire";
import { describe, expect, it } from "vitest";
import { testBriefs } from "../testFixtures";
import { CAST_IDLE, castReducer, rerollFrom, sheetOf, type CastEvent, type CastState } from "./castState";

const first = testBriefs()[0];
if (first === undefined) throw new Error("no test brief");
const BRIEF: CharacterBrief = first;
const STATUSES: CastStatus[] = ["drafting", "segmenting", "cutting", "ready", "failed"];
const IDS = ["b1", "b2", "b3"];

const view = (batchId: string, status: CastStatus, rerollsLeft: number): CastView => ({ batchId, status, plane: "replay", rerollsLeft, candidates: [] });

// Views weigh most, mostly of one batch, so long runs of one batch's views (forward and back) occur.
const event: fc.Arbitrary<CastEvent> = fc.oneof(
  { arbitrary: fc.constant<CastEvent>({ type: "start", brief: BRIEF }), weight: 1 },
  { arbitrary: fc.constant<CastEvent>({ type: "reroll" }), weight: 1 },
  { arbitrary: fc.constant<CastEvent>({ type: "back" }), weight: 1 },
  { arbitrary: fc.constantFrom(...IDS).map((batchId): CastEvent => ({ type: "batch", batchId })), weight: 2 },
  {
    arbitrary: fc.tuple(fc.constantFrom("b1", "b1", "b1", ...IDS), fc.constantFrom(...STATUSES, "drafting", "segmenting", "cutting"), fc.integer({ min: 0, max: 2 })).map(([id, s, r]): CastEvent => ({ type: "view", view: view(id, s, r) })),
    weight: 10,
  },
  { arbitrary: fc.constant<CastEvent>({ type: "fail", code: "upstream", message: "x" }), weight: 1 },
);

const rank = (s: CastStatus) => STATUSES.indexOf(s);

describe("castReducer", () => {
  it("only the current batch's views land, statuses never move back, ready only from a ready view (property)", () => {
    fc.assert(
      fc.property(fc.array(event, { minLength: 20, maxLength: 80 }), (events) => {
        let state: CastState = CAST_IDLE;
        for (const e of events) {
          const next = castReducer(state, e);
          if (e.type === "view") {
            const current = state.phase === "casting" ? state.batchId : undefined;
            if (current !== e.view.batchId) expect(next).toBe(state);
            if (state.phase === "casting" && state.view !== undefined && rank(e.view.status) < rank(state.view.status)) expect(next).toBe(state);
          }
          if (next.phase === "ready" && state.phase !== "ready") {
            expect(e.type).toBe("view");
            if (e.type === "view") expect(e.view.status).toBe("ready");
          }
          if (e.type === "reroll" && next !== state) expect((sheetOf(state)?.rerollsLeft ?? 0) > 0).toBe(true);
          if (e.type === "back") expect(next).toEqual(CAST_IDLE);
          state = next;
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a failed re-roll keeps the sheet on show; the next re-roll comes from it", () => {
    let state = castReducer(CAST_IDLE, { type: "start", brief: BRIEF });
    state = castReducer(state, { type: "batch", batchId: "b1" });
    state = castReducer(state, { type: "view", view: view("b1", "ready", 2) });
    state = castReducer(state, { type: "reroll" });
    expect(sheetOf(state)?.batchId).toBe("b1");
    expect(rerollFrom(state)).toBe("b1");
    state = castReducer(state, { type: "fail", code: "quota", message: "spent" });
    expect(state).toMatchObject({ phase: "failed", code: "quota", view: { batchId: "b1" } });
    expect(castReducer(castReducer(CAST_IDLE, { type: "start", brief: BRIEF }), { type: "reroll" }).phase).toBe("casting");
    expect(rerollFrom({ phase: "ready", brief: BRIEF, view: view("b9", "ready", 0) })).toBeUndefined();
  });
});
