// cast-forge task 10 (requirement 4.1, 4.3): POST /api/forge/brief on both planes, and POST
// /api/forge {mode: "brief"}. No test reaches the network: global fetch is stubbed to throw, the
// live brief call goes through an injected fake, and replay is proven to make zero fetches.
import { readFileSync } from "node:fs";
import { BRIEF_PROMPT, BRIEF_SCHEMA, portraitPromptFromBrief, type BriefResponse, type CharacterBrief, type ForgeJob } from "@sr/forge";
import { DEFAULT_ENGINE_MODEL, type FetchLike } from "@sr/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBriefDeps, handleBriefPost, type BriefDeps } from "../_lib/forge-brief.js";
import { handleForgePost, type ForgeDeps } from "../_lib/forge-api.js";
import { bundledReplay, pickJob, type ReplayJob } from "../_lib/forge-replay.js";
import type { GeminiClient } from "../_lib/gemini.js";
import { MemoryJobStore } from "../_lib/jobstore.js";
import { createQuota, MemoryQuotaStore, type QuotaKind } from "../_lib/quota.js";

const LIVE = { SR_PLANE: "live", ANTHROPIC_API_KEY: "sk-test-not-real" };
const TALLY = "a spooky census guy that counts everyone in chat";
const ROOT = new URL("../../", import.meta.url);
const PORTRAIT = new Uint8Array(readFileSync(new URL("assets/characters/malakor/rig/portrait.png", ROOT)));

const VALID: CharacterBrief = {
  name: "Brine",
  one_line_request: "an iron diving helmet",
  archetype: "Drowned diver",
  persona_hook: "Hums shanties.",
  accent_hex: "#38c8ff",
  silhouette: "A round helmet.",
  parts: [
    { name: "helmet", role: "head", what: "iron helmet" },
    { name: "jaw", role: "jaw", what: "faceplate lip" },
    { name: "eye_l", role: "eye_l", what: "porthole" },
    { name: "eye_r", role: "eye_r", what: "porthole" },
    { name: "hose", role: "float", what: "air hose", motion: "drifts" },
    { name: "suit", role: "torso", what: "canvas suit" },
  ],
  style: { name: "Low-poly 3D", why: "Planes cut clean." },
  portrait_prompt: "Low-poly planes: an iron diving helmet.",
};

let fetches = 0;
beforeEach(() => {
  fetches = 0;
  vi.stubGlobal("fetch", () => {
    fetches += 1;
    throw new Error("network access in a test");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fake Messages API that answers each call with the next text (the last one repeats). */
function messages(...texts: string[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const text = texts[Math.min(bodies.length - 1, texts.length - 1)] ?? "";
    const stop = text === "REFUSE" ? "refusal" : "end_turn";
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ content: [{ type: "text", text }], stop_reason: stop })) });
  };
  return { fetch, bodies };
}

function deps(env: Record<string, string>, fetch: FetchLike, perIp = 3) {
  const charges: QuotaKind[] = [];
  const inner = createQuota({ store: new MemoryQuotaStore(), salt: "s", limits: { perIp: { forge: perIp, engine: 60, voice: 60 }, dailyUsd: 5 } });
  const d: BriefDeps = {
    ...defaultBriefDeps(env),
    fetch,
    quota: { checkAndCharge: (ip, kind, usd) => (charges.push(kind), inner.checkAndCharge(ip, kind, usd)) },
  };
  return { deps: d, charges };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://sr.test/api/forge/brief", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-real-ip": "198.51.100.9", ...headers } });

const noFetch: FetchLike = () => {
  fetches += 1;
  throw new Error("the replay brief must not fetch");
};

describe("POST /api/forge/brief, replay plane", () => {
  it("returns the recorded brief whose one_line_request matches, ignoring case and spacing, with zero fetches", async () => {
    const { deps: d, charges } = deps({}, noFetch);
    const res = await handleBriefPost(post({ request: `  ${TALLY.toUpperCase().replace(/ /g, "   ")} ` }), d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BriefResponse;
    expect(body.plane).toBe("replay");
    expect(body.brief.name).toBe("The Tallyman");
    expect(body.brief.parts.filter((p) => p.role === "eye")).toHaveLength(6);
    expect(fetches).toBe(0);
    expect(charges).toEqual([]);
  });

  it("answers any other request with the first cast brief", async () => {
    const res = await handleBriefPost(post({ request: "a vampire accountant" }), deps({}, noFetch).deps);
    expect(((await res.json()) as BriefResponse).brief.name).toBe("Auntie Asp, Keeper of the Stone Stacks");
    expect(fetches).toBe(0);
  });

  it("x-sr-plane: replay forces the recorded brief on a live deploy", async () => {
    const { deps: d, charges } = deps(LIVE, noFetch);
    const res = await handleBriefPost(post({ request: TALLY }, { "x-sr-plane": "replay" }), d);
    expect(((await res.json()) as BriefResponse).plane).toBe("replay");
    expect(fetches).toBe(0);
    expect(charges).toEqual([]);
  });

  it("refuses a blank request and a GET with bad_input", async () => {
    const blank = await handleBriefPost(post({ request: "  " }), deps({}, noFetch).deps);
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as { error: { code: string } }).error.code).toBe("bad_input");
    const getReq = await handleBriefPost(new Request("https://sr.test/api/forge/brief"), deps({}, noFetch).deps);
    expect(getReq.status).toBe(405);
  });
});

describe("POST /api/forge/brief, live plane", () => {
  it("asks the engine's model once with the exact prompt and schema, charging the forge quota", async () => {
    const fake = messages(JSON.stringify(VALID));
    const { deps: d, charges } = deps(LIVE, fake.fetch);
    const res = await handleBriefPost(post({ request: "an iron diving helmet that hums" }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brief: VALID, plane: "live" });
    expect(fake.bodies).toHaveLength(1);
    const sent = fake.bodies[0] as { model: string; messages: { content: string }[]; output_config: { format: { schema: unknown } } };
    expect(sent.model).toBe(DEFAULT_ENGINE_MODEL);
    expect(sent.messages[0]?.content).toBe(BRIEF_PROMPT("an iron diving helmet that hums"));
    expect(sent.output_config.format.schema).toEqual(BRIEF_SCHEMA);
    expect(charges).toEqual(["forge"]);
  });

  it("SR_BRIEF_MODEL picks the model", async () => {
    const fake = messages(JSON.stringify(VALID));
    await handleBriefPost(post({ request: "a ghost" }), deps({ ...LIVE, SR_BRIEF_MODEL: " claude-sonnet-test " }, fake.fetch).deps);
    expect((fake.bodies[0] as { model: string }).model).toBe("claude-sonnet-test");
  });

  it("asks once more after an invalid answer", async () => {
    const fake = messages("```json not json", JSON.stringify(VALID));
    const res = await handleBriefPost(post({ request: "a ghost" }), deps(LIVE, fake.fetch).deps);
    expect(res.status).toBe(200);
    expect(fake.bodies).toHaveLength(2);
  });

  it("two invalid answers are upstream, and no upstream text reaches the client", async () => {
    const fake = messages("SECRET-upstream-text", JSON.stringify({ ...VALID, accent_hex: "SECRET" }));
    const res = await handleBriefPost(post({ request: "a ghost" }), deps(LIVE, fake.fetch).deps);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("upstream");
    expect(text).not.toContain("SECRET");
    expect(fake.bodies).toHaveLength(2);
  });

  it("a refusal is refused_content; no key is upstream; a spent quota is 429 with no call", async () => {
    const refused = await handleBriefPost(post({ request: "a ghost" }), deps(LIVE, messages("REFUSE").fetch).deps);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("refused_content");
    const keyless = await handleBriefPost(post({ request: "a ghost" }), deps({ SR_PLANE: "live" }, noFetch).deps);
    expect(keyless.status).toBe(502);
    const fake = messages(JSON.stringify(VALID));
    const spent = await handleBriefPost(post({ request: "a ghost" }), deps(LIVE, fake.fetch, 0).deps);
    expect(spent.status).toBe(429);
    expect(fake.bodies).toHaveLength(0);
  });
});

describe("POST /api/forge {mode: brief}", () => {
  it("live: the portrait is drawn from portraitPromptFromBrief and the job keeps the brief", async () => {
    const prompts: string[] = [];
    const gemini: GeminiClient = {
      models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
      generateImage: async (prompt) => (prompts.push(prompt), { mimeType: "image/png", data: PORTRAIT }),
      editImage: async () => ({ mimeType: "image/png", data: PORTRAIT }),
      generateJson: async () => "[]",
    };
    const store = new MemoryJobStore<ForgeJob>();
    const d: ForgeDeps = {
      env: { SR_PLANE: "live" },
      gemini: () => gemini,
      quota: createQuota({ store: new MemoryQuotaStore(), salt: "s" }),
      store: () => store,
      replay: bundledReplay,
      now: () => 1_000_000,
    };
    const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief: VALID }) }), d);
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(prompts).toEqual([portraitPromptFromBrief(VALID)]);
    const job = await store.get(jobId);
    expect(job?.mode).toBe("brief");
    expect(job?.brief).toEqual(VALID);
    expect(job?.status).toBe("segmenting");
  });

  it("refuses an invalid brief with bad_input", async () => {
    const res = await handleForgePost(
      new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief: { ...VALID, parts: [] } }), headers: { "x-sr-plane": "replay" } }),
      { env: {}, gemini: () => { throw new Error("no gemini"); }, quota: createQuota({ store: new MemoryQuotaStore(), salt: "s" }), store: () => new MemoryJobStore<ForgeJob>(), replay: bundledReplay, now: () => 1 },
    );
    expect(res.status).toBe(400);
  });

  it("replay: a cast member's brief starts that member's recorded job, any other brief the hash pick, zero fetches", async () => {
    const briefs = deps({}, noFetch).deps.recorded();
    const cardia = briefs.find((b) => b.name.startsWith("Saint Cardia"));
    if (cardia === undefined) throw new Error("no saint-cardia brief");
    const res = await bundledReplay.post(JSON.stringify({ mode: "brief", brief: { ...cardia, name: "Renamed by the streamer" } }), 5000);
    expect(res.status).toBe(202);
    expect(((await res.json()) as { jobId: string }).jobId).toMatch(/^replay_saint-cardia_/);
    const other = await bundledReplay.post(JSON.stringify({ mode: "brief", brief: VALID }), 5000);
    expect(other.status).toBe(202);
    expect(fetches).toBe(0);
    const jobs = [{ slug: "a" }, { slug: "b", prompt: "AN IRON  diving helmet" }] as Pick<ReplayJob, "slug" | "prompt">[];
    expect(pickJob({ mode: "brief", brief: VALID }, jobs)?.slug).toBe("b");
  });
});
