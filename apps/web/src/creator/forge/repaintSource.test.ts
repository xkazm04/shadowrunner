// forge-creator S2: where a kept character's repaint comes from. A live job's view names its end of
// life (`expiresAt`), the forge reducer keeps it (never on replay), the rite keeps it on the record
// as `source` with the brief's eyes line; the library reads it back (a malformed one is dropped) and
// a pack never carries it. The client door to POST /api/forge/:jobId/faces checks its answer.
import type { RepaintCandidate } from "@sr/forge/wire";
import { defaultLook } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { readJobView } from "../forgeClient";
import { memoryLibrary, openLibrary, readRecord, type CharacterRecord } from "../library/libraryStore";
import { packInputOf } from "../library/packing";
import { sourceOf } from "../rite/useKept";
import { testRig } from "../testFixtures";
import { IDLE, forgeReducer } from "./forgeReducer";
import { repaintFace, RepaintError } from "./repaintClient";

const JOB = "b".repeat(32);
const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const SOURCE = { jobId: JOB, expiresAt: 1_800_000_000_000, eyes: "two lit holes" };

function record(): CharacterRecord {
  const rig = testRig("forged-wisp", "Wisp");
  return { id: rig.id, rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])), look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-08T00:00:00.000Z", source: SOURCE };
}

describe("the repaint source", () => {
  it("a live view's expiresAt is read and kept through done; a replay job never has one", () => {
    const rig = testRig();
    const assets = Object.fromEntries(rig.layers.map((l) => [l.file, `u:${l.file}`]));
    expect(readJobView({ jobId: JOB, status: "cutting", plane: "live", expiresAt: 5 })?.expiresAt).toBe(5);
    expect(readJobView({ jobId: JOB, status: "cutting", plane: "live", expiresAt: "soon" })).toEqual({ jobId: JOB, status: "cutting", plane: "live" });
    const start = forgeReducer(IDLE, { type: "start", jobId: JOB, request: { mode: "prompt", prompt: "a wisp" }, at: 0 });
    const awake = forgeReducer(start, { type: "view", view: { jobId: JOB, status: "expressing", plane: "live", rig, assets, expiresAt: SOURCE.expiresAt } });
    expect(awake.phase === "running" && awake.expiresAt).toBe(SOURCE.expiresAt);
    expect(sourceOf(awake, { face: { eyes: "two lit holes" } } as Parameters<typeof sourceOf>[1])).toEqual(SOURCE);
    const done = forgeReducer(awake, { type: "view", view: { jobId: JOB, status: "done", plane: "live", rig, assets } });
    expect(done.phase === "done" && done.expiresAt).toBe(SOURCE.expiresAt);
    expect(sourceOf(done, undefined)).toEqual({ jobId: JOB, expiresAt: SOURCE.expiresAt });
    const replay = forgeReducer(forgeReducer(IDLE, { type: "start", jobId: "replay_x_1", request: { mode: "prompt", prompt: "a wisp" }, at: 0 }), {
      type: "view",
      view: { jobId: "replay_x_1", status: "done", plane: "replay", rig, assets, expiresAt: 9 },
    });
    expect(sourceOf(replay, undefined)).toBeUndefined();
  });

  it("survives the IndexedDB library and the memory twin, a malformed one is dropped, and a pack never carries it", async () => {
    const factory = new IDBFactory();
    await (await openLibrary(() => factory)).put(record());
    const entry = await (await openLibrary(() => factory)).get("forged-wisp");
    expect(entry?.kind === "ok" && entry.record.source).toEqual(SOURCE);
    const memory = memoryLibrary();
    await memory.put(record());
    const again = await memory.get("forged-wisp");
    expect(again?.kind === "ok" && again.record.source).toEqual(SOURCE);
    for (const bad of [{ jobId: "x" }, { ...SOURCE, expiresAt: -1 }, { ...SOURCE, eyes: 3 }, "soon"]) {
      const read = readRecord({ ...record(), source: bad });
      expect(read.kind === "ok" && "source" in read.record).toBe(false);
    }
    expect("source" in packInputOf(record(), { licence: "CC0-1.0" })).toBe(false);
  });
});

describe("repaintFace", () => {
  const candidate: RepaintCandidate = { family: "joy", ok: false, plane: "live", gate: { reason: "band" }, left: { family: 1, job: 3 } };

  it("posts to /api/forge/:jobId/faces and returns the checked candidate", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const out = await repaintFace(JOB, { family: "joy", key: "key-00000001" }, async (url, init) => (calls.push({ url, ...(init === undefined ? {} : { init }) }), Response.json(candidate)));
    expect(out).toEqual(candidate);
    expect(calls[0]?.url).toBe(`/api/forge/${JOB}/faces`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ family: "joy", key: "key-00000001" });
  });

  it("an expired or missing job is a RepaintError marked expired; quota keeps its code; an unreadable answer is upstream", async () => {
    const fail = (status: number, code: string) => async () => Response.json({ error: { code, message: "No." } }, { status });
    await expect(repaintFace(JOB, { family: "joy", key: "key-00000001" }, fail(410, "bad_input"))).rejects.toMatchObject({ code: "bad_input", expired: true });
    await expect(repaintFace(JOB, { family: "joy", key: "key-00000001" }, fail(404, "bad_input"))).rejects.toMatchObject({ expired: true });
    await expect(repaintFace(JOB, { family: "joy", key: "key-00000001" }, fail(429, "quota"))).rejects.toMatchObject({ code: "quota", expired: false });
    await expect(repaintFace(JOB, { family: "joy", key: "key-00000001" }, async () => Response.json({ ...candidate, family: "anger" }))).rejects.toBeInstanceOf(RepaintError);
    await expect(repaintFace(JOB, { family: "joy", key: "key-00000001" }, async () => Promise.reject(new Error("offline")))).rejects.toMatchObject({ code: "upstream" });
  });
});
