// character-control task 3 (requirement 5.1): the live forge's `expressing` steps through the real
// handlers with a fake Gemini client and an in-memory store. One family per GET; a spent budget, a
// failed edit or a drifting edit skips that family and the forge still ends `done`. No network.
// forge-creator C3: a family the gate refused is re-run stricter (attempt + 1, at most 2, at most
// MAX_EXTRA_EDITS re-runs per forge, each charged first); a brief's eyes line phrases every edit.
import { readFileSync } from "node:fs";
import { MAX_EXTRA_EDITS, STRICTER, decodeImage, encodePng, eyesMaterial, type CharacterBrief, type ForgeJob, type JobView } from "@sr/forge";
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

/** The portrait with `shift` added just above each eye box, the brows (`everywhere`: the whole frame). */
function edited(shift: number, everywhere = false): GeminiImage {
  const decoded = decodeImage(PORTRAIT.data);
  if (!decoded.ok) throw new Error("portrait");
  const { width, data } = decoded.value;
  for (let i = 0; i < data.length / 4; i++) {
    const x = ((i % width) * 1000) / width;
    const y = (Math.floor(i / width) * 1000) / width;
    // face-control: a brow's change (a band just above each eye box), which keeps the eyes where they were.
    const inEye = EYE_BOXES.some(([y0 = 0, x0 = 0, y1 = 0, x1 = 0]) => x > x0 && x < x1 && y > y0 - (y1 - y0) * 0.5 && y < y0 - (y1 - y0) * 0.1);
    if (everywhere || inEye) for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] ?? 0) + shift;
  }
  return { mimeType: "image/png", data: encodePng(decoded.value) };
}

/** The portrait with `shift` added to everything well below the eyes (the face repainted outside the brow+lid band). */
function belowEyes(shift: number): GeminiImage {
  const decoded = decodeImage(PORTRAIT.data);
  if (!decoded.ok) throw new Error("portrait");
  const { width, data } = decoded.value;
  const bottom = Math.max(...EYE_BOXES.map(([, , y1 = 0]) => y1)) + 60;
  for (let i = 0; i < data.length / 4; i++) {
    if ((Math.floor(i / width) * 1000) / width > bottom) for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] ?? 0) + shift;
  }
  return { mimeType: "image/png", data: encodePng(decoded.value) };
}

/** The portrait with the pixels inside each eye box moved `dx` px to the right (the irises move; nothing else). */
function irisMoved(dx: number): GeminiImage {
  const decoded = decodeImage(PORTRAIT.data);
  if (!decoded.ok) throw new Error("portrait");
  const { width, height } = decoded.value;
  const src = decoded.value.data;
  const data = new Uint8ClampedArray(src);
  for (const [y0 = 0, x0 = 0, y1 = 0, x1 = 0] of EYE_BOXES) {
    const [px0, px1, py0, py1] = [x0, x1, y0, y1].map((v) => Math.round((v * width) / 1000)) as [number, number, number, number];
    for (let y = py0; y < Math.min(py1, height); y++)
      for (let x = px0 + dx; x < Math.min(px1, width); x++) for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = src[(y * width + x - dx) * 4 + c] ?? 0;
  }
  return { mimeType: "image/png", data: encodePng({ width, height, data }) };
}

const WARDEN: CharacterBrief = {
  name: "The Lantern Warden",
  one_line_request: "a pumpkin-headed night watchman",
  archetype: "Night watch",
  persona_hook: "Keeps the candle lit for chat.",
  accent_hex: "#ff9a2e",
  silhouette: "A carved pumpkin head on a cloak.",
  parts: [
    { name: "head", role: "head", what: "carved pumpkin" },
    { name: "jaw", role: "jaw", what: "carved grin" },
    { name: "eye_l", role: "eye_l", what: "left carved eye hole" },
    { name: "eye_r", role: "eye_r", what: "right carved eye hole" },
    { name: "ember", role: "float", what: "a drifting ember", motion: "drifts" },
    { name: "cloak", role: "torso", what: "ragged cloak" },
  ],
  style: { name: "Flat poster fills", why: "Ink outlines cut cleanly." },
  portrait_prompt: "Flat poster fills with ink outlines. A carved pumpkin head with two lit eye holes.",
};

function setup(expression: (call: number, prompt: string) => Promise<GeminiImage>, editsAllowed = Infinity) {
  const calls: string[] = [];
  const prompts: { kind: "eyes" | "expression"; prompt: string }[] = [];
  let expressions = 0;
  const client: GeminiClient = {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async () => (calls.push("portrait"), PORTRAIT),
    editImage: async (_image, prompt) => {
      if (!prompt.startsWith("Edit this portrait")) return calls.push("fill"), PORTRAIT;
      // face-control: the eye step's two edits (iris-free, closed eyes) answer with the portrait.
      if (/remove the irises|remove only the small central light|Close both eyes/.test(prompt)) return calls.push("eyes"), prompts.push({ kind: "eyes", prompt }), PORTRAIT;
      calls.push("expression");
      prompts.push({ kind: "expression", prompt });
      return expression(++expressions, prompt);
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
  return { deps, calls, prompts, store };
}

async function forge(deps: ForgeDeps, body: unknown = { mode: "prompt", prompt: "lich" }): Promise<JobView[]> {
  const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify(body), headers: { "x-real-ip": "198.51.100.9" } }), deps);
  const { jobId } = (await res.json()) as { jobId: string };
  const views: JobView[] = [];
  for (let i = 0; i < 30; i++) {
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
    const { deps, calls } = setup(async () => edited(70), 5); // the fill edit + the two eye edits + two expressions
    const views = await forge(deps);
    const view = views.at(-1);
    // face-control: the eyes take one more GET before the first family.
    expect(views.map((v) => v.status)).toEqual(["cutting", "filling", "expressing", ...EXPRESSION_FAMILIES.map(() => "expressing"), "done"]);
    expect(view?.expressions).toEqual({ joy: "ok", showman: "ok", anger: "skipped", gloom: "skipped", smug: "skipped", suspicion: "skipped" });
    expect(views[3]?.expressions).toBeUndefined();
    expect(views[4]?.expressions).toEqual({ joy: "ok" });
    expect(calls.filter((c) => c === "eyes")).toHaveLength(2);
    expect(views[2]?.rig).toBeUndefined();
    expect(calls.filter((c) => c === "expression")).toHaveLength(2);
    const rig = validateRig(view?.rig);
    expect(rig.ok).toBe(true);
    const layers = view?.rig?.layers ?? [];
    // The brows are on the head: its faces are cut to the brow+lid band (face-control) and drawn over it.
    const head = layers.find((l) => l.kind === "head");
    expect(Object.keys(head?.variants ?? {}).sort()).toEqual(["joy", "showman"]);
    expect(head?.variants?.joy).toMatchObject({ file: "head.joy.png", mode: "over" });
    expect(layers.filter((l) => l.kind === "iris").length).toBe(2);
    const files = layers.flatMap((l) => [l.file, ...(l.regions ? [l.regions.map] : []), ...Object.values(l.variants ?? {}).map((p) => p.file)]);
    expect(layers.some((l) => l.regions !== undefined)).toBe(true);
    for (const file of files) expect(view?.assets?.[file], file).toMatch(/^data:image\/png;base64,/);
  });

  it("a failed edit is `failed`, a drifting edit and an unchanged edit `skipped`; the forge never fails for them", { timeout: 120_000 }, async () => {
    const replies = [
      () => Promise.reject(new GeminiError("timeout")),
      // C3: the drifting showman is refused three times (attempt 0, then the two stricter re-runs).
      async () => edited(70, true),
      async () => edited(70, true),
      async () => edited(70, true),
      async () => PORTRAIT,
      async () => ({ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }),
      async () => edited(70),
      async () => edited(70),
    ];
    const { deps, prompts } = setup(async (n) => (replies[n - 1] ?? (async () => PORTRAIT))());
    const view = (await forge(deps)).at(-1);
    expect(view?.status).toBe("done");
    expect(view?.expressions).toEqual({ joy: "failed", showman: "skipped", anger: "skipped", gloom: "failed", smug: "ok", suspicion: "ok" });
    // A throw and an unchanged edit are not re-run; only the gate's refusal is, stricter each time.
    const showman = prompts.filter((p) => p.kind === "expression").slice(1, 4).map((p) => p.prompt);
    expect(showman.map((p) => [p.includes(STRICTER[0] ?? "?"), p.includes(STRICTER[1] ?? "?")])).toEqual([[false, false], [true, false], [true, true]]);
    expect(prompts.filter((p) => p.kind === "expression")).toHaveLength(8);
  });

  it("C3: a face refused at attempt 0 and passed at attempt 1 ends ok; re-runs stop at MAX_EXTRA_EDITS", { timeout: 120_000 }, async () => {
    // The fake editor drifts on a first edit and keeps to the brows when asked stricter.
    const { deps, prompts } = setup(async (_n, prompt) => (prompt.includes(STRICTER[0] ?? "?") ? edited(70) : edited(70, true)));
    const views = await forge(deps);
    const view = views.at(-1);
    expect(view?.status).toBe("done");
    expect(view?.expressions).toEqual({ joy: "ok", showman: "ok", anger: "ok", gloom: "ok", smug: "skipped", suspicion: "skipped" });
    const edits = prompts.filter((p) => p.kind === "expression").map((p) => p.prompt);
    expect(edits[0]).not.toContain(STRICTER[0]);
    expect(edits[1]).toContain(STRICTER[0]);
    expect(edits.length).toBe(6 + MAX_EXTRA_EDITS);
    // A re-run is the next GET for the same family: the outcome is written only when it settles.
    const joyAt = views.findIndex((v) => v.expressions?.joy !== undefined);
    expect(views[joyAt - 1]?.status).toBe("expressing");
    expect(views[joyAt - 1]?.expressions).toBeUndefined();
    expect(views[joyAt - 1]?.rig).toBeDefined(); // C1: awake since the eye step
    // Faces only add: every family that settled ok has its patch on the head.
    const head = view?.rig?.layers.find((l) => l.kind === "head");
    expect(Object.keys(head?.variants ?? {}).sort()).toEqual(["anger", "gloom", "joy", "showman"]);
  });

  it("C3: a budget refusal on a re-run ends that family skipped without failing the forge", { timeout: 120_000 }, async () => {
    // fill + the two eye edits + joy's first edit; joy's re-run is refused by the budget.
    const { deps, calls } = setup(async () => edited(70, true), 4);
    const view = (await forge(deps)).at(-1);
    expect(view?.status).toBe("done");
    expect(view?.expressions).toEqual({ joy: "skipped", showman: "skipped", anger: "skipped", gloom: "skipped", smug: "skipped", suspicion: "skipped" });
    expect(calls.filter((c) => c === "expression")).toHaveLength(1);
  });

  it("C3: a brief that says what its eyes are phrases both eye edits and every expression edit in it", { timeout: 120_000 }, async () => {
    const eyes = "two triangular holes carved in a pumpkin, lit from inside by a candle";
    const { deps, prompts } = setup(async () => edited(70));
    const view = (await forge(deps, { mode: "brief", brief: { ...WARDEN, face: { eyes } } })).at(-1);
    expect(view?.status).toBe("done");
    const sentence = eyesMaterial(eyes) ?? "?";
    expect(prompts.filter((p) => p.kind === "eyes")).toHaveLength(2);
    expect(prompts.filter((p) => p.kind === "expression").length).toBeGreaterThan(0);
    for (const p of prompts) expect(p.prompt, p.kind).toContain(sentence);
    expect(prompts.some((p) => /remove the irises|paint the upper eyelids/.test(p.prompt))).toBe(false);
  });
});

describe("S1: why a face was refused (expressionGate)", () => {
  it("a family refused on every attempt records the last reading and the attempts; a passing family records nothing", { timeout: 120_000 }, async () => {
    // joy: the irises move on all three edits (attempt 0 and the two stricter re-runs); the rest pass.
    const { deps } = setup(async (n) => (n <= 3 ? irisMoved(10) : edited(70)));
    const view = (await forge(deps)).at(-1);
    expect(view?.status).toBe("done");
    expect(view?.expressions).toEqual({ joy: "skipped", showman: "ok", anger: "ok", gloom: "ok", smug: "ok", suspicion: "ok" });
    const joy = view?.expressionGate?.joy;
    expect(joy).toMatchObject({ reason: "iris", attempts: 3, limit: 4 });
    expect(joy?.irisDriftPx).toBeGreaterThan(4);
    expect(Math.round((joy?.irisDriftPx ?? 0) * 10) / 10).toBe(joy?.irisDriftPx);
    expect(Object.keys(view?.expressionGate ?? {})).toEqual(["joy"]);
  });

  it("the face over the band, the budget, a failed edit and an unchanged edit each say so", { timeout: 120_000 }, async () => {
    const replies = [
      () => Promise.reject(new GeminiError("timeout")),
      async () => belowEyes(70),
      async () => belowEyes(70),
      async () => belowEyes(70),
      async () => PORTRAIT,
    ];
    // fill + two eye edits + five expression edits; smug and suspicion are refused by the budget.
    const { deps } = setup(async (n) => (replies[n - 1] ?? (async () => PORTRAIT))(), 8);
    const view = (await forge(deps)).at(-1);
    expect(view?.status).toBe("done");
    expect(view?.expressions).toEqual({ joy: "failed", showman: "skipped", anger: "skipped", gloom: "skipped", smug: "skipped", suspicion: "skipped" });
    const gate = view?.expressionGate;
    expect(gate?.joy).toEqual({ reason: "failed", attempts: 1 });
    expect(gate?.showman).toMatchObject({ reason: "band", attempts: 3 });
    expect(gate?.showman?.outsideBandMean).toBeGreaterThan(gate?.showman?.limit ?? Infinity);
    expect(gate?.anger).toEqual({ reason: "no_change", attempts: 1 });
    // gloom's edit is the ninth charge: the budget refuses it before any edit is made.
    expect(gate?.gloom).toEqual({ reason: "budget" });
    expect(gate?.smug).toEqual({ reason: "budget" });
    expect(JSON.stringify(gate).length).toBeLessThan(1000);
  });
});
