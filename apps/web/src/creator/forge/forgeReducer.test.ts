import type { ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Rig } from "@sr/rig";
import { rigFiles } from "../library/assets";
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

describe("forgeReducer: wake after eyes (forge-creator C1)", () => {
  const request: ForgeRequest = { mode: "prompt", prompt: "a candle-wax bishop" };
  const running = forgeReducer(IDLE, { type: "start", jobId: JOB, request, at: 5 });
  const RIG = testRig();
  const assetsOf = (rig: Rig): Record<string, string> => Object.fromEntries(rigFiles(rig).map((f) => [f, `u:${f}`]));
  const withJoy = (rig: Rig, layer = "head"): Rig => ({
    ...rig,
    layers: rig.layers.map((l) => (l.name === layer ? { ...l, variants: { ...l.variants, joy: { file: `${l.name}.joy.png`, bbox: [l.bbox[0], l.bbox[1], 2, 2], mode: "over" as const } } } : l)),
  });
  const expressing = (rig?: Rig): JobView => ({ jobId: JOB, status: "expressing", plane: "live", ...(rig === undefined ? {} : { rig, assets: assetsOf(rig) }) });
  const awake = forgeReducer(running, { type: "view", view: expressing(RIG), at: 155_000 });

  it("an expressing view with a valid rig wakes the job, remembering when", () => {
    expect(forgeReducer(running, { type: "view", view: expressing() })).toMatchObject({ phase: "running", status: "expressing" });
    expect(awake).toMatchObject({ phase: "running", status: "expressing", awakeAt: 155_000 });
    expect(awake.phase === "running" ? awake.awake?.rig : undefined).toEqual(RIG);
    // A rig before expressing is never shown, and a rig missing a layer file does not wake.
    expect(forgeReducer(running, { type: "view", view: { ...viewOf("filling"), rig: RIG, assets: assetsOf(RIG) } })).not.toHaveProperty("awake");
    expect(forgeReducer(running, { type: "view", view: { ...expressing(RIG), assets: {} } })).not.toHaveProperty("awake");
  });

  it("folds in a later rig that only adds faces, and ignores one that changes a layer", () => {
    const more = forgeReducer(awake, { type: "view", view: expressing(withJoy(RIG)), at: 195_000 });
    expect(more.phase === "running" ? [more.awake?.rig, more.awakeAt] : more).toEqual([withJoy(RIG), 155_000]);
    const moved: Rig = { ...RIG, layers: RIG.layers.slice(1) };
    expect(forgeReducer(more, { type: "view", view: expressing(moved) })).toBe(more);
  });

  it("once awake nothing fails it: a failure, a client fail or the tail's cap finish it with what it has", () => {
    const joy = forgeReducer(awake, { type: "view", view: expressing(withJoy(RIG)) });
    for (const event of [
      { type: "view" as const, view: viewOf("failed") },
      { type: "fail" as const, code: "upstream" as const, message: "gone", request },
      { type: "settle" as const, message: "late" },
    ]) {
      const end = forgeReducer(joy, event);
      expect(end.phase).toBe("done");
      if (end.phase === "done") expect(end.rig).toEqual(withJoy(RIG));
    }
    expect(forgeReducer(running, { type: "settle", message: "late" })).toMatchObject({ phase: "failed", code: "upstream", message: "late" });
  });

  it("done keeps the awake rig when its own is not an additive extension, or not a character at all", () => {
    const changed: Rig = { ...RIG, width: RIG.width + 2 };
    const done = forgeReducer(awake, { type: "view", view: { jobId: JOB, status: "done", plane: "live", rig: changed, assets: assetsOf(changed) } });
    expect(done.phase === "done" ? done.rig : done).toEqual(RIG);
    const bare = forgeReducer(awake, { type: "view", view: viewOf("done", JOB, false) });
    expect(bare.phase === "done" ? bare.rig : bare).toEqual(RIG);
    const faces = forgeReducer(awake, { type: "view", view: { jobId: JOB, status: "done", plane: "live", rig: withJoy(RIG), assets: assetsOf(withJoy(RIG)) } });
    expect(faces.phase === "done" ? faces.rig : faces).toEqual(withJoy(RIG));
  });

  it("an awake job never fails and never loses a layer, whatever follows (property)", () => {
    const later = fc.oneof(
      fc.constantFrom(...STATUSES).map((s) => ({ type: "view" as const, view: viewOf(s) })),
      fc.constantFrom(RIG, withJoy(RIG), withJoy(withJoy(RIG), "torso"), { ...RIG, layers: RIG.layers.slice(2) }).map((rig) => ({ type: "view" as const, view: expressing(rig) })),
      fc.record({ type: fc.constant("fail" as const), code: fc.constantFrom(...CODES), message: fc.string(), request: requestArb }),
      fc.constant({ type: "settle" as const, message: "late" }),
    );
    fc.assert(
      fc.property(fc.array(later, { maxLength: 20 }), (events) => {
        let state = awake;
        for (const event of events) {
          state = forgeReducer(state, event);
          expect(state.phase).not.toBe("failed");
          const rig = state.phase === "done" ? state.rig : state.phase === "running" ? state.awake?.rig : undefined;
          expect(rig?.layers.map((l) => l.name)).toEqual(RIG.layers.map((l) => l.name));
        }
      }),
    );
  });
});
