// Replay plane (task 8, requirement 7.5): recorded jobs, prompt-hash pick, 1.5-3 s per status,
// zero fetches, and the real endpoints honour `x-sr-plane: replay` with the bundled jobs.
// Task 9: images are static files at /replay/forge/<slug>/<file> (vercel-output.mjs publishes
// assets/replay/** there); the tests serve those URLs from disk to check every one resolves.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "@sr/forge";
import fc from "fast-check";
import type { JobView } from "@sr/forge";
import { validateRig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultForgeDeps, handleForgeGet, handleForgePost } from "../_lib/forge-api.js";
import { REPLAY_BASE, bundledReplay, createForgeReplay, pickIndex, replayJobId, replayJobOf, replayView, statusAt, type ReplayJob } from "../_lib/forge-replay.js";

const manifests = import.meta.glob("../../assets/replay/forge/*/job.json", { eager: true, import: "default" });
// cast-forge task 2 adds the first cast member (scripts/cast-forge.mjs); the rest follow one task at a time.
const SLUGS = ["announcer-of-dead-air", "auntie-asp", "lantern-warden", "lot-ninety", "malakor", "moth-widow", "reveille", "saint-cardia", "sir-vacant", "sister-vesper", "the-redactor", "the-tallyman", "understudy", "vicar-of-the-lure"];

/** The static file behind a /replay/** URL, read from assets/replay/** (what the deploy serves). */
function serveStatic(url: string): Uint8Array | undefined {
  if (!url.startsWith("/replay/") || url.includes("..")) return undefined;
  const path = join("assets", ...url.split("/").filter(Boolean));
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
}
const ORDER = ["queued", "portrait", "segmenting", "cutting", "filling", "done"];

let fetches = 0;
beforeEach(() => {
  fetches = 0;
  vi.stubGlobal("fetch", () => {
    fetches += 1;
    throw new Error("network access on the replay plane");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function view(res: Response): Promise<JobView> {
  expect(res.status).toBe(200);
  return (await res.json()) as JobView;
}

describe("recorded jobs", () => {
  it("there are 7, each fictional, with a valid rig of 7+ layers and holds of 1.5-3 s", () => {
    const slugs = Object.keys(manifests).map((p) => p.split("/").at(-2));
    expect(slugs.sort()).toEqual(SLUGS);
    for (const manifest of Object.values(manifests)) {
      const m = manifest as { fictional: unknown; rig: unknown; steps: { status: string; holdMs?: number }[] };
      expect(m.fictional).toBe(true);
      const rig = validateRig(m.rig);
      expect(rig.ok && rig.value.fictional && rig.value.layers.length >= 7).toBe(true);
      expect(m.steps.map((s) => s.status)).toEqual(ORDER);
      for (const s of m.steps.slice(0, -1)) expect(s.holdMs).toBeGreaterThanOrEqual(1500);
      for (const s of m.steps.slice(0, -1)) expect(s.holdMs).toBeLessThanOrEqual(3000);
    }
  });

  it("a manifest that is not fictional, or names a file outside its folder, is refused", () => {
    const [manifest] = Object.values(manifests) as { rig: { layers: { file: string }[] } }[];
    if (manifest === undefined) throw new Error("no manifests");
    expect(replayJobOf(manifest)).toBeDefined();
    expect(replayJobOf({ ...manifest, fictional: false })).toBeUndefined();
    expect(replayJobOf({ ...manifest, portrait: "../portrait.jpg" })).toBeUndefined();
    const layers = manifest.rig.layers.map((l, i) => (i === 0 ? { ...l, file: "data:image/png;base64,AA==" } : l));
    expect(replayJobOf({ ...manifest, rig: { ...manifest.rig, layers } })).toBeUndefined();
  });

  it("every job's done view is under 100 KB and every URL in it is a static file that decodes at its layer's size", () => {
    for (const manifest of Object.values(manifests)) {
      const job = replayJobOf(manifest);
      if (job === undefined) throw new Error("a committed job does not load");
      const view = replayView(job, replayJobId(job.slug, 0), "done");
      expect(JSON.stringify(view).length, job.slug).toBeLessThan(100 * 1024);
      expect(view.portraitUrl).toBe(`${REPLAY_BASE}/${job.slug}/${(manifest as { portrait: string }).portrait}`);
      expect(serveStatic(view.portraitUrl ?? ""), `${job.slug} portrait`).toBeDefined();
      for (const layer of job.rig.layers) {
        const url = view.assets?.[layer.file] ?? "";
        expect(url).toBe(`${REPLAY_BASE}/${job.slug}/${layer.file}`);
        const bytes = serveStatic(url);
        expect(bytes, url).toBeDefined();
        const image = decodeImage(bytes ?? new Uint8Array());
        expect(image.ok && [image.value.width, image.value.height], url).toEqual([layer.bbox[2], layer.bbox[3]]);
      }
    }
  });
});

describe("replay plane", () => {
  const job: ReplayJob = {
    slug: "x",
    name: "X",
    fill: "edit",
    steps: [
      { status: "queued", holdMs: 1500 },
      { status: "portrait", holdMs: 3000 },
      { status: "segmenting", holdMs: 2000 },
      { status: "cutting", holdMs: 1500 },
      { status: "filling", holdMs: 1500 },
      { status: "done", holdMs: 0 },
    ],
    portraitUrl: "/replay/forge/x/portrait.jpg",
    rig: { version: 1, id: "x", name: "X", width: 4, height: 4, source: "forge", fictional: true, palette: { eye: "#ff0000", glow: "#ff0000", rim: "#ff0000", mouth: "#ff0000" }, layers: [] },
    assets: {},
  };

  it("status moves forward with elapsed time and ends in done", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 20_000 }), { minLength: 2 }), (times) => {
        const ranks = [...times].sort((a, b) => a - b).map((t) => ORDER.indexOf(statusAt(job, t)));
        return ranks.every((r, i) => i === 0 || r >= (ranks[i - 1] ?? 0)) && statusAt(job, 9500) === "done" && statusAt(job, 9499) === "filling";
      }),
    );
    expect([0, 1499, 1500, 4499, 4500, 6500, 8000].map((t) => statusAt(job, t))).toEqual(["queued", "queued", "portrait", "portrait", "segmenting", "cutting", "filling"]);
  });

  it("the same prompt always picks the same job; picks spread over all jobs", () => {
    fc.assert(fc.property(fc.string(), (p) => pickIndex(p, 4) === pickIndex(` ${p.toUpperCase()} `.toLowerCase(), 4)));
    const seen = new Set(Array.from({ length: 64 }, (_, i) => pickIndex(`prompt ${i}`, 4)));
    expect(seen.size).toBe(4);
  });

  it("walks a bundled job from POST to done with zero fetches", async () => {
    const t0 = 1_800_000_000_000;
    const res = await bundledReplay.post(JSON.stringify({ mode: "prompt", prompt: "a crowned lich" }), t0);
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(jobId).toMatch(/^replay_[a-z-]+_[0-9a-z]+$/);
    const seen: string[] = [];
    let last: JobView | undefined;
    for (let t = t0; t <= t0 + 20_000; t += 500) {
      last = await view(await bundledReplay.get(jobId, t));
      if (seen.at(-1) !== last.status) seen.push(last.status);
      expect(last.plane).toBe("replay");
      expect("portraitUrl" in last).toBe(ORDER.indexOf(last.status) >= 2);
    }
    expect(seen).toEqual(ORDER);
    expect(["edit", "fallback"]).toContain(last?.fill);
    const rig = validateRig(last?.rig);
    expect(rig.ok).toBe(true);
    if (rig.ok) for (const layer of rig.value.layers) expect(serveStatic(last?.assets?.[layer.file] ?? "")).toBeDefined();
    expect(fetches).toBe(0);
  });

  it("bad bodies are bad_input; unknown jobs are 404; no recorded jobs is upstream", async () => {
    expect((await bundledReplay.post("{", 0)).status).toBe(400);
    expect((await bundledReplay.get("replay_nobody_1", 0)).status).toBe(404);
    expect((await bundledReplay.get("../../etc", 0)).status).toBe(404);
    expect((await createForgeReplay([]).post('{"mode":"prompt","prompt":"x"}', 0)).status).toBe(502);
  });

  it("job ids encode the start time, so any instance can answer", () => {
    expect(replayJobId("malakor", 36 ** 3)).toBe("replay_malakor_1000");
  });
});

describe("the real endpoints on replay", () => {
  it("a replay deploy serves bundled jobs with no key, no quota and no fetch", async () => {
    const deps = { ...defaultForgeDeps({}), now: () => 2_000_000_000_000 };
    const gemini = vi.fn();
    deps.gemini = gemini;
    const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: '{"mode":"prompt","prompt":"lich"}' }), deps);
    const { jobId } = (await res.json()) as { jobId: string };
    const v = await view(await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`), deps));
    expect(v).toEqual({ jobId, status: "queued", plane: "replay" });
    expect(gemini).not.toHaveBeenCalled();
    expect(fetches).toBe(0);
  });

  it("x-sr-plane: replay forces the bundled replay on a live deploy", async () => {
    const deps = defaultForgeDeps({ SR_PLANE: "live", GEMINI_API_KEY: "k" });
    const quota = vi.spyOn(deps.quota, "checkAndCharge");
    const res = await handleForgePost(
      new Request("https://sr.test/api/forge", { method: "POST", body: '{"mode":"prompt","prompt":"lich"}', headers: { "x-sr-plane": "replay" } }),
      deps,
    );
    expect(res.status).toBe(202);
    expect(((await res.json()) as { jobId: string }).jobId.startsWith("replay_")).toBe(true);
    expect(quota).not.toHaveBeenCalled();
    expect(fetches).toBe(0);
  });
});
