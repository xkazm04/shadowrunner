// @vitest-environment happy-dom
// forge-creator S1, say why a face was refused: the client reads the job's `expressionGate`
// (dropping malformed readings, never the view), the job reducer keeps it through done, the kept
// record carries it as `faceGate` through the library (IndexedDB and memory), and Wake says briefly
// why each procedural family is procedural. A replay job has no readings and reads as before.
// The IndexedDB round trip is library/faceGate.test.ts (node, real Blobs).
import type { FaceGate } from "@sr/forge/faceGate";
import type { ForgeRequest, JobView } from "@sr/forge/wire";
import { defaultLook } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { mount } from "../../app/testDom";
import { readJobView } from "../forgeClient";
import { forgeReducer, type ForgeState } from "../forge/forgeReducer";
import { readRecord, type CharacterRecord } from "../library/libraryStore";
import { testRig } from "../testFixtures";
import { WakeMark } from "./ForgeWake";
import { gateOf, withGate } from "./useKept";

const GATE: FaceGate = { joy: { reason: "iris", irisDriftPx: 7.2, limit: 4, attempts: 3 }, gloom: { reason: "budget" } };
const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function record(extra: Partial<CharacterRecord> = {}): CharacterRecord {
  const rig = testRig("forged-wisp", "Wisp");
  return { id: rig.id, rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])), look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-08T00:00:00.000Z", ...extra };
}

describe("the job view", () => {
  const view = { jobId: "j1", status: "done", plane: "live", expressions: { joy: "skipped", gloom: "skipped" } };

  it("readJobView keeps the gate and drops a malformed reading without refusing the view", () => {
    expect(readJobView({ ...view, expressionGate: GATE })).toEqual({ ...view, expressionGate: GATE });
    const spoiled = readJobView({ ...view, expressionGate: { ...GATE, gloom: { reason: "tired" }, grin: { reason: "iris" } } });
    expect(spoiled?.expressionGate).toEqual({ joy: GATE.joy });
    const all = readJobView({ ...view, expressionGate: "iris" });
    expect(all).toBeDefined();
    expect(all !== undefined && "expressionGate" in all).toBe(false);
  });

  it("a recorded (replay) view has no gate and reads as before", () => {
    const replay = { jobId: "replay_malakor_1", status: "done", plane: "replay" };
    expect(readJobView(replay)).toEqual(replay);
  });

  it("the reducer keeps the gate from the views through done", () => {
    const request: ForgeRequest = { mode: "prompt", prompt: "a wisp in a jar" };
    let state: ForgeState = forgeReducer({ phase: "idle" }, { type: "start", jobId: "j1", request, at: 0 });
    const v = (status: JobView["status"], extra: Partial<JobView> = {}): JobView => ({ jobId: "j1", status, plane: "live", ...extra });
    state = forgeReducer(state, { type: "view", view: v("expressing", { expressions: { joy: "skipped" }, expressionGate: { joy: GATE.joy ?? { reason: "failed" } } }) });
    expect(gateOf(state)).toEqual({ joy: GATE.joy });
    const rig = testRig("g1");
    const assets = Object.fromEntries(rig.layers.map((l) => [l.file, "data:,x"]));
    state = forgeReducer(state, { type: "view", view: v("done", { rig, assets, expressionGate: GATE }) });
    expect(state.phase).toBe("done");
    expect(gateOf(state)).toEqual(GATE);
  });
});

describe("the kept record", () => {
  it("withGate puts the readings on the record; none leaves it as it is", () => {
    const plain = record();
    expect(withGate(plain, undefined)).toBe(plain);
    expect(withGate(plain, GATE).faceGate).toEqual(GATE);
  });

  it("readRecord keeps the readings, drops malformed ones, and a record without them has none", () => {
    const read = readRecord(record({ faceGate: GATE }));
    expect(read.kind === "ok" && read.record.faceGate).toEqual(GATE);
    const plain = readRecord(record());
    expect(plain.kind === "ok" && "faceGate" in plain.record).toBe(false);
    const bad = readRecord({ ...record(), faceGate: { joy: { reason: "iris", irisDriftPx: -3 } } });
    expect(bad.kind).toBe("ok");
    expect(bad.kind === "ok" && "faceGate" in bad.record).toBe(false);
  });
});

describe("Wake", () => {
  const done = { joy: "skipped", showman: "ok", anger: "ok", gloom: "skipped", smug: "ok", suspicion: "failed" } as const;

  it("says briefly why each procedural family is procedural when it was read", async () => {
    const m = await mount(<WakeMark name="Wisp" layers={8} handoff="/creator?character=w" expressions={done} gate={GATE} />);
    expect(m.container.querySelector("[data-procedural]")?.textContent).toBe("joy · procedural, the eyes moved 7.2 px (limit 4); gloom · procedural, the daily budget ran out; suspicion · procedural");
    await m.unmount();
  });

  it("without readings lists the procedural families as before", async () => {
    const m = await mount(<WakeMark name="Wisp" layers={8} handoff="/creator?character=w" expressions={done} />);
    expect(m.container.querySelector("[data-procedural]")?.textContent).toBe("joy · procedural, gloom · procedural, suspicion · procedural");
    await m.unmount();
  });
});
