// character-control task 3 (requirement 5.1): the live forge's `expressing` steps through the real
// handlers with a fake Gemini client and an in-memory store. One family per GET; a spent budget, a
// failed edit or a drifting edit skips that family and the forge still ends `done`. No network.
import { readFileSync } from "node:fs";
import { decodeImage, encodePng, type ForgeJob, type JobView } from "@sr/forge";
import { EXPRESSION_FAMILIES, validateRig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COST_USD } from "../_lib/costs.js";
import { handleForgeGet, handleForgePost, type ForgeDeps } from "../_lib/forge-api.js";
import { GeminiError, type GeminiClient, type GeminiImage } from "../_lib/gemini.js";
import { MemoryJobStore } from "../_lib/jobstore.js";
import { MemoryQuotaStore, createQuota, type Quota } from "../_lib/quota.js";

const ROOT = new URL("../../", import.meta.url);
const PORTRAIT: GeminiImage = { mimeType: "image/png", data: new Uint8Array(readFileSync(new URL("assets/characters/malakor/rig/portrait.png", ROOT))) };
const M8_PARTS = readFileSync(new URL("packages/forge/test/fixtures/m8-parts.json", ROOT), "utf8");
const EYE_BOXES = (JSON.parse(M8_PARTS) as { name: string; box_2d: number[] }[]).filter((p) => p.name.startsWith("eye_")).map((p) => p.box_2d);

/** The portrait with `shift` added inside the middle of each eye box (`everywhere`: the whole frame). */
function edited(shift: number, everywhere = false): GeminiImage {
  const decoded = decodeImage(PORTRAIT.data);
  if (!decoded.ok) throw new Error("portrait");
  const { width, data } = decoded.value;
  for (let i = 0; i < data.length / 4; i++) {
    const x = ((i % width) * 1000) / width;
    const y = (Math.floor(i / width) * 1000) / width;
    const inEye = EYE_BOXES.some(([y0 = 0, x0 = 0, y1 = 0, x1 = 0]) => x > x0 + (x1 - x0) * 0.2 && x < x1 - (x1 - x0) * 0.2 && y > y0 + (y1 - y0) * 0.2 && y < y1 - (y1 - y0) * 0.2);
    if (everywhere || inEye) for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] ?? 0) + shift;
  }
  return { mimeType: "image/png", data: encodePng(decoded.value) };
}

function setup(expression: (call: number) => Promise<GeminiImage>, editsAllowed = Infinity) {
  const calls: string[] = [];
  let expressions = 0;
  const client: GeminiClient = {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async () => (calls.push("portrait"), PORTRAIT),
    editImage: async (_image, prompt) => {
      if (!prompt.startsWith("Edit this portrait")) return calls.push("fill"), PORTRAIT;
      calls.push("expression");
      return expression(++expressions);
    },
    generateJson: async () => (calls.push("parts"), M8_PARTS),
  };
  // The daily budget: the fill edit and the expressions share one price; refuse after `editsAllowed` of them.
  const inner = createQuota({ store: new MemoryQuotaStore(), salt: "s", limits: { perIp: { forge: 3, engine: 60, voice: 60 }, dailyUsd: 30 } });
  let edits = 0;
  const quota: Quota = {
    checkAndCharge: async (ip, kind, usd, options) => {
      if (options?.count === false && usd === COST_USD.expression && ++edits > editsAllowed) return { ok: false, code: "quota" };
      return inner.checkAndCharge(ip, kind, usd, options);
    },
  };
  const store = new MemoryJobStore<ForgeJob>();
  let clock = 1_000_000;
  const deps: ForgeDeps = { env: { SR_PLANE: "live" }, gemini: () => client, quota, store: () => store, replay: { post: async () => new Response(), get: async () => new Response() }, now: () => (clock += 500) };
  return { deps, calls, store };
}

async function forge(deps: ForgeDeps): Promise<JobView[]> {
  const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "prompt", prompt: "lich" }), headers: { "x-real-ip": "198.51.100.9" } }), deps);
  const { jobId } = (await res.json()) as { jobId: string };
  const views: JobView[] = [];
  for (let i = 0; i < 16; i++) {
    const view = (await (await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`), deps)).json()) as JobView;
    views.push(view);
    if (view.status === "done" || view.status === "failed") return views;
  }
  throw new Error("job did not finish");
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

describe("live expressions", () => {
  it("the budget runs out at family 3: joy and showman ok, anger..suspicion skipped, the job done with a valid rig", { timeout: 120_000 }, async () => {
    const { deps, calls } = setup(async () => edited(70), 3); // the fill edit + two expressions
    const views = await forge(deps);
    const view = views.at(-1);
    expect(views.map((v) => v.status)).toEqual(["cutting", "filling", ...EXPRESSION_FAMILIES.map(() => "expressing"), "done"]);
    expect(view?.expressions).toEqual({ joy: "ok", showman: "ok", anger: "skipped", gloom: "skipped", smug: "skipped", suspicion: "skipped" });
    expect(views[3]?.expressions).toEqual({ joy: "ok" });
    expect(views[2]?.rig).toBeUndefined();
    expect(calls.filter((c) => c === "expression")).toHaveLength(2);
    const rig = validateRig(view?.rig);
    expect(rig.ok).toBe(true);
    const layers = view?.rig?.layers ?? [];
    const eyes = layers.filter((l) => l.kind === "eye");
    expect(eyes.length).toBe(2);
    for (const eye of eyes) {
      expect(Object.keys(eye.variants ?? {}).sort()).toEqual(["joy", "showman"]);
      expect(eye.variants?.joy).toMatchObject({ file: `${eye.name}.joy.png`, mode: "replace" });
    }
    const files = layers.flatMap((l) => [l.file, ...(l.regions ? [l.regions.map] : []), ...Object.values(l.variants ?? {}).map((p) => p.file)]);
    expect(layers.some((l) => l.regions !== undefined)).toBe(true);
    for (const file of files) expect(view?.assets?.[file], file).toMatch(/^data:image\/png;base64,/);
  });

  it("a failed edit is `failed`, a drifting edit and an unchanged edit `skipped`; the forge never fails for them", { timeout: 120_000 }, async () => {
    const replies = [
      () => Promise.reject(new GeminiError("timeout")),
      async () => edited(70, true),
      async () => PORTRAIT,
      async () => ({ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }),
      async () => edited(70),
      async () => edited(70),
    ];
    const { deps } = setup(async (n) => (replies[n - 1] ?? (async () => PORTRAIT))());
    const view = (await forge(deps)).at(-1);
    expect(view?.status).toBe("done");
    expect(view?.expressions).toEqual({ joy: "failed", showman: "skipped", anger: "skipped", gloom: "failed", smug: "ok", suspicion: "ok" });
  });
});
