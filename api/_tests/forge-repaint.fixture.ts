// forge-creator S2: a live forge run to `done` against a fake Gemini (the Malakor portrait, the m8
// parts), for the repaint tests. The images follow forge-expressions.test.ts: a brow-band change the
// gate keeps, an iris move and a below-the-eyes repaint it refuses. No network.
import { readFileSync } from "node:fs";
import { decodeImage, encodePng, type ForgeJob, type JobView } from "@sr/forge";
import { COST_USD } from "../_lib/costs.js";
import { handleForgeGet, handleForgePost, type ForgeDeps } from "../_lib/forge-api.js";
import type { GeminiClient, GeminiImage } from "../_lib/gemini.js";
import { MemoryJobStore } from "../_lib/jobstore.js";
import { MemoryQuotaStore, createQuota, type Quota } from "../_lib/quota.js";

const ROOT = new URL("../../", import.meta.url);
export const PORTRAIT: GeminiImage = { mimeType: "image/png", data: new Uint8Array(readFileSync(new URL("assets/characters/malakor/rig/portrait.png", ROOT))) };
const M8_PARTS = readFileSync(new URL("packages/forge/test/fixtures/m8-parts.json", ROOT), "utf8");
const EYE_BOXES = (JSON.parse(M8_PARTS) as { name: string; box_2d: number[] }[]).filter((p) => p.name.startsWith("eye_")).map((p) => p.box_2d);

function portrait() {
  const decoded = decodeImage(PORTRAIT.data);
  if (!decoded.ok) throw new Error("portrait");
  return decoded.value;
}

/** A change in a band just above each eye box (the brows): the gate keeps it. */
export function browEdit(shift: number): GeminiImage {
  const image = portrait();
  const { width, data } = image;
  for (let i = 0; i < data.length / 4; i++) {
    const x = ((i % width) * 1000) / width;
    const y = (Math.floor(i / width) * 1000) / width;
    const inBand = EYE_BOXES.some(([y0 = 0, x0 = 0, y1 = 0, x1 = 0]) => x > x0 && x < x1 && y > y0 - (y1 - y0) * 0.5 && y < y0 - (y1 - y0) * 0.1);
    if (inBand) for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] ?? 0) + shift;
  }
  return { mimeType: "image/png", data: encodePng(image) };
}

/** Everything well below the eyes repainted: the gate refuses it ("band"). */
export function belowEyes(shift: number): GeminiImage {
  const image = portrait();
  const { width, data } = image;
  const bottom = Math.max(...EYE_BOXES.map(([, , y1 = 0]) => y1)) + 60;
  for (let i = 0; i < data.length / 4; i++) {
    if ((Math.floor(i / width) * 1000) / width > bottom) for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] ?? 0) + shift;
  }
  return { mimeType: "image/png", data: encodePng(image) };
}

export type Call = "portrait" | "parts" | "fill" | "eyes" | "expression";

export interface FakeForge {
  deps: ForgeDeps;
  store: MemoryJobStore<ForgeJob>;
  calls: Call[];
  prompts: string[];
  /** USD charged through the quota for each paid call, in order. */
  charges: number[];
  /** The next expression edit's answer. */
  answer: { next: () => Promise<GeminiImage> };
  /** Moves the clock (ms). */
  advance(ms: number): void;
  /** Refuse every further charge. */
  refuse(): void;
}

export function fakeForge(): FakeForge {
  const calls: Call[] = [];
  const prompts: string[] = [];
  const charges: number[] = [];
  const answer = { next: async () => browEdit(70) };
  const client: GeminiClient = {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async () => (calls.push("portrait"), PORTRAIT),
    editImage: async (_image, prompt) => {
      if (!prompt.startsWith("Edit this portrait")) return calls.push("fill"), PORTRAIT;
      if (/remove the irises|remove only the small central light|Close both eyes/.test(prompt)) return calls.push("eyes"), PORTRAIT;
      calls.push("expression");
      prompts.push(prompt);
      return answer.next();
    },
    generateJson: async () => (calls.push("parts"), M8_PARTS),
  };
  const inner = createQuota({ store: new MemoryQuotaStore(), salt: "s", limits: { perIp: { forge: 3, engine: 60, voice: 60 }, dailyUsd: 30 } });
  let refused = false;
  const quota: Quota = {
    checkAndCharge: async (ip, kind, usd, options) => {
      if (refused) return { ok: false, code: "quota" };
      charges.push(usd);
      return inner.checkAndCharge(ip, kind, usd, options);
    },
  };
  const store = new MemoryJobStore<ForgeJob>(() => clock);
  let clock = 1_000_000;
  const deps: ForgeDeps = {
    env: { SR_PLANE: "live" },
    gemini: () => client,
    quota,
    store: () => store,
    replay: { post: async () => new Response(), get: async () => new Response() },
    now: () => (clock += 500),
  };
  return {
    deps,
    store,
    calls,
    prompts,
    charges,
    answer,
    advance: (ms) => void (clock += ms),
    refuse: () => void (refused = true),
  };
}

/** Runs one forge to its end; the job id and the last view. */
export async function forgeToDone(deps: ForgeDeps): Promise<{ jobId: string; view: JobView }> {
  const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "prompt", prompt: "lich" }), headers: { "x-real-ip": "198.51.100.9" } }), deps);
  const { jobId } = (await res.json()) as { jobId: string };
  for (let i = 0; i < 40; i++) {
    const view = (await (await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`), deps)).json()) as JobView;
    if (view.status === "done" || view.status === "failed") return { jobId, view };
  }
  throw new Error("job did not finish");
}

export { COST_USD };
