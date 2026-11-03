// @vitest-environment happy-dom
// character-control task 4, requirement 5.4: the rite shows the live forge's expression steps
// ("Expressions n / 6" while `expressing`) and, once done, names every family that is procedural.
// The forge client accepts the new status and its outcomes; the job reducer keeps them.
import type { ForgeRequest, JobView } from "@sr/forge/wire";
import { describe, expect, it } from "vitest";
import { mount } from "../../app/testDom";
import { readJobView } from "../forgeClient";
import { forgeReducer, type ForgeState } from "../forge/forgeReducer";
import { testRig } from "../testFixtures";
import { ForgeMark, WakeMark } from "./ForgeWake";

const three = { joy: "ok", showman: "skipped", anger: "ok" } as const;

describe("the rite's expression steps", () => {
  it("shows Expressions 3 / 6 while the job is expressing", async () => {
    const m = await mount(<ForgeMark step="expressing" expressions={three} recorded={false} onEdit={() => undefined} />);
    expect(m.container.querySelector("[data-expressions]")?.textContent).toBe("Expressions 3 / 6");
    expect(m.container.querySelector('[aria-current="step"]')?.textContent).toContain("Drawing the expressions");
    await m.unmount();
  });

  it("after done names every family that is not ok as procedural", async () => {
    const done = { ...three, gloom: "failed", smug: "ok" } as const;
    const m = await mount(<WakeMark name="Ghost" layers={8} handoff="/creator?character=g" expressions={done} />);
    expect(m.container.querySelector("[data-procedural]")?.textContent).toBe("showman · procedural, gloom · procedural, suspicion · procedural");
    await m.unmount();
  });

  it("a recorded job (no expressions) lists no expressions stage", async () => {
    const m = await mount(<ForgeMark step="filling" recorded onEdit={() => undefined} />);
    expect(m.container.textContent).not.toContain("Drawing the expressions");
    await m.unmount();
  });
});

describe("the client and the reducer", () => {
  it("readJobView accepts expressing and its outcomes, refuses an unknown family or outcome", () => {
    const view = { jobId: "j1", status: "expressing", plane: "live", expressions: three };
    expect(readJobView(view)).toEqual(view);
    expect(readJobView({ ...view, expressions: { grin: "ok" } })).toBeUndefined();
    expect(readJobView({ ...view, expressions: { joy: "maybe" } })).toBeUndefined();
  });

  it("the running job counts expressions as they arrive and keeps them when done", () => {
    const request: ForgeRequest = { mode: "prompt", prompt: "a ghost in a lantern" };
    let state: ForgeState = forgeReducer({ phase: "idle" }, { type: "start", jobId: "j1", request, at: 0 });
    const v = (status: JobView["status"], expressions?: JobView["expressions"], extra: Partial<JobView> = {}): JobView => ({
      jobId: "j1",
      status,
      plane: "live",
      ...(expressions === undefined ? {} : { expressions }),
      ...extra,
    });
    state = forgeReducer(state, { type: "view", view: v("expressing", {}) });
    state = forgeReducer(state, { type: "view", view: v("expressing", { joy: "ok" }) });
    expect(state.phase === "running" ? [state.status, state.expressions] : state).toEqual(["expressing", { joy: "ok" }]);
    const rig = testRig("g1");
    const assets = Object.fromEntries(rig.layers.map((l) => [l.file, "data:,x"]));
    state = forgeReducer(state, { type: "view", view: v("done", three, { rig, assets }) });
    expect(state.phase === "done" ? state.expressions : state).toEqual(three);
  });
});
