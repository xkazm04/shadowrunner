// POST /api/forge and GET /api/forge/:jobId with a fake Gemini client (task 7.2). No test reaches
// the network: fetch is stubbed to throw, and every paid call goes through the injected fake.
import { readFileSync } from "node:fs";
import { PARTS_PROMPT, type ForgeJob, type JobView } from "@sr/forge";
import { validateRig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STEP_LEASE_MS, handleForgeGet, handleForgePost, type ForgeDeps, type ForgeReplay } from "../_lib/forge-api.js";
import { GeminiError, type GeminiClient, type GeminiImage } from "../_lib/gemini.js";
import { MemoryJobStore } from "../_lib/jobstore.js";
import { MemoryQuotaStore, createQuota } from "../_lib/quota.js";

const ROOT = new URL("../../", import.meta.url);
const PORTRAIT: GeminiImage = { mimeType: "image/png", data: new Uint8Array(readFileSync(new URL("assets/characters/malakor/rig/portrait.png", ROOT))) };
const M8_PARTS = readFileSync(new URL("packages/forge/test/fixtures/m8-parts.json", ROOT), "utf8");
const M8_RAW = readFileSync(new URL("packages/forge/test/fixtures/m8-parts.raw.txt", ROOT), "utf8");
const SMALL_PNG: GeminiImage = { mimeType: "image/png", data: new Uint8Array(readFileSync(new URL("assets/characters/malakor/rig/eye_l.png", ROOT))) };
const SECRET = "SECRET-upstream-body-AIza";
const STATUS_ORDER = ["queued", "portrait", "segmenting", "cutting", "filling", "done"];

interface FakeScript {
  partsReplies?: string[];
  likeness?: string;
  edit?: (prompt: string) => Promise<GeminiImage>;
  portrait?: () => Promise<GeminiImage>;
}

function fakeGemini(script: FakeScript = {}) {
  const calls: string[] = [];
  const parts = [...(script.partsReplies ?? [M8_PARTS])];
  const client: GeminiClient = {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async (_prompt, options) => {
      calls.push(options?.draft === true ? "generateImage:draft" : "generateImage"); // requirement 2.1: final model only
      return script.portrait ? script.portrait() : PORTRAIT;
    },
    editImage: async (_image, prompt) => {
      calls.push(prompt.startsWith("Same image") ? "fill" : "restyle");
      return script.edit ? script.edit(prompt) : PORTRAIT;
    },
    generateJson: async (prompt) => {
      if (prompt === PARTS_PROMPT) {
        calls.push("parts");
        return parts.shift() ?? M8_PARTS;
      }
      calls.push("likeness");
      return script.likeness ?? '{"real_person":false,"unsafe":false,"reason":"painting"}';
    },
  };
  return { client, calls };
}

function setup(script: FakeScript = {}, options: { perIp?: number; env?: Record<string, string> } = {}) {
  const gemini = fakeGemini(script);
  const store = new MemoryJobStore<ForgeJob>();
  const quotaStore = new MemoryQuotaStore();
  const replayCalls: string[] = [];
  const replay: ForgeReplay = {
    post: async () => (replayCalls.push("post"), Response.json({ jobId: "replay-job" }, { status: 202 })),
    get: async (id) => (replayCalls.push(`get ${id}`), Response.json({ jobId: id, status: "queued", plane: "replay" })),
  };
  let clock = 1_000_000;
  let geminiMade = 0;
  const deps: ForgeDeps = {
    env: { SR_PLANE: "live", ...options.env },
    gemini: () => (geminiMade++, gemini.client),
    quota: createQuota({ store: quotaStore, salt: "s", limits: { perIp: { forge: options.perIp ?? 3, engine: 60, voice: 60 }, dailyUsd: 5 } }),
    store: () => store,
    replay,
    now: () => (clock += 500),
  };
  return { deps, gemini, store, quotaStore, replayCalls, geminiMade: () => geminiMade };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://sr.test/api/forge", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-real-ip": "198.51.100.4", ...headers } });
const get = (jobId: string, headers: Record<string, string> = {}) => new Request(`https://sr.test/api/forge/${jobId}`, { headers: { "x-real-ip": "198.51.100.4", ...headers } });

async function runToEnd(deps: ForgeDeps, jobId: string): Promise<{ view: JobView; statuses: string[]; bodies: string[] }> {
  const statuses: string[] = [];
  const bodies: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const res = await handleForgeGet(get(jobId), deps);
    const text = await res.text();
    bodies.push(text);
    const view = JSON.parse(text) as JobView;
    statuses.push(view.status);
    if (view.status === "done" || view.status === "failed") return { view, statuses, bodies };
  }
  throw new Error("job did not finish");
}

async function start(deps: ForgeDeps, body: unknown): Promise<string> {
  const res = await handleForgePost(post(body), deps);
  expect(res.status).toBe(202);
  return ((await res.json()) as { jobId: string }).jobId;
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network access in a test");
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("forge happy path", () => {
  it("prompt -> portrait -> parts -> fill edit -> cut -> done with a valid rig", { timeout: 60_000 }, async () => {
    const { deps, gemini } = setup();
    const jobId = await start(deps, { mode: "prompt", prompt: "Arch-Lich Malakor" });
    const { view, statuses } = await runToEnd(deps, jobId);
    expect(statuses).toEqual(["cutting", "filling", "done"]);
    expect(gemini.calls).toEqual(["generateImage", "parts", "fill"]);
    expect(view.plane).toBe("live");
    expect(view.fill).toBe("edit");
    const rig = validateRig(view.rig);
    expect(rig.ok).toBe(true);
    if (!rig.ok) return;
    expect(rig.value.layers.length).toBeGreaterThanOrEqual(7);
    for (const layer of rig.value.layers) expect(view.assets?.[layer.file]).toMatch(/^data:image\/png;base64,/);
    expect(view.portraitUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("the fill prompt names exactly the FILL_PARTS the portrait has", { timeout: 60_000 }, async () => {
    const prompts: string[] = [];
    const { deps } = setup({ edit: async (p) => (prompts.push(p), PORTRAIT) });
    await runToEnd(deps, await start(deps, { mode: "prompt", prompt: "lich" }));
    expect(prompts).toEqual([
      "Same image, same framing and lighting. Remove the eye_l, eye_r, monocle, jaw and paint the plausible surface that would be behind them. Change nothing else.",
    ]);
  });

  it("a failed or wrong-size fill edit falls back to blurExtend and still finishes", { timeout: 60_000 }, async () => {
    for (const edit of [() => Promise.reject(new GeminiError("timeout")), () => Promise.resolve(SMALL_PNG)]) {
      const { deps } = setup({ edit });
      const { view } = await runToEnd(deps, await start(deps, { mode: "prompt", prompt: "lich" }));
      expect(view.status).toBe("done");
      expect(view.fill).toBe("fallback");
    }
  });
});

describe("forge failures", () => {
  it("quota is refused before any paid call", async () => {
    const { deps, gemini, geminiMade } = setup({}, { perIp: 0 });
    const res = await handleForgePost(post({ mode: "prompt", prompt: "lich" }), deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "quota", message: expect.any(String) } });
    expect(gemini.calls).toEqual([]);
    expect(geminiMade()).toBe(0);
  });

  it("an upload of a real person fails with refused_likeness and is never restyled", async () => {
    const { deps, gemini } = setup({ likeness: '{"real_person":true,"unsafe":false,"reason":"photo"}' });
    const jobId = await start(deps, { mode: "image", imageBase64: Buffer.from(PORTRAIT.data).toString("base64") });
    const { view } = await runToEnd(deps, jobId);
    expect(view.error?.code).toBe("refused_likeness");
    expect(gemini.calls).toEqual(["likeness"]);
  });

  it("unsafe uploads fail with refused_content; a clean upload is restyled", { timeout: 60_000 }, async () => {
    const bad = setup({ likeness: '{"real_person":false,"unsafe":true,"reason":"gore"}' });
    const upload = { mode: "image", imageBase64: Buffer.from(PORTRAIT.data).toString("base64") };
    expect((await runToEnd(bad.deps, await start(bad.deps, upload))).view.error?.code).toBe("refused_content");
    const good = setup();
    const { statuses } = await runToEnd(good.deps, await start(good.deps, upload));
    expect(statuses).toEqual(["segmenting", "cutting", "filling", "done"]);
    expect(good.gemini.calls).toEqual(["likeness", "restyle", "parts", "fill"]);
  });

  it("the recorded malformed parts reply is re-asked once, then accepted", { timeout: 60_000 }, async () => {
    const { deps, gemini } = setup({ partsReplies: [M8_RAW, M8_PARTS] });
    const { view, statuses } = await runToEnd(deps, await start(deps, { mode: "prompt", prompt: "lich" }));
    expect(view.status).toBe("done");
    expect(statuses[0]).toBe("segmenting");
    expect(gemini.calls.filter((c) => c === "parts")).toHaveLength(2);
  });

  it("malformed parts twice, or well-formed garbage once, fails with upstream", async () => {
    for (const replies of [[M8_RAW, `${SECRET} not json`], ['[{"name":"jaw","box_2d":[1,2,3,4],"poly":[[1,2],[3,4],[5,6]]}]']]) {
      const { deps, gemini } = setup({ partsReplies: replies });
      const { view, bodies } = await runToEnd(deps, await start(deps, { mode: "prompt", prompt: "lich" }));
      expect(view.error?.code).toBe("upstream");
      expect(gemini.calls.filter((c) => c === "parts")).toHaveLength(replies.length);
      expect(bodies.join("")).not.toContain(SECRET);
    }
  });

  it("no secret or raw upstream text reaches a response", async () => {
    const { deps } = setup({ portrait: () => Promise.reject(new Error(`HTTP 400 ${SECRET}`)) });
    const res = await handleForgePost(post({ mode: "prompt", prompt: "lich" }), deps);
    const { jobId } = (await res.json()) as { jobId: string };
    const { view, bodies } = await runToEnd(deps, jobId);
    expect(view.error).toEqual({ code: "upstream", message: "The forge failed. Try again." });
    expect(bodies.join("")).not.toContain(SECRET);
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).not.toContain(SECRET);
  });

  it("a RangeError inside a step (plate/portrait mismatch) becomes upstream, never a raw error", async () => {
    const { deps, store } = setup();
    const jobId = await start(deps, { mode: "prompt", prompt: "lich" });
    const job = await store.get(jobId);
    if (!job) throw new Error("no job");
    await store.put({ ...job, status: "filling", parts: JSON.parse(M8_PARTS) as ForgeJob["parts"], fill: "edit", plateUrl: "not-a-data-url" });
    const { view, bodies } = await runToEnd(deps, jobId);
    expect(view.error).toEqual({ code: "upstream", message: "The forge failed. Try again." });
    expect(bodies.join("")).not.toMatch(/RangeError|readImage/);
  });

  it.each([
    ["not JSON", "{"],
    ["blank prompt", { mode: "prompt", prompt: " " }],
    ["a GIF upload", { mode: "image", imageBase64: Buffer.from("GIF89a....").toString("base64") }],
  ])("%s -> 400 bad_input before quota", async (_label, body) => {
    const { deps, quotaStore } = setup();
    const res = await handleForgePost(post(body), deps);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_input");
    expect(quotaStore.entries()).toEqual([]);
  });

  it("unknown or malformed job ids", async () => {
    const { deps } = setup();
    expect((await handleForgeGet(get("0123456789abcdef0123"), deps)).status).toBe(404);
    expect((await handleForgeGet(get("..%2F..%2Fetc"), deps)).status).toBe(400);
  });

  it("a GET inside another GET's step lease does not run the step again", async () => {
    const { deps, store, gemini } = setup();
    const jobId = await start(deps, { mode: "prompt", prompt: "lich" });
    const job = await store.get(jobId);
    if (!job) throw new Error("no job");
    await store.put({ ...job, stepStartedAt: deps.now() + STEP_LEASE_MS / 2 });
    const view = (await (await handleForgeGet(get(jobId), deps)).json()) as JobView;
    expect(view.status).toBe("segmenting");
    expect(gemini.calls).toEqual(["generateImage"]);
  });
});

describe("planes", () => {
  it("x-sr-plane: replay forces replay on a live deploy: no Gemini, no quota, no fetch", async () => {
    const { deps, replayCalls, geminiMade, quotaStore } = setup();
    const res = await handleForgePost(post({ mode: "prompt", prompt: "lich" }, { "x-sr-plane": "replay" }), deps);
    expect(res.status).toBe(202);
    await handleForgeGet(get("replay-job", { "x-sr-plane": "replay" }), deps);
    expect(replayCalls).toEqual(["post", "get replay-job"]);
    expect(geminiMade()).toBe(0);
    expect(quotaStore.entries()).toEqual([]);
  });

  it("the header cannot turn a replay deploy live", async () => {
    const { deps, replayCalls, geminiMade } = setup({}, { env: { SR_PLANE: "replay" } });
    await handleForgePost(post({ mode: "prompt", prompt: "lich" }, { "x-sr-plane": "live" }), deps);
    expect(replayCalls).toEqual(["post"]);
    expect(geminiMade()).toBe(0);
  });

  it("statuses only move forward", { timeout: 60_000 }, async () => {
    const { deps } = setup();
    const { statuses } = await runToEnd(deps, await start(deps, { mode: "prompt", prompt: "lich" }));
    const ranks = statuses.map((s) => STATUS_ORDER.indexOf(s));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
