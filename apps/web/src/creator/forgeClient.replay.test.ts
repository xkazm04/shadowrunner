import { REPLAY_FACE_HOLD_MS, withFacesStep } from "@sr/forge/replayFaces";
import type { ForgeErrorCode } from "@sr/forge/wire";
import type { Rig } from "@sr/rig";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgeError, readJobView } from "./forgeClient";
import { createReplayForgeClient, failOf, parseReplayJobId, pickIndex, replayJobId } from "./forgeClient.replay";
import { loadReplayJobs, replayJobOf, servedName, statusAt, type ReplayJob } from "./replayJobs";
import { PIXEL_PNG, testJob } from "./testFixtures";

const PROMPT = { mode: "prompt" as const, prompt: "a drowned lighthouse keeper with a lantern heart" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const jobs = async () => [testJob("ghost-a"), testJob("ghost-b")];

describe("replay forge client", () => {
  it("walks queued -> portrait -> segmenting -> cutting -> filling -> done on the recorded holds", async () => {
    const client = createReplayForgeClient({ jobs });
    const { jobId } = await client.start(PROMPT);
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      seen.push((await client.poll(jobId)).status);
      vi.advanceTimersByTime(1000);
    }
    expect(seen).toEqual(["queued", "queued", "portrait", "segmenting", "segmenting", "cutting", "filling", "filling", "done"]);
  });

  it("shows the portrait from segmenting on and returns the rig and every layer's asset when done", async () => {
    const client = createReplayForgeClient({ jobs });
    const { jobId } = await client.start(PROMPT);
    vi.advanceTimersByTime(1600);
    expect((await client.poll(jobId)).portraitUrl).toBeUndefined();
    vi.advanceTimersByTime(1500);
    expect((await client.poll(jobId)).portraitUrl).toBeDefined();
    vi.advanceTimersByTime(10_000);
    const done = await client.poll(jobId);
    expect(done.plane).toBe("replay");
    expect(done.rig?.fictional).toBe(true);
    for (const layer of done.rig?.layers ?? []) expect(done.assets?.[layer.file]).toBeDefined();
  });

  it("picks the same character for the same text, whatever the case and padding", async () => {
    const client = createReplayForgeClient({ jobs });
    const a = await client.start(PROMPT);
    const b = await client.start({ mode: "prompt", prompt: `  ${PROMPT.prompt.toUpperCase()} ` });
    expect(parseReplayJobId(a.jobId)?.slug).toBe(parseReplayJobId(b.jobId)?.slug);
  });

  it("resumes from the job id alone (a fresh client, as after a reload)", async () => {
    const { jobId } = await createReplayForgeClient({ jobs }).start(PROMPT);
    vi.advanceTimersByTime(60_000);
    expect((await createReplayForgeClient({ jobs }).poll(jobId)).status).toBe("done");
  });

  it("refuses an empty request as bad_input", async () => {
    await expect(createReplayForgeClient({ jobs }).start({ mode: "prompt", prompt: "  " })).rejects.toMatchObject({ code: "bad_input" });
  });

  it.each<ForgeErrorCode>(["quota", "bad_input"])("?forge=fail:%s is refused at start", async (code) => {
    const client = createReplayForgeClient({ jobs, fail: code });
    const err = await client.start(PROMPT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForgeError);
    expect(err).toMatchObject({ code });
  });

  it.each<ForgeErrorCode>(["refused_likeness", "refused_content", "upstream"])("?forge=fail:%s fails the running job", async (code) => {
    const client = createReplayForgeClient({ jobs, fail: code });
    const { jobId } = await client.start(PROMPT);
    expect((await client.poll(jobId)).status).toBe("queued");
    vi.advanceTimersByTime(60_000);
    const view = await client.poll(jobId);
    expect(view.status).toBe("failed");
    expect(view.error?.code).toBe(code);
    expect(view.rig).toBeUndefined();
  });

  it("answers an unknown job id with bad_input", async () => {
    await expect(createReplayForgeClient({ jobs }).poll("replay_nobody_1")).rejects.toMatchObject({ code: "bad_input" });
  });
});

describe("replay helpers", () => {
  it("failOf reads ?forge=fail:<code> and nothing else", () => {
    expect(failOf("?forge=fail:quota")).toBe("quota");
    expect(failOf("?plane=replay&forge=FAIL:refused_likeness")).toBe("refused_likeness");
    expect(failOf("?forge=fail:melted")).toBeUndefined();
    expect(failOf("?forge=quota")).toBeUndefined();
    expect(failOf("")).toBeUndefined();
  });

  it("job ids round-trip (property)", () => {
    const code = fc.constantFrom<ForgeErrorCode | undefined>(undefined, "quota", "refused_likeness", "refused_content", "upstream", "bad_input");
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9-]{1,48}$/), fc.integer({ min: 0, max: 2 ** 45 }), code, (slug, t, fail) => {
        const parsed = parseReplayJobId(replayJobId(slug, t, fail));
        expect(parsed).toEqual(fail === undefined ? { slug, startedAt: t } : { slug, startedAt: t, fail });
      }),
    );
  });

  it("pickIndex stays in range (property)", () => {
    fc.assert(fc.property(fc.string(), fc.integer({ min: 1, max: 50 }), (key, n) => pickIndex(key, n) >= 0 && pickIndex(key, n) < n));
  });

  it("statusAt never moves backwards as time passes (property)", () => {
    const steps = testJob().steps;
    const order = steps.map((s) => s.status);
    fc.assert(
      fc.property(fc.nat(20_000), fc.nat(20_000), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return order.indexOf(statusAt(steps, lo)) <= order.indexOf(statusAt(steps, hi));
      }),
    );
  });
});

describe("recorded jobs", () => {
  it("every committed job.json loads, is fictional and has every layer's file", async () => {
    const manifests = Object.keys(import.meta.glob("../../../../assets/replay/forge/*/job.json"));
    const loaded = await loadReplayJobs();
    expect(manifests.length).toBeGreaterThan(0);
    expect(loaded).toHaveLength(manifests.length);
    for (const job of loaded) {
      expect(job.rig.fictional).toBe(true);
      expect(job.steps.at(-1)?.status).toBe("done");
      for (const layer of job.rig.layers) expect(job.assets[layer.file]).toBeTypeOf("string");
    }
  });

  it("serves a cast job's art as WebP and names it so in the rig; Malakor's house art stays PNG (perfection-pass task 12)", async () => {
    const loaded = await loadReplayJobs();
    for (const job of loaded) {
      const names = [...job.rig.layers.map((l) => l.file), ...Object.keys(job.assets)];
      if (job.slug === "malakor") expect(job.rig.layers.every((l) => l.file.endsWith(".png")), job.slug).toBe(true);
      else expect(names.filter((f) => f.endsWith(".png")), job.slug).toEqual([]);
    }
    expect(loaded.find((j) => j.slug === "moth-widow")?.portraitUrl).toMatch(/portrait.*\.jpg$/);
  });

  it("servedName takes a bundled file as is, else a .png's committed .webp sibling", () => {
    const files = { "a.png": "u1", "b.webp": "u2" };
    expect(servedName("a.png", files)).toBe("a.png");
    expect(servedName("b.png", files)).toBe("b.webp");
    expect(servedName("c.png", files)).toBe("c.png");
    expect(servedName("b.jpg", files)).toBe("b.jpg");
  });

  it("replayJobOf hands out the rig under its served names, sockets, lids, maps and faces included", () => {
    const job = testJob();
    const layers = job.rig.layers.map((l) =>
      l.name === "eye_l" ? { ...l, socket: "eye_l.socket.png", closed: "eye_l.closed.png", regions: { map: "eye_l.regions.png", slots: [{ id: "iris", name: "iris", hex: "#00ff00" }] }, variants: { joy: { file: "eye_l.joy.png", bbox: l.bbox, mode: "over" as const, socket: "eye_l.joy.socket.png" } } } : l,
    );
    const rig = { ...job.rig, layers };
    const files: Record<string, string> = { "portrait.webp": "p" };
    for (const l of layers) files[l.file.replace(/\.png$/, ".webp")] = `/${l.file}`;
    for (const f of ["eye_l.socket", "eye_l.closed", "eye_l.regions", "eye_l.joy", "eye_l.joy.socket"]) files[`${f}.webp`] = `/${f}`;
    const loaded = replayJobOf({ slug: job.slug, name: job.name, fictional: true, portrait: "portrait.png", steps: job.steps, rig }, files);
    expect(loaded?.portraitUrl).toBe("p");
    const eye = loaded?.rig.layers.find((l) => l.name === "eye_l");
    expect([eye?.file, eye?.socket, eye?.closed, eye?.regions?.map, eye?.variants?.joy?.file, eye?.variants?.joy?.socket]).toEqual(["eye_l.webp", "eye_l.socket.webp", "eye_l.closed.webp", "eye_l.regions.webp", "eye_l.joy.webp", "eye_l.joy.socket.webp"]);
    expect(loaded?.assets["eye_l.joy.socket.webp"]).toBe("/eye_l.joy.socket");
    expect(Object.keys(loaded?.assets ?? {}).some((f) => f.endsWith(".png"))).toBe(false);
  });

  it("replayJobOf refuses a non-fictional job, a missing file and steps out of order", () => {
    const job = testJob();
    const files = { "portrait.jpg": "u", ...job.assets };
    const manifest = { slug: job.slug, name: job.name, fictional: true, portrait: "portrait.jpg", steps: job.steps, rig: job.rig };
    expect(replayJobOf(manifest, files)?.slug).toBe(job.slug);
    expect(replayJobOf({ ...manifest, fictional: false }, files)).toBeUndefined();
    expect(replayJobOf(manifest, { "portrait.jpg": "u" })).toBeUndefined();
    expect(replayJobOf({ ...manifest, steps: [...job.steps].reverse() }, files)).toBeUndefined();
  });
});

describe("replay forge client: faces paint in after Wake (forge-creator C1)", () => {
  /** testJob with a recorded joy and anger face on the head, as replayJobOf would load it. */
  function facedJob(): ReplayJob {
    const job = testJob("ghost-f");
    const rig: Rig = {
      ...job.rig,
      layers: job.rig.layers.map((l) =>
        l.name !== "head"
          ? l
          : { ...l, variants: { joy: { file: "head.joy.png", bbox: [16, 8, 4, 4], mode: "over" }, anger: { file: "head.anger.png", bbox: [16, 8, 4, 4], mode: "over" } } },
      ),
    };
    return { ...job, rig, steps: withFacesStep(job.steps, rig), assets: { ...job.assets, "head.joy.png": PIXEL_PNG, "head.anger.png": PIXEL_PNG } };
  }

  it("wakes at the start of the expressing hold with no faces, adds the recorded ones family by family, and ends on the recorded rig", async () => {
    const job = facedJob();
    const client = createReplayForgeClient({ jobs: async () => [job] });
    const { jobId } = await client.start(PROMPT);
    vi.advanceTimersByTime(7400);
    const filling = await client.poll(jobId);
    expect(filling.status).toBe("filling");
    expect(filling.rig).toBeUndefined();
    vi.advanceTimersByTime(200);
    const woke = readJobView(await client.poll(jobId));
    expect(woke?.status).toBe("expressing");
    expect(woke?.rig?.layers.some((l) => l.variants !== undefined)).toBe(false);
    for (const layer of woke?.rig?.layers ?? []) expect(woke?.assets?.[layer.file]).toBeDefined();
    expect(woke?.assets?.["head.joy.png"]).toBeUndefined();
    expect(woke?.expressions).toEqual({});
    vi.advanceTimersByTime(REPLAY_FACE_HOLD_MS);
    const joy = await client.poll(jobId);
    expect(joy.expressions).toEqual({ joy: "ok" });
    expect(Object.keys(joy.rig?.layers.find((l) => l.name === "head")?.variants ?? {})).toEqual(["joy"]);
    expect(joy.assets?.["head.joy.png"]).toBe(PIXEL_PNG);
    vi.advanceTimersByTime(REPLAY_FACE_HOLD_MS * 2);
    expect((await client.poll(jobId)).expressions).toEqual({ joy: "ok", showman: "skipped", anger: "ok" });
    vi.advanceTimersByTime(REPLAY_FACE_HOLD_MS * 3);
    const done = await client.poll(jobId);
    expect(done.status).toBe("done");
    expect(done.rig).toEqual(job.rig);
    expect(Object.keys(done.expressions ?? {})).toHaveLength(6);
  });

  it("a recorded job without faces keeps its steps: awake is done", async () => {
    const client = createReplayForgeClient({ jobs });
    const { jobId } = await client.start(PROMPT);
    vi.advanceTimersByTime(7600);
    const done = await client.poll(jobId);
    expect(done.status).toBe("done");
    expect(done.expressions).toBeUndefined();
  });

  it("every committed job with faces loads with the expressing hold before done", async () => {
    for (const job of await loadReplayJobs()) {
      const hasFaces = job.rig.layers.some((l) => l.variants !== undefined);
      expect(job.steps.map((s) => s.status).includes("expressing")).toBe(hasFaces);
      expect(job.steps.at(-1)?.status).toBe("done");
    }
  });
});
