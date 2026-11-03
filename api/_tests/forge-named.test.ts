// cast-forge task 11 (requirement 4.4): a live brief job decomposes into the brief's own parts.
// Fake Gemini client only: global fetch is stubbed to count and throw. A brief job goes through v2
// parts to a rig whose motion passes validateRig; a v2 answer that fails twice falls back to the v1
// prompt (a done job that says so); replay is unchanged with zero fetches; and the live steps run on
// a cast character's committed files give exactly its committed replay rig (one path, not two).
import { readFileSync } from "node:fs";
import {
  PARTS_PROMPT,
  briefFromRecorded,
  decodeImage,
  parseBrief,
  partsPromptFromBrief,
  type CharacterBrief,
  type ForgeJob,
  type JobView,
} from "@sr/forge";
import { validateRig, type Rig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleForgeGet, handleForgePost, type ForgeDeps } from "../_lib/forge-api.js";
import { bundledReplay } from "../_lib/forge-replay.js";
import type { GeminiClient, GeminiImage } from "../_lib/gemini.js";
import { MemoryJobStore } from "../_lib/jobstore.js";
import { MemoryQuotaStore, createQuota } from "../_lib/quota.js";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT));
const SLUG = "sir-vacant";
const CAST = `assets/characters/cast/${SLUG}/`;
const PORTRAIT: GeminiImage = { mimeType: "image/png", data: new Uint8Array(read(`${CAST}portrait.png`)) };
const FILL: GeminiImage = { mimeType: "image/jpeg", data: new Uint8Array(read(`${CAST}fill.jpg`)) };
const PARTS_TEXT = read(`${CAST}parts.json`).toString("utf8");
const M8_PARTS = read("packages/forge/test/fixtures/m8-parts.json").toString("utf8");

interface FilePart { name: string; role: CharacterBrief["parts"][number]["role"]; follow?: string; motion?: unknown }
const PARTS_FILE = JSON.parse(PARTS_TEXT) as { version: 2; parts: FilePart[] };

/** Sir Vacant's recorded brief with its parts plan set to the decomposition's parts. */
function castBrief(motionWords: Record<string, string> = {}): CharacterBrief {
  const base = briefFromRecorded(JSON.parse(read(`${CAST}brief.json`).toString("utf8")));
  if (!base.ok) throw new Error("brief.json");
  const words = new Map(base.value.parts.map((p) => [p.name, p]));
  const parts = PARTS_FILE.parts.map((p) => {
    const motion = motionWords[p.name] ?? (p.motion === undefined ? undefined : (words.get(p.name)?.motion ?? "moves on its own"));
    return { name: p.name, role: p.role, what: words.get(p.name)?.what ?? p.name.replaceAll("_", " "), ...(motion === undefined ? {} : { motion }), ...(p.follow === undefined ? {} : { follow: p.follow }) };
  });
  const brief = parseBrief({ ...base.value, parts });
  if (!brief.ok) throw new Error(`cast brief: ${brief.errors.map((e) => e.message).join("; ")}`);
  return brief.value;
}

/** The six expression edits every live job runs after assembly (character-control). */
const EXPRESSIONS = Array.from({ length: 6 }, () => "expression");

function fake(brief: CharacterBrief, partsReplies: string[]) {
  const calls: string[] = [];
  const fills: string[] = [];
  const replies = [...partsReplies];
  const client: GeminiClient = {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async () => (calls.push("portrait"), PORTRAIT),
    // character-control: the six expression edits after assembly return the portrait unchanged (each family "skipped").
    editImage: async (_image, prompt) => (prompt.startsWith("Edit this portrait") ? (calls.push("expression"), PORTRAIT) : (calls.push("fill"), fills.push(prompt), FILL)),
    generateJson: async (prompt) => {
      if (prompt === partsPromptFromBrief(brief)) calls.push("parts:brief");
      else if (prompt === PARTS_PROMPT) calls.push("parts:v1");
      else throw new Error("unexpected JSON prompt");
      return replies.shift() ?? M8_PARTS;
    },
  };
  return { client, calls, fills };
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

function setup(brief: CharacterBrief, partsReplies: string[]) {
  const gemini = fake(brief, partsReplies);
  const store = new MemoryJobStore<ForgeJob>();
  let clock = 1_000_000;
  const deps: ForgeDeps = {
    env: { SR_PLANE: "live" },
    gemini: () => gemini.client,
    quota: createQuota({ store: new MemoryQuotaStore(), salt: "s", limits: { perIp: { forge: 3, engine: 60, voice: 60 }, dailyUsd: 5 } }),
    store: () => store,
    replay: bundledReplay,
    now: () => (clock += 500),
  };
  return { deps, store, gemini };
}

async function forge(deps: ForgeDeps, brief: CharacterBrief): Promise<{ view: JobView; views: JobView[]; jobId: string }> {
  const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief }), headers: { "x-real-ip": "198.51.100.7" } }), deps);
  expect(res.status).toBe(202);
  const { jobId } = (await res.json()) as { jobId: string };
  const views: JobView[] = [];
  for (let i = 0; i < 16; i++) {
    const view = (await (await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`), deps)).json()) as JobView;
    views.push(view);
    if (view.status === "done" || view.status === "failed") return { view, views, jobId };
  }
  throw new Error("job did not finish");
}

describe("live brief job: named parts", () => {
  it("v2 parts -> rig: motion clamped or taken from the brief's words always passes validateRig", { timeout: 60_000 }, async () => {
    const brief = castBrief({ pauldron_r: "Rise and settle with the breathing", tag_2: "Swing and tick like pendulums" });
    // The model's answer: the plume's frequency and a tag's amplitude out of range, the right
    // pauldron and the middle tag with no motion, and one part the brief does not plan.
    const answer = JSON.parse(PARTS_TEXT) as { parts: Record<string, unknown>[] };
    for (const p of answer.parts) {
      if (p.name === "plume") p.motion = { float: { amp: [0, 0], freq: 9, rot_deg: 3 } };
      if (p.name === "tag_1") p.motion = { float: { amp: [400, -2], freq: 0.42, rot_deg: 40 } };
      if (p.name === "pauldron_r" || p.name === "tag_2") delete p.motion;
    }
    answer.parts.push({ name: "stray", role: "float", box_2d: [1, 1, 50, 50], poly: [[1, 1], [1, 50], [50, 50]] });
    const { deps, gemini } = setup(brief, [JSON.stringify(answer)]);
    const { view } = await forge(deps, brief);
    expect(view.status).toBe("done");
    expect(view.decomposition).toBe("named");
    expect(gemini.calls).toEqual(["portrait", "parts:brief", "fill", ...EXPRESSIONS]);
    const rig = validateRig(view.rig);
    expect(rig.ok).toBe(true);
    if (!rig.ok) return;
    const layer = (name: string) => rig.value.layers.find((l) => l.name === name);
    expect(rig.value.name).toBe(brief.name);
    expect(layer("stray")).toBeUndefined();
    for (const name of brief.parts.map((p) => p.name)) expect(layer(name)).toBeDefined();
    expect(layer("plume")?.motion?.float?.freq).toBe(2);
    expect(layer("tag_1")?.motion?.float).toMatchObject({ amp: [50, 2], rot_deg: 15 });
    expect(layer("pauldron_r")?.motion?.float).toMatchObject({ amp: [1.5, 4] });
    expect(layer("tag_2")?.motion?.float).toMatchObject({ amp: [0, 0], rot_deg: 4 });
    expect(layer("bevor")).toMatchObject({ kind: "jaw", drop: 0.02 });
    // The fill edit names the lifted parts the edit paints (fill "extend" parts are not asked for).
    expect(gemini.fills).toEqual([
      "Same image, same framing and lighting. Remove the tag 1, tag 2, tag 3, chain, pauldron r, pauldron l, Tall black horsehair plume on the crest and paint the plausible surface that would be behind them. Change nothing else.",
    ]);
  });

  it("a v2 answer that fails twice falls back to the v1 prompt: done, and the job says so", { timeout: 60_000 }, async () => {
    const brief = castBrief();
    const badPoly = JSON.stringify({ version: 2, parts: [{ name: "head", role: "head", box_2d: [1, 1, 2, 2], poly: [[1, 1]] }] });
    const { deps, gemini, store } = setup(brief, ["SECRET not json", badPoly, M8_PARTS]);
    const { view, views, jobId } = await forge(deps, brief);
    expect(view.status).toBe("done");
    expect(view.decomposition).toBe("fallback");
    expect(views.map((v) => v.decomposition)).toEqual([undefined, ...views.slice(1).map(() => "fallback")]);
    expect(views.length).toBe(5 + EXPRESSIONS.length);
    expect(gemini.calls).toEqual(["portrait", "parts:brief", "parts:brief", "parts:v1", "fill", ...EXPRESSIONS]);
    expect(validateRig(view.rig).ok).toBe(true);
    expect(JSON.stringify(views)).not.toContain("SECRET");
    expect((await store.get(jobId))?.named).toBeUndefined();
  });

  it("one failed v2 answer is re-asked, and the second answer is used", { timeout: 60_000 }, async () => {
    const brief = castBrief();
    const { deps, gemini } = setup(brief, ["{", PARTS_TEXT]);
    const { view } = await forge(deps, brief);
    expect(view.decomposition).toBe("named");
    expect(gemini.calls).toEqual(["portrait", "parts:brief", "parts:brief", "fill", ...EXPRESSIONS]);
  });
});

describe("replay plane", () => {
  it("a brief job on replay is the recorded cast job: no Gemini, no decomposition field, zero fetches", async () => {
    const brief = castBrief();
    let made = 0;
    const deps: ForgeDeps = { ...setup(brief, []).deps, env: { SR_PLANE: "replay" }, gemini: () => (made++, fake(brief, []).client) };
    const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "brief", brief }) }), deps);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(jobId).toMatch(new RegExp(`^replay_${SLUG}_`));
    const view = (await (await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`), deps)).json()) as JobView;
    expect(view.plane).toBe("replay");
    expect(view.decomposition).toBeUndefined();
    expect(made).toBe(0);
    expect(fetches).toBe(0);
  });
});

describe("offline proof: the product path is the overnight path", () => {
  it(`the live steps on ${SLUG}'s committed files give its committed replay rig, pixel for pixel`, { timeout: 60_000 }, async () => {
    const brief = castBrief();
    const { deps, store } = setup(brief, [PARTS_TEXT]);
    const { view } = await forge(deps, brief);
    const replay = JSON.parse(read(`assets/replay/forge/${SLUG}/job.json`).toString("utf8")) as { rig: Rig };
    // The live job adds colour regions after assembly, and the recorded rig carries the offline
    // retrofit's expression faces (character-control task 5, from Codex edits this fake does not
    // make); the cut itself is the recorded one.
    const strip = (rig: Rig | undefined) => (rig === undefined ? undefined : { ...rig, id: "", layers: rig.layers.map((layer) => Object.fromEntries(Object.entries(layer).filter(([key]) => key !== "regions" && key !== "variants"))) });
    expect(strip(view.rig)).toEqual(strip(replay.rig));
    for (const layer of replay.rig.layers) {
      const url = view.assets?.[layer.file];
      if (url === undefined) throw new Error(`no live ${layer.file}`);
      const live = decodeImage(await store.readImage(url));
      const recorded = decodeImage(new Uint8Array(read(`assets/replay/forge/${SLUG}/${layer.file}`)));
      if (!live.ok || !recorded.ok) throw new Error(layer.file);
      expect(Buffer.from(live.value.data).equals(Buffer.from(recorded.value.data)), layer.file).toBe(true);
    }
  });
});
