// forge-creator L2, casting from three drafts. Fake Gemini only (global fetch is stubbed to count and
// throw). A batch makes exactly three draft image calls and at most three parts calls, and no fill,
// eye, expression or final-portrait call before a pick; its provisional rigs pass validateRig and
// name the planned parts that were not found. Casting a candidate continues from exactly its
// portrait and decomposition (no portrait call, no parts call) and casting twice gives one job. An
// abandoned batch costs one forge use and at most 3 drafts + 3 parts calls. Re-rolls are capped. On
// replay (`x-sr-plane: replay` on a live deploy) the sheet is three recorded jobs, and casting the
// second plays that job to done, with zero fetches.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CAST_SIZE,
  castCutId,
  briefFromRecorded,
  parseBrief,
  parseReplayBatchId,
  partsPromptFromBrief,
  type CastRecord,
  type CastView,
  type CharacterBrief,
  type ForgeJob,
  type JobView,
} from "@sr/forge";
import { validateRig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COST_USD } from "../_lib/costs.js";
import { defaultCastDeps, handleForgeGet, handleForgePost, type ForgeDeps } from "../_lib/forge-api.js";
import { handleCastGet, handleCastPost, type CastDeps } from "../_lib/forge-cast.js";
import { bundledReplay } from "../_lib/forge-replay.js";
import { bundledCastReplay } from "../_lib/forge-cast-replay.js";
import type { GeminiClient, GeminiImage, ImageOptions } from "../_lib/gemini.js";
import { MemoryJobStore } from "../_lib/jobstore.js";
import { MemoryQuotaStore, createQuota } from "../_lib/quota.js";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT));
const CAST = "assets/characters/cast/sir-vacant/";
const DRAFTS: GeminiImage[] = ["sir-vacant", "auntie-asp", "reveille"].map((slug) => ({ mimeType: "image/png", data: new Uint8Array(read(`assets/characters/cast/${slug}/portrait.png`)) }));
const FILL: GeminiImage = { mimeType: "image/jpeg", data: new Uint8Array(read(`${CAST}fill.jpg`)) };
const PARTS_TEXT = read(`${CAST}parts.json`).toString("utf8");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface FilePart { name: string; role: CharacterBrief["parts"][number]["role"]; follow?: string; motion?: unknown }
const PARTS_FILE = JSON.parse(PARTS_TEXT) as { version: 2; parts: FilePart[] };

/** Sir Vacant's recorded brief with its parts plan set to the decomposition's parts. */
function castBrief(): CharacterBrief {
  const base = briefFromRecorded(JSON.parse(read(`${CAST}brief.json`).toString("utf8")));
  if (!base.ok) throw new Error("brief.json");
  const words = new Map(base.value.parts.map((p) => [p.name, p]));
  const parts = PARTS_FILE.parts.map((p) => ({
    name: p.name,
    role: p.role,
    what: words.get(p.name)?.what ?? p.name.replaceAll("_", " "),
    ...(p.motion === undefined ? {} : { motion: words.get(p.name)?.motion ?? "moves on its own" }),
    ...(p.follow === undefined ? {} : { follow: p.follow }),
  }));
  const brief = parseBrief({ ...base.value, parts });
  if (!brief.ok) throw new Error("cast brief");
  return brief.value;
}
const BRIEF = castBrief();
/** The parts answer without the plume: a planned part the model did not find. */
const NO_PLUME = JSON.stringify({ ...PARTS_FILE, parts: PARTS_FILE.parts.filter((p) => p.name !== "plume") });

type Call = "draft" | "portrait" | "parts" | "fill" | "eyes" | "expression";

function fakeGemini(partsReplies: string[]) {
  const calls: Call[] = [];
  const replies = [...partsReplies];
  let drafts = 0;
  const client: GeminiClient = {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async (_prompt: string, options?: ImageOptions) => {
      if (options?.draft === true) {
        calls.push("draft");
        return DRAFTS[drafts++ % DRAFTS.length] ?? FILL;
      }
      calls.push("portrait");
      return DRAFTS[0] ?? FILL;
    },
    editImage: async (image, prompt) => {
      if (/remove the irises|Close both eyes/.test(prompt)) return (calls.push("eyes"), image);
      if (prompt.startsWith("Edit this portrait")) return (calls.push("expression"), image);
      calls.push("fill");
      return FILL;
    },
    generateJson: async (prompt) => {
      if (prompt !== partsPromptFromBrief(BRIEF)) throw new Error("unexpected JSON prompt");
      calls.push("parts");
      return replies.shift() ?? PARTS_TEXT;
    },
  };
  return { client, calls };
}

let fetches = 0;
beforeEach(() => {
  fetches = 0;
  vi.stubGlobal("fetch", () => {
    fetches += 1;
    throw new Error("network access in a test");
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const IP = { "x-real-ip": "198.51.100.9" };

function setup(partsReplies: string[] = []) {
  const gemini = fakeGemini(partsReplies);
  const ledger = new MemoryQuotaStore();
  const quota = createQuota({ store: ledger, salt: "s", limits: { perIp: { forge: 3, engine: 60, voice: 60 }, dailyUsd: 30 } });
  const jobs = new MemoryJobStore<ForgeJob>();
  const casts = new MemoryJobStore<CastRecord>();
  let clock = 1_000_000;
  const now = () => (clock += 500);
  const cast: CastDeps = { env: { SR_PLANE: "live" }, gemini: () => gemini.client, quota, store: () => casts, replay: bundledCastReplay, now };
  const forge: ForgeDeps = { env: { SR_PLANE: "live" }, gemini: () => gemini.client, quota, store: () => jobs, replay: bundledReplay, now, casts: () => casts };
  /** [forge uses counted for the IP, USD charged] */
  const spent = (): [number, number] => {
    const entries = ledger.entries();
    const uses = entries.filter(([k]) => k.includes(":forge:")).reduce((s, [, v]) => s + v, 0);
    const usd = entries.filter(([k]) => k.endsWith(":usd")).reduce((s, [, v]) => s + v, 0) / 1_000_000;
    return [uses, Math.round(usd * 1000) / 1000];
  };
  return { gemini, cast, forge, jobs, casts, spent };
}

const post = (body: unknown, headers: Record<string, string> = IP) => new Request("https://sr.test/api/forge/drafts", { method: "POST", body: JSON.stringify(body), headers });

async function newBatch(deps: CastDeps, body: unknown = { brief: BRIEF }, headers?: Record<string, string>): Promise<string> {
  const res = await handleCastPost(post(body, headers), deps);
  expect(res.status).toBe(202);
  return ((await res.json()) as { batchId: string }).batchId;
}

async function untilReady(deps: CastDeps, batchId: string, headers: Record<string, string> = IP): Promise<CastView> {
  for (let i = 0; i < 12; i++) {
    const view = (await (await handleCastGet(new Request(`https://sr.test/api/forge/drafts/${batchId}`, { headers }), deps)).json()) as CastView;
    if (view.status === "ready" || view.status === "failed") return view;
  }
  throw new Error("batch did not finish");
}

async function castOne(deps: ForgeDeps, batchId: string, index: number, headers: Record<string, string> = IP): Promise<string> {
  const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief: BRIEF, candidate: { batchId, index } }), headers }), deps);
  expect(res.status).toBe(202);
  return ((await res.json()) as { jobId: string }).jobId;
}

async function untilDone(deps: ForgeDeps, jobId: string, headers?: Record<string, string>): Promise<JobView> {
  for (let i = 0; i < 20; i++) {
    const view = (await (await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`, headers === undefined ? {} : { headers }), deps)).json()) as JobView;
    if (view.status === "done" || view.status === "failed") return view;
  }
  throw new Error("job did not finish");
}

describe("live casting batch", () => {
  it("three draft calls (draft: true), at most three parts calls, nothing paid beyond before a pick; provisional rigs validate; missing parts are named", { timeout: 60_000 }, async () => {
    const { cast, gemini, spent } = setup([PARTS_TEXT, NO_PLUME, "SECRET not json"]);
    const batchId = await newBatch(cast);
    const view = await untilReady(cast, batchId);
    expect(gemini.calls.filter((c) => c === "draft")).toHaveLength(CAST_SIZE);
    expect(gemini.calls.filter((c) => c === "parts").length).toBeLessThanOrEqual(CAST_SIZE);
    expect(gemini.calls.filter((c) => c !== "draft" && c !== "parts")).toEqual([]);
    expect(view).toMatchObject({ status: "ready", plane: "live", rerollsLeft: 2 });
    expect(view.candidates.map((c) => c.state)).toEqual(["cut", "cut", "uncut"]);
    for (const c of view.candidates.slice(0, 2)) {
      expect(validateRig(c.rig).ok).toBe(true);
      for (const layer of c.rig?.layers ?? []) expect(c.assets?.[layer.file]).toBeDefined();
      expect(c.rig?.layers.some((l) => l.variants !== undefined)).toBe(false);
    }
    expect(view.candidates[0]?.missing).toEqual([]);
    expect(view.candidates[1]?.missing).toEqual(["plume"]);
    expect(view.candidates[1]?.rig?.layers.some((l) => l.name === "plume")).toBe(false);
    expect(view.candidates[2]?.missing).toEqual(BRIEF.parts.map((p) => p.name));
    expect(view.candidates[2]?.note).toMatch(/could not be read/);
    expect(JSON.stringify(view)).not.toContain("SECRET");
    expect(JSON.stringify(view)).not.toContain("null");
    // Abandoned here: one forge use, three drafts and three parts calls in the USD ledger.
    expect(spent()).toEqual([1, Math.round((CAST_SIZE * COST_USD.imageDraft + CAST_SIZE * COST_USD.segment) * 1000) / 1000]);
  });

  it("casting a candidate continues from its exact portrait and decomposition: no portrait or parts call; casting twice is one job", { timeout: 90_000 }, async () => {
    // Only the cast candidate is cut (the others' parts are unreadable), to keep the test quick.
    const { cast, forge, gemini, jobs, casts, spent } = setup(["x", PARTS_TEXT, "x"]);
    const batchId = await newBatch(cast);
    await untilReady(cast, batchId);
    const before = gemini.calls.length;
    const jobId = await castOne(forge, batchId, 1);
    expect(await castOne(forge, batchId, 1)).toBe(jobId);
    expect(await castOne(forge, batchId, 0)).toBe(jobId);
    const started = await jobs.get(jobId);
    const cut = await casts.get(castCutId(batchId, 1));
    if (started?.portraitUrl === undefined || cut?.kind !== "cut") throw new Error("no job or cut record");
    expect(sha(await jobs.readImage(started.portraitUrl))).toBe(sha(DRAFTS[1]?.data ?? new Uint8Array()));
    expect(started.named).toEqual(cut.named);
    expect(started.status).toBe("cutting");
    const view = await untilDone(forge, jobId);
    expect(view.status).toBe("done");
    expect(view.decomposition).toBe("named");
    const after = gemini.calls.slice(before);
    expect(after).not.toContain("portrait");
    expect(after).not.toContain("draft");
    expect(after).not.toContain("parts");
    expect(after[0]).toBe("fill");
    expect(spent()[0]).toBe(1); // the batch's one forge use; casting counts none
  });

  it("re-rolls: USD only, capped at two per chain; a second re-roll of the same batch returns the first", { timeout: 60_000 }, async () => {
    const { cast, spent } = setup();
    const look = async (id: string) => (await (await handleCastGet(new Request(`https://sr.test/api/forge/drafts/${id}`, { headers: IP }), cast)).json()) as CastView;
    const first = await newBatch(cast);
    const second = await newBatch(cast, { brief: BRIEF, after: first });
    expect(second).not.toBe(first);
    expect(await newBatch(cast, { brief: BRIEF, after: first })).toBe(second);
    expect((await look(first)).rerollsLeft).toBe(0);
    expect((await look(second)).rerollsLeft).toBe(1);
    const third = await newBatch(cast, { brief: BRIEF, after: second });
    expect((await look(third)).rerollsLeft).toBe(0);
    const refused = await handleCastPost(post({ brief: BRIEF, after: third }), cast);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("quota");
    expect(spent()).toEqual([1, Math.round(3 * CAST_SIZE * (COST_USD.imageDraft + COST_USD.segment) * 1000) / 1000]); // three batches, one forge use
  });

  it("refuses a pick before the batch is ready, an unknown batch, and a malformed candidate", async () => {
    const { cast, forge } = setup();
    const batchId = await newBatch(cast);
    const early = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief: BRIEF, candidate: { batchId, index: 0 } }), headers: IP }), forge);
    expect(early.status).toBe(400);
    const unknown = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief: BRIEF, candidate: { batchId: "f".repeat(32), index: 0 } }), headers: IP }), forge);
    expect(unknown.status).toBe(400);
    const bad = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief: BRIEF, candidate: { batchId, index: 7 } }), headers: IP }), forge);
    expect(bad.status).toBe(400);
  });
});

describe("replay casting", () => {
  const REPLAY = { "x-sr-plane": "replay" };

  it("x-sr-plane: replay forces three recorded candidates on a live deploy; casting the second plays that job to done; zero fetches, no Gemini", async () => {
    let made = 0;
    const { cast, forge } = setup();
    const castDeps: CastDeps = { ...cast, gemini: () => (made++, fakeGemini([]).client) };
    const forgeDeps: ForgeDeps = { ...forge, gemini: () => (made++, fakeGemini([]).client) };
    const batchId = await newBatch(castDeps, { brief: BRIEF }, REPLAY);
    const batch = parseReplayBatchId(batchId);
    expect(batch?.slugs).toHaveLength(CAST_SIZE);
    expect(batch?.slugs[0]).toBe("sir-vacant");
    const view = (await (await handleCastGet(new Request(`https://sr.test/api/forge/drafts/${batchId}`, { headers: REPLAY }), { ...castDeps, now: () => (batch?.startedAt ?? 0) + 10_000 })).json()) as CastView;
    expect(view).toMatchObject({ status: "ready", plane: "replay" });
    expect(view.candidates.every((c) => c.state === "cut" && validateRig(c.rig).ok)).toBe(true);
    const jobId = await castOne(forgeDeps, batchId, 1, REPLAY);
    expect(jobId.startsWith(`replay_${batch?.slugs[1] ?? "?"}_`)).toBe(true);
    const done = (await (await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`, { headers: REPLAY }), { ...forgeDeps, now: () => Date.now() + 120_000 })).json()) as JobView;
    expect(done).toMatchObject({ status: "done", plane: "replay" });
    expect(made).toBe(0);
    expect(fetches).toBe(0);
  });

  it("the default cast deps serve replay on a replay deploy", async () => {
    const deps = defaultCastDeps({ SR_PLANE: "replay" });
    const res = await handleCastPost(post({ brief: BRIEF }), deps);
    expect(res.status).toBe(202);
    expect(fetches).toBe(0);
  });
});
