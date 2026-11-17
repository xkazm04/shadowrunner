// forgeMachine.ts against today's writers: every record startJob, runStep and castJobFrom leave
// satisfies jobShapeError and round-trips parseForgeJob, so in-flight 24 h records survive the
// stricter parser. Fake Gemini and the memory store only; global fetch is stubbed to throw.
import { readFileSync } from "node:fs";
import {
  PARTS_PROMPT,
  briefFromRecorded,
  castCutId,
  jobShapeError,
  parseBrief,
  parseForgeJob,
  parseParts,
  partsPromptFromBrief,
  type CastBatch,
  type CastRecord,
  type CharacterBrief,
  type ForgeJob,
} from "@sr/forge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { castJobFrom } from "../_lib/forge-cast.js";
import { runStep, startJob, uploadMime, type StepContext } from "../_lib/forge-steps.js";
import type { GeminiClient, GeminiImage } from "../_lib/gemini.js";
import { MemoryJobStore } from "../_lib/jobstore.js";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT));
const CAST = "assets/characters/cast/sir-vacant/";
const MALAKOR: GeminiImage = { mimeType: "image/png", data: new Uint8Array(read("assets/characters/malakor/rig/portrait.png")) };
const VACANT: GeminiImage = { mimeType: "image/png", data: new Uint8Array(read(`${CAST}portrait.png`)) };
const M8_PARTS = read("packages/forge/test/fixtures/m8-parts.json").toString("utf8");
const PARTS_TEXT = read(`${CAST}parts.json`).toString("utf8");

interface FilePart { name: string; role: CharacterBrief["parts"][number]["role"]; follow?: string; motion?: unknown }
const PARTS_FILE = JSON.parse(PARTS_TEXT) as { version: 2; parts: FilePart[] };

/** Sir Vacant's recorded brief with its parts plan set to the decomposition's parts. */
function castBrief(): CharacterBrief {
  const recorded = briefFromRecorded(JSON.parse(read(`${CAST}brief.json`).toString("utf8")));
  if (!recorded.ok) throw new Error("brief.json");
  const words = new Map(recorded.value.parts.map((p) => [p.name, p]));
  const parts = PARTS_FILE.parts.map((p) => ({
    name: p.name,
    role: p.role,
    what: words.get(p.name)?.what ?? p.name.replaceAll("_", " "),
    ...(p.motion === undefined ? {} : { motion: words.get(p.name)?.motion ?? "moves on its own" }),
    ...(p.follow === undefined ? {} : { follow: p.follow }),
  }));
  const brief = parseBrief({ ...recorded.value, parts });
  if (!brief.ok) throw new Error("cast brief");
  return brief.value;
}
const BRIEF = castBrief();

function fakeGemini(portrait: GeminiImage): GeminiClient {
  return {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async () => portrait,
    editImage: async (image, prompt) => (prompt.startsWith("Edit this portrait") ? image : portrait),
    generateJson: async (prompt) => {
      if (prompt === PARTS_PROMPT) return M8_PARTS;
      if (prompt === partsPromptFromBrief(BRIEF)) return PARTS_TEXT;
      return '{"real_person":false,"unsafe":false,"reason":"painting"}';
    },
  };
}

function context(portrait: GeminiImage, store: MemoryJobStore<ForgeJob>): StepContext {
  let clock = 1_000_000;
  return { gemini: fakeGemini(portrait), store, charge: async () => true, now: () => (clock += 500) };
}

/** The record as the store would read it back: whole, and equal to what was written. */
function expectStorable(job: ForgeJob, at: string): void {
  expect(jobShapeError(job), at).toBeUndefined();
  expect(parseForgeJob(JSON.stringify(job)), at).toEqual(job);
}

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

describe("today's writers satisfy the machine's invariants", () => {
  it.each([
    ["prompt", MALAKOR],
    ["image", MALAKOR],
    ["brief", VACANT],
  ] as const)("a %s job, from startJob through every runStep to done", { timeout: 90_000 }, async (mode, portrait) => {
    const store = new MemoryJobStore<ForgeJob>();
    const ctx = context(portrait, store);
    const job: ForgeJob = { jobId: `machine-${mode}-job`, plane: "live", mode, status: "queued", createdAt: 1 };
    if (mode === "prompt") job.prompt = "Arch-Lich Malakor";
    if (mode === "brief") job.brief = BRIEF;
    expectStorable(job, "queued");
    const mime = uploadMime(portrait.data);
    const upload = mode === "image" && mime !== undefined ? { bytes: portrait.data, mime } : undefined;
    let current = await startJob(job, upload, ctx);
    expectStorable(current, `start -> ${current.status}`);
    const seen: string[] = [current.status];
    for (let i = 0; i < 20 && current.status !== "done" && current.status !== "failed"; i++) {
      current = await runStep(current, ctx);
      expectStorable(current, `step ${i} -> ${current.status}`);
      seen.push(current.status);
    }
    expect(current.status, seen.join(" ")).toBe("done");
  });

  it("the job castJobFrom builds, from a cut slot and from an uncut one", async () => {
    const casts = new MemoryJobStore<CastRecord>();
    const jobs = new MemoryJobStore<ForgeJob>();
    const url = await casts.putImage("castbatch0001", "d0.png", { bytes: VACANT.data, contentType: "image/png" });
    const slot = { portraitUrl: url, portraitMime: "image/png" as const, missing: [], empty: [], warnings: [] };
    const batch: CastBatch = { jobId: "castbatch0001", kind: "batch", plane: "live", status: "ready", createdAt: 1, brief: BRIEF, round: 0, slots: [{ ...slot, state: "cut" }, { ...slot, state: "uncut" }] };
    await casts.put(batch);
    const named = parseParts(JSON.parse(PARTS_TEXT));
    if (!named.ok || named.value.named === undefined) throw new Error("parts.json");
    await casts.put({ jobId: castCutId(batch.jobId, 0), kind: "cut", named: { version: 2, parts: named.value.named } });
    const cut = await jobs.get(await castJobFrom({ batchId: batch.jobId, index: 0 }, casts, jobs, 5));
    expect(cut?.status).toBe("cutting");
    if (cut !== undefined) expectStorable(cut, "cast, cut slot");
    await casts.put(batch); // a second cast of the same batch returns the first job; reset its link
    const uncutJobs = new MemoryJobStore<ForgeJob>();
    const uncut = await uncutJobs.get(await castJobFrom({ batchId: batch.jobId, index: 1 }, casts, uncutJobs, 5));
    expect(uncut?.status).toBe("segmenting");
    if (uncut !== undefined) expectStorable(uncut, "cast, uncut slot");
  });
});
