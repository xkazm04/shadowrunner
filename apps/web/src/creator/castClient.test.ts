// castClient.ts (forge-creator L2): the HTTP casting client goes through the injected fetcher to
// /api/forge/drafts and checks every view; the replay twin shows recorded jobs with no fetch; the
// plane client sends a recorded batch to the twin even on live; and the replay forge client plays
// the recorded job a cast candidate showed.
import { parseReplayBatchId } from "@sr/forge/cast";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fetcher } from "../app/plane";
import { CAST_URL, castClientFor, createHttpCastClient, createReplayCastClient, readCastView } from "./castClient";
import { ForgeError } from "./forgeClient";
import { createReplayForgeClient } from "./forgeClient.replay";
import { testBriefs, testJob, testRig } from "./testFixtures";

const BRIEF = testBriefs()[1];
if (BRIEF === undefined) throw new Error("no test brief");
const JOBS = ["ghost-a", "ghost-b", "ghost-c", "ghost-d"].map((s) => testJob(s));
const jobs = async () => JOBS;
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fetcherOf(...responses: Response[]): Fetcher & { calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = responses.shift();
    if (next === undefined) throw new Error("no more responses");
    return next;
  });
  return Object.assign(fn, { calls });
}

const rig = testRig("cand");
const assets = Object.fromEntries(rig.layers.map((l) => [l.file, `https://x.test/${l.file}`]));
const VIEW = {
  batchId: "b".repeat(32),
  status: "ready",
  plane: "live",
  rerollsLeft: 2,
  candidates: [
    { index: 0, state: "cut", portraitUrl: "https://x.test/p.png", rig, assets, missing: ["plume"], empty: [], warnings: [] },
    { index: 1, state: "failed", missing: [], empty: [], warnings: [], note: "no portrait" },
  ],
};

let fetches = 0;
beforeEach(() => {
  fetches = 0;
  vi.stubGlobal("fetch", () => {
    fetches += 1;
    throw new Error("network access in a test");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("readCastView", () => {
  it("accepts a well-formed view and refuses a candidate whose rig lacks a layer's URL, or a null field", () => {
    expect(readCastView(VIEW)).toEqual(VIEW);
    const short = Object.fromEntries(Object.entries(assets).slice(1));
    expect(readCastView({ ...VIEW, candidates: [{ ...VIEW.candidates[0], assets: short }] })).toBeUndefined();
    expect(readCastView({ ...VIEW, candidates: [{ ...VIEW.candidates[1], portraitUrl: null }] })).toBeUndefined();
    expect(readCastView({ ...VIEW, status: "cooking" })).toBeUndefined();
  });
});

describe("HTTP casting client", () => {
  it("POSTs the brief (and `after` on a re-roll) to /api/forge/drafts and polls /api/forge/drafts/:id", async () => {
    const f = fetcherOf(json(202, { batchId: "b1b1b1b1" }), json(202, { batchId: "b2b2b2b2" }), json(200, VIEW));
    const client = createHttpCastClient(f);
    await expect(client.draft(BRIEF)).resolves.toEqual({ batchId: "b1b1b1b1" });
    await client.draft(BRIEF, "b1b1b1b1");
    await expect(client.poll(VIEW.batchId)).resolves.toEqual(VIEW);
    expect(f.calls.map(([url]) => url)).toEqual([CAST_URL, CAST_URL, `${CAST_URL}/${VIEW.batchId}`]);
    expect(f.calls[0]?.[1]?.body).toBe(JSON.stringify({ brief: BRIEF }));
    expect(f.calls[1]?.[1]?.body).toBe(JSON.stringify({ brief: BRIEF, after: "b1b1b1b1" }));
  });

  it("an error body keeps its code; an unreadable view is upstream", async () => {
    const client = createHttpCastClient(fetcherOf(json(429, { error: { code: "quota", message: "No re-rolls left." } }), json(200, { batchId: "x" })));
    await expect(client.draft(BRIEF, "b1b1b1b1")).rejects.toMatchObject({ code: "quota", message: "No re-rolls left." });
    await expect(client.poll("x")).rejects.toBeInstanceOf(ForgeError);
  });
});

describe("replay casting twin", () => {
  it("three recorded candidates, ready after the holds, re-rolls capped at two; zero fetches", async () => {
    let t = 1_000;
    const client = createReplayCastClient({ jobs, now: () => t });
    const { batchId } = await client.draft(BRIEF);
    expect((await client.poll(batchId)).status).toBe("drafting");
    t += 10_000;
    const view = await client.poll(batchId);
    expect(view).toMatchObject({ status: "ready", plane: "replay", rerollsLeft: 2 });
    expect(view.candidates.map((c) => c.state)).toEqual(["cut", "cut", "cut"]);
    const second = await client.draft(BRIEF, batchId);
    const third = await client.draft(BRIEF, second.batchId);
    await expect(client.draft(BRIEF, third.batchId)).rejects.toMatchObject({ code: "quota" });
    expect(fetches).toBe(0);
  });

  it("the plane client polls a recorded batch with the twin even on live", async () => {
    const client = castClientFor("live", { jobs });
    const { batchId } = await createReplayCastClient({ jobs }).draft(BRIEF);
    await expect(client.poll(batchId)).resolves.toMatchObject({ plane: "replay" });
    expect(fetches).toBe(0);
  });

  it("the replay forge client plays the recorded job of the cast candidate", async () => {
    const { batchId } = await createReplayCastClient({ jobs }).draft(BRIEF);
    const slug = parseReplayBatchId(batchId)?.slugs[2];
    const { jobId } = await createReplayForgeClient({ jobs }).start({ mode: "brief", brief: BRIEF, candidate: { batchId, index: 2 } });
    expect(jobId.startsWith(`replay_${slug ?? "?"}_`)).toBe(true);
    await expect(createReplayForgeClient({ jobs }).start({ mode: "brief", brief: BRIEF, candidate: { batchId: "nope-nope", index: 0 } })).rejects.toMatchObject({ code: "bad_input" });
  });
});
