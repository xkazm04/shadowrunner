// forge-creator S2, repaint one face: POST /api/forge/:jobId/faces through the real handler with a
// fake Gemini and an in-memory store, on a live forge run to `done` once (forge-repaint.fixture.ts).
// One paid edit, nothing else re-run; the prompt from the family's reading and the eyes line;
// idempotent by key; capped per family and per job; a refused candidate carries no face; the job's
// stored rig is never changed; the replay header makes no paid call; expired jobs say so.
import { MAX_FAMILY_REPAINTS, MAX_JOB_REPAINTS, REPAINT_ESTIMATE_USD, STRICTER, eyesMaterial, gateReading, jobExpiresAt, type FaceGateReading, type ForgeJob, type RepaintCandidate } from "@sr/forge";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COST_USD } from "../_lib/costs.js";
import { EXPIRED_MESSAGE, createReplayFaces, handleRepaintPost, repaintJobIdOf } from "../_lib/forge-repaint.js";
import { bundledJobs } from "../_lib/forge-replay.js";
import { MAX_JOB_BYTES } from "../_lib/jobstore.js";
import { belowEyes, fakeForge, forgeToDone, type FakeForge } from "./forge-repaint.fixture.js";

const S0 = STRICTER[0] ?? "?";
const S1 = STRICTER[1] ?? "?";
let forged: ForgeJob;

function post(jobId: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://sr.test/api/forge/${jobId}/faces`, { method: "POST", body: JSON.stringify(body), headers: { "x-real-ip": "198.51.100.9", ...headers } });
}

/** A fresh fake forge holding a copy of the forged job (with `patch` applied), its spend counters at zero. */
async function withJob(patch: Partial<ForgeJob> = {}): Promise<FakeForge & { job: ForgeJob }> {
  const f = fakeForge();
  const job: ForgeJob = { ...structuredClone(forged), ...patch };
  await f.store.put(job);
  return { ...f, job };
}

async function repaint(f: FakeForge, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await handleRepaintPost(post(forged.jobId, body, headers), f.deps);
  return { status: res.status, body: await res.json() };
}

const stored = async (f: FakeForge): Promise<ForgeJob> => {
  const job = await f.store.get(forged.jobId);
  if (job === undefined) throw new Error("job gone");
  return job;
};
const withoutLedger = (job: ForgeJob): ForgeJob => {
  const rest = { ...job };
  delete rest.repaints;
  return rest;
};

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const f = fakeForge();
  const { jobId, view } = await forgeToDone(f.deps);
  expect(view.status).toBe("done");
  const job = await f.store.get(jobId);
  if (job === undefined) throw new Error("no job");
  forged = job;
}, 180_000);

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network access in a test");
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/forge/:jobId/faces", () => {
  it("takes the job id from the path or the rewrite's query", () => {
    expect(repaintJobIdOf(new Request("https://sr.test/api/forge/abc123/faces"))).toBe("abc123");
    expect(repaintJobIdOf(new Request("https://sr.test/api/forge/[jobId]/faces?jobId=xyz789"))).toBe("xyz789");
    expect(COST_USD.expression).toBe(REPAINT_ESTIMATE_USD);
  });

  it("one image edit and nothing else; an iris reading asks STRICTER[0], the eyes line is the material; the stored rig stays", { timeout: 60_000 }, async () => {
    const iris: FaceGateReading = gateReading("iris", { irisDriftPx: 7.2, limit: 4, attempts: 3 });
    const f = await withJob({ expressionGate: { joy: iris } });
    const before = await stored(f);
    const eyes = "two carved holes lit from inside";
    const { status, body } = await repaint(f, { family: "joy", eyes, key: "key-iris-0001" });
    expect(status).toBe(200);
    expect(f.calls).toEqual(["expression"]);
    expect(f.charges).toEqual([COST_USD.expression]);
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain(S0);
    expect(f.prompts[0]).not.toContain(S1);
    expect(f.prompts[0]).toContain(eyesMaterial(eyes));
    const candidate = body as RepaintCandidate;
    expect(candidate).toMatchObject({ family: "joy", ok: true, plane: "live", left: { family: 1, job: 3 } });
    const files = Object.values(candidate.patch?.layers ?? {}).map((p) => p.file);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/\.joy_r1\.png$/);
      expect(candidate.patch?.assets[file]).toMatch(/^data:image\/png;base64,/);
    }
    // The candidate is not the job's: its rig and assets are as they were; only the ledger moved.
    const after = await stored(f);
    expect(withoutLedger(after)).toEqual(withoutLedger(before));
    expect(after.repaints?.counts).toEqual({ joy: 1 });
  });

  it("a band reading asks both STRICTER sentences, too subtle none, no reading the first; the brief's eyes line by default", { timeout: 60_000 }, async () => {
    const f = await withJob({ expressionGate: { anger: gateReading("band", { outsideBandMean: 9, limit: 4 }) } });
    await repaint(f, { family: "anger", key: "key-band-0001" });
    await repaint(f, { family: "anger", key: "key-subtle-01", hint: "too_subtle" });
    await repaint(f, { family: "joy", key: "key-none-0001" });
    const [band, subtle, none] = f.prompts;
    expect([band?.includes(S0), band?.includes(S1)]).toEqual([true, true]);
    expect([subtle?.includes(S0), subtle?.includes(S1)]).toEqual([false, false]);
    expect([none?.includes(S0), none?.includes(S1)]).toEqual([true, false]);
    expect(f.calls).toEqual(["expression", "expression", "expression"]);
  });

  it("the same key answers the first result without spending again", { timeout: 60_000 }, async () => {
    const f = await withJob();
    const first = await repaint(f, { family: "smug", key: "key-dupe-0001" });
    const second = await repaint(f, { family: "smug", key: "key-dupe-0001" });
    expect(second).toEqual(first);
    expect(f.calls).toEqual(["expression"]);
    expect(f.charges).toEqual([COST_USD.expression]);
    expect((await stored(f)).repaints?.counts).toEqual({ smug: 1 });
    // The same key for another face is refused, not spent.
    const other = await repaint(f, { family: "joy", key: "key-dupe-0001" });
    expect(other.status).toBe(400);
    expect(f.charges).toHaveLength(1);
  });

  it("the third repaint of one family and the fifth of a job are refused (quota) with no spend; the job record stays small", { timeout: 120_000 }, async () => {
    const f = await withJob();
    for (const key of ["key-cap-0001", "key-cap-0002"]) expect((await repaint(f, { family: "joy", key })).status).toBe(200);
    const third = await repaint(f, { family: "joy", key: "key-cap-0003" });
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ error: { code: "quota" } });
    expect(f.calls).toHaveLength(MAX_FAMILY_REPAINTS);
    for (const key of ["key-cap-0004", "key-cap-0005"]) expect((await repaint(f, { family: "gloom", key })).status).toBe(200);
    const fifth = await repaint(f, { family: "smug", key: "key-cap-0006" });
    expect(fifth.status).toBe(429);
    expect(fifth.body).toMatchObject({ error: { code: "quota" } });
    expect(f.calls).toHaveLength(MAX_JOB_REPAINTS);
    expect(f.charges).toHaveLength(MAX_JOB_REPAINTS);
    // The ledger with four answers, its URLs as long as a live Blob URL (the memory store's are data: URLs), stays a few KB.
    const blobUrl = (file: string) => `https://abcdefghijklmnop.public.blob.vercel-storage.com/forge/${forged.jobId}/${file.replace(".png", "")}-AbCdEfGhIjKlMnOpQrStU.png`;
    const ledger = JSON.stringify((await stored(f)).repaints, (key, value: unknown) => (typeof value === "string" && value.startsWith("data:") ? blobUrl(key) : value));
    expect(Buffer.byteLength(ledger, "utf8")).toBeLessThan(MAX_JOB_BYTES / 10);
  });

  it("a candidate the gate refuses is ok false with its reading and no face", { timeout: 60_000 }, async () => {
    const f = await withJob();
    f.answer.next = async () => belowEyes(70);
    const { status, body } = await repaint(f, { family: "showman", key: "key-band-0002" });
    expect(status).toBe(200);
    const candidate = body as RepaintCandidate;
    expect(candidate.ok).toBe(false);
    expect(candidate.patch).toBeUndefined();
    expect(candidate.gate?.reason).toBe("band");
    expect(f.calls).toEqual(["expression"]);
  });

  it("a budget refusal is quota with nothing reserved; an expired or missing job is a clear bad_input", { timeout: 60_000 }, async () => {
    const f = await withJob();
    f.refuse();
    const spent = await repaint(f, { family: "joy", key: "key-budget-01" });
    expect(spent.status).toBe(429);
    expect((await stored(f)).repaints).toBeUndefined();
    expect(f.calls).toEqual([]);

    // Started at 0: its window closes at 24 h, while the store (written at the clock's 1e6 ms) still holds it.
    const g = await withJob({ createdAt: 0 });
    g.advance(jobExpiresAt({ createdAt: 0 }) - 1_000_000);
    const late = await repaint(g, { family: "joy", key: "key-late-0001" });
    expect(late).toEqual({ status: 410, body: { error: { code: "bad_input", message: EXPIRED_MESSAGE } } });
    expect(g.calls).toEqual([]);
    const missing = await handleRepaintPost(post("f".repeat(32), { family: "joy", key: "key-gone-0001" }), g.deps);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "bad_input", message: EXPIRED_MESSAGE } });
  });

  it("refuses a malformed body and a job that is not awake", async () => {
    const f = await withJob({ status: "filling" });
    expect((await repaint(f, { family: "mood", key: "key-bad-00001" })).status).toBe(400);
    expect((await repaint(f, { family: "joy", key: "short" })).status).toBe(400);
    expect((await repaint(f, { family: "joy", key: "key-bad-00002", hint: "louder" })).status).toBe(400);
    expect((await repaint(f, { family: "joy", key: "key-bad-00003" })).body).toMatchObject({ error: { code: "bad_input" } });
    expect(f.calls).toEqual([]);
    expect(f.charges).toEqual([]);
  });

  it("x-sr-plane: replay answers the recorded face unchanged: no Gemini, no quota, no store", async () => {
    const f = fakeForge();
    let stores = 0;
    const deps = { ...f.deps, store: () => (stores++, f.store) };
    const job = bundledJobs().find((j) => j.rig.layers.some((l) => l.variants?.joy !== undefined));
    if (job === undefined) throw new Error("no recorded job with a joy face");
    const res = await handleRepaintPost(post(`replay_${job.slug}_k0`, { family: "joy", key: "key-replay-01" }, { "x-sr-plane": "replay" }), deps);
    expect(res.status).toBe(200);
    const candidate = (await res.json()) as RepaintCandidate;
    expect(candidate).toMatchObject({ family: "joy", ok: true, plane: "replay" });
    for (const layer of job.rig.layers) expect(candidate.patch?.layers[layer.name]).toEqual(layer.variants?.joy);
    expect(f.calls).toEqual([]);
    expect(f.charges).toEqual([]);
    expect(stores).toBe(0);
    // A live job id on the replay plane, and a recorded job with no face for the family, say so.
    const live = await handleRepaintPost(post(forged.jobId, { family: "joy", key: "key-replay-02" }, { "x-sr-plane": "replay" }), deps);
    expect(live.status).toBe(404);
    const bare = createReplayFaces([{ ...job, rig: { ...job.rig, layers: job.rig.layers.map((l) => ({ ...l, variants: {} })) } }]);
    const none = await bare(`replay_${job.slug}_k0`, JSON.stringify({ family: "joy", key: "key-replay-03" }));
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ error: { code: "bad_input", message: expect.stringContaining("no joy face") } });
  });
});
