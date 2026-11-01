import type { ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { forgeReducer, IDLE, RUNNING_ORDER, type ForgeEvent, type ForgeState } from "./forgeReducer";

const JOB = "job_1";
const STATUSES: ForgeStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling", "done", "failed"];
const CODES: ForgeErrorCode[] = ["quota", "refused_likeness", "refused_content", "upstream", "bad_input"];

const requestArb: fc.Arbitrary<ForgeRequest> = fc.oneof(
  fc.string({ minLength: 10, maxLength: 40 }).map((prompt) => ({ mode: "prompt" as const, prompt })),
  fc.base64String({ minLength: 4, maxLength: 40 }).map((imageBase64) => ({ mode: "image" as const, imageBase64 })),
);

function viewOf(status: ForgeStatus, jobId = JOB, complete = true): JobView {
  const view: JobView = { jobId, status, plane: "replay" };
  if (status === "done" && complete) {
    const rig = testRig();
    view.rig = rig;
    view.assets = Object.fromEntries(rig.layers.map((l) => [l.file, `u:${l.file}`]));
  }
  if (status === "failed") view.error = { code: "refused_content", message: "No." };
  return view;
}

const eventArb: fc.Arbitrary<ForgeEvent> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...STATUSES).map((s) => ({ type: "view" as const, view: viewOf(s) })) },
  { weight: 1, arbitrary: fc.constantFrom(...STATUSES).map((s) => ({ type: "view" as const, view: viewOf(s, "other_job") })) },
  { weight: 1, arbitrary: fc.constant({ type: "view" as const, view: viewOf("done", JOB, false) }) },
  {
    weight: 1,
    arbitrary: fc.record({ type: fc.constant("fail" as const), code: fc.constantFrom(...CODES), message: fc.string(), request: requestArb }),
  },
);

const order = (s: ForgeState): number => (s.phase === "running" ? RUNNING_ORDER.indexOf(s.status) : s.phase === "idle" ? -1 : 99);

describe("forgeReducer properties", () => {
  it("only moves forward through the status order, and a terminal state stays terminal", () => {
    fc.assert(
      fc.property(requestArb, fc.array(eventArb, { maxLength: 30 }), (request, events) => {
        let state = forgeReducer(IDLE, { type: "start", jobId: JOB, request, at: 0 });
        for (const event of events) {
          const next = forgeReducer(state, event);
          expect(order(next)).toBeGreaterThanOrEqual(order(state));
          if (state.phase === "done" || state.phase === "failed") expect(next).toBe(state);
          state = next;
        }
      }),
    );
  });

  it("ends in done or failed once the job reports either", () => {
    fc.assert(
      fc.property(requestArb, fc.array(eventArb, { maxLength: 20 }), fc.constantFrom<ForgeStatus>("done", "failed"), (request, events, end) => {
        let state = forgeReducer(IDLE, { type: "start", jobId: JOB, request, at: 0 });
        for (const event of [...events, { type: "view" as const, view: viewOf(end) }]) state = forgeReducer(state, event);
        expect(["done", "failed"]).toContain(state.phase);
      }),
    );
  });

  it("failed always keeps the original request", () => {
    fc.assert(
      fc.property(requestArb, fc.array(eventArb, { maxLength: 30 }), (request, events) => {
        let state = forgeReducer(IDLE, { type: "start", jobId: JOB, request, at: 0 });
        for (const event of events) state = forgeReducer(state, event);
        if (state.phase === "failed") expect(state.retry).toEqual(request);
      }),
    );
  });
});

describe("forgeReducer examples", () => {
  const request: ForgeRequest = { mode: "prompt", prompt: "a candle-wax bishop" };
  const running = forgeReducer(IDLE, { type: "start", jobId: JOB, request, at: 5 });

  it("starts at queued with the start time", () => {
    expect(running).toEqual({ phase: "running", jobId: JOB, status: "queued", startedAt: 5, request });
  });

  it("keeps the portrait once it is shown", () => {
    const seg = forgeReducer(running, { type: "view", view: { ...viewOf("segmenting"), portraitUrl: "p.jpg" } });
    const cut = forgeReducer(seg, { type: "view", view: viewOf("cutting") });
    expect(cut).toMatchObject({ status: "cutting", portraitUrl: "p.jpg" });
  });

  it("finishes with the validated rig and its assets", () => {
    const done = forgeReducer(running, { type: "view", view: viewOf("done") });
    expect(done.phase).toBe("done");
    if (done.phase === "done") expect(Object.keys(done.assets)).toHaveLength(testRig().layers.length);
  });

  it("makes a done job without its parts upstream", () => {
    expect(forgeReducer(running, { type: "view", view: viewOf("done", JOB, false) })).toMatchObject({ phase: "failed", code: "upstream" });
  });

  it("a start refused before any job keeps that request for retry", () => {
    expect(forgeReducer(IDLE, { type: "fail", code: "quota", message: "Spent.", request })).toEqual({
      phase: "failed",
      code: "quota",
      message: "Spent.",
      retry: request,
    });
  });

  it("reset returns to the form, but not while a job runs", () => {
    expect(forgeReducer(running, { type: "reset" })).toBe(running);
    expect(forgeReducer(forgeReducer(running, { type: "view", view: viewOf("failed") }), { type: "reset" })).toBe(IDLE);
  });
});
