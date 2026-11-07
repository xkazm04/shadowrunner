// The forge's replay plane (forge-pipeline requirement 7.5, task 8): pre-forged jobs from
// assets/replay/forge/<slug>/ (built offline by scripts/forge-replay.mjs). No key, no quota, no
// network. Task 9: only each job.json is bundled into the function; the portrait and layer images
// are static files, published from assets/replay/** at /replay/** (scripts/vercel-output.mjs), and
// the job view names them by that URL, so a `done` response stays small (well under 100 KB).
// Stateless on purpose: replay instances share nothing, so the job id carries the slug and the start
// time, and every GET derives the status from the elapsed time and the recorded per-status holds
// (1.5-3 s each). POST picks a job by hashing the prompt (or the upload), so the same text always
// gets the same character.
// forge-creator C1: a recorded job whose rig carries expression patches gets one synthetic
// `expressing` hold after its recorded steps (@sr/forge replayFaces): awake at once with the faces
// stripped, the recorded faces arriving one family at a time, as a live job wakes after its eyes.
import { createHash } from "node:crypto";
import {
  assetsWithFaces,
  facesAt,
  facesOutcomes,
  parseForgeRequest,
  requestKey,
  rigWithFaces,
  withFacesStep,
  type ForgeRequest,
  type ForgeStatus,
  type JobView,
} from "@sr/forge";
import { validateRig, type Rig } from "@sr/rig";
import { errorBody } from "./errors.js";
import type { ForgeReplay } from "./forge-api.js";

const NO_STORE = { "cache-control": "no-store" };

/** Where assets/replay/forge/<slug>/<file> is served. */
export const REPLAY_BASE = "/replay/forge";

export interface ReplayJob {
  slug: string;
  name: string;
  /** The text the job was forged from, when recorded (a cast job records its one_line_request). */
  prompt?: string;
  /** How the recorded job's plate was filled (task 9 jobs record it; older ones were all fallback). */
  fill: "edit" | "fallback";
  /** Holds per status in order, ending with "done" (with the synthetic faces hold when the rig has faces). */
  steps: { status: ForgeStatus; holdMs: number }[];
  portraitUrl: string;
  rig: Rig;
  assets: Record<string, string>;
}

const STATUS_ORDER: readonly ForgeStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling", "expressing", "done"];
const SLUG = /^[a-z0-9-]{1,48}$/;
/** A file in the job's own folder: no path, no scheme. */
const FILE = /^[a-z0-9_-]{1,48}\.(png|jpg)$/;
/** A layer's region map or expression patch (character-control): `<layer>.regions.png`, `<layer>.<family>.png`. */
const EXTRA_FILE = /^[a-z0-9_]{1,48}\.(?:regions\.png|(?:joy|showman|anger|gloom|smug|suspicion)\.(?:png|webp))$/;

/**
 * Every file the rig names (layer files, region maps, variant patches) -> its static URL under
 * `base`; undefined when any is not a plain file name in the job's folder.
 */
export function replayAssets(rig: Rig, base: string): Record<string, string> | undefined {
  const assets: Record<string, string> = {};
  for (const layer of rig.layers) {
    const extras = [...(layer.regions === undefined ? [] : [layer.regions.map]), ...Object.values(layer.variants ?? {}).map((p) => p.file)];
    if (!FILE.test(layer.file) || extras.some((f) => !EXTRA_FILE.test(f))) return undefined;
    for (const file of [layer.file, ...extras]) assets[file] = base + file;
  }
  return assets;
}

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isStatus = (v: unknown): v is ForgeStatus => typeof v === "string" && (STATUS_ORDER as readonly string[]).includes(v);

/**
 * One committed job.json -> a replay job whose images are static URLs under REPLAY_BASE/<slug>/.
 * Undefined when anything is off: a recorded job must be fictional, its rig must validate, its
 * holds must be 1.5-3 s in status order, and its portrait and every layer file must be a plain
 * .png/.jpg name in its folder, every region map and variant patch a `<layer>.<suffix>.png` there (that the files exist is checked by the build and by the tests).
 */
export function replayJobOf(value: unknown): ReplayJob | undefined {
  if (!isRecord(value) || typeof value.slug !== "string" || !SLUG.test(value.slug) || typeof value.name !== "string") return undefined;
  if (value.fictional !== true || typeof value.portrait !== "string" || !FILE.test(value.portrait) || !Array.isArray(value.steps)) return undefined;
  const rig = validateRig(value.rig);
  if (!rig.ok || !rig.value.fictional) return undefined;
  const steps: ReplayJob["steps"] = [];
  for (const step of value.steps) {
    if (!isRecord(step) || !isStatus(step.status)) return undefined;
    const holdMs = step.status === "done" ? 0 : step.holdMs;
    if (typeof holdMs !== "number" || (step.status !== "done" && (holdMs < 1500 || holdMs > 3000))) return undefined;
    steps.push({ status: step.status, holdMs });
  }
  const order = steps.map((s) => STATUS_ORDER.indexOf(s.status));
  if (steps.at(-1)?.status !== "done" || order.some((r, i) => i > 0 && r <= (order[i - 1] ?? -1))) return undefined;
  const base = `${REPLAY_BASE}/${value.slug}/`;
  const assets = replayAssets(rig.value, base);
  if (assets === undefined) return undefined;
  const fill = value.fill === "edit" ? "edit" : "fallback";
  const prompt = typeof value.prompt === "string" ? { prompt: value.prompt } : {};
  return { slug: value.slug, name: value.name, ...prompt, fill, steps: withFacesStep(steps, rig.value), portraitUrl: base + value.portrait, rig: rig.value, assets };
}

/** The committed job manifests, bundled at build time (Vite glob import; vitest resolves it the same way). */
function bundledJobs(): ReplayJob[] {
  const manifests = import.meta.glob("../../assets/replay/forge/*/job.json", { eager: true, import: "default" });
  const jobs: ReplayJob[] = [];
  for (const [path, manifest] of Object.entries(manifests)) {
    const job = replayJobOf(manifest);
    if (job) jobs.push(job);
    else console.warn(`forge replay: skipped an invalid recorded job (${path})`);
  }
  return jobs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The recorded job for a request. Mode brief (cast-forge 4.3): the job recorded from the brief's
 * one_line_request (a cast member), when there is one; otherwise, and for the other modes, the
 * prompt-hash pick over all jobs.
 */
export function pickJob<J extends { prompt?: string }>(req: ForgeRequest, jobs: readonly J[]): J | undefined {
  const asked = req.brief?.one_line_request;
  const cast = asked === undefined ? undefined : jobs.find((j) => j.prompt !== undefined && requestKey(j.prompt) === requestKey(asked));
  return cast ?? jobs[pickIndex(asked ?? req.prompt ?? req.imageBase64 ?? "", Math.max(jobs.length, 1))];
}

/** Index of the job for this request text: the first 4 bytes of its SHA-256, modulo the job count. */
export function pickIndex(key: string, count: number): number {
  return createHash("sha256").update(key.trim().toLowerCase()).digest().readUInt32BE(0) % count;
}

export function replayJobId(slug: string, startedAt: number): string {
  return `replay_${slug}_${Math.max(0, Math.floor(startedAt)).toString(36)}`;
}

/** The status `elapsedMs` after the start, walking the recorded holds. */
export function statusAt(job: ReplayJob, elapsedMs: number): ForgeStatus {
  let end = 0;
  for (const step of job.steps) {
    end += step.holdMs;
    if (step.status === "done" || elapsedMs < end) return step.status;
  }
  return "done";
}

/**
 * The view at `status`, `elapsedMs` after the start: the portrait from segmenting on; the rig and
 * its assets once awake (at done, and through the synthetic expressing hold with the faces that
 * have arrived by then, C1); what each arrived family came to when the job has an expressing hold.
 */
export function replayView(job: ReplayJob, jobId: string, status: ForgeStatus, elapsedMs = Number.POSITIVE_INFINITY): JobView {
  const view: JobView = { jobId, status, plane: "replay" };
  if (STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf("segmenting")) view.portraitUrl = job.portraitUrl;
  if (status === "expressing" || status === "done") {
    const arrived = status === "done" ? Number.POSITIVE_INFINITY : facesAt(job.steps, elapsedMs);
    const rig = rigWithFaces(job.rig, arrived);
    view.rig = rig;
    view.assets = assetsWithFaces(job.rig, rig, job.assets);
    if (job.steps.some((s) => s.status === "expressing")) view.expressions = facesOutcomes(job.rig, arrived);
  }
  if (status === "done") {
    view.rig = job.rig;
    view.assets = job.assets;
    view.fill = job.fill;
  }
  return view;
}

export function createForgeReplay(jobs: readonly ReplayJob[]): ForgeReplay {
  const bySlug = new Map(jobs.map((j) => [j.slug, j]));
  const unavailable = () => Response.json(errorBody("upstream", "No recorded forges are available."), { status: 502, headers: NO_STORE });
  return {
    async post(body, now) {
      const parsed = parseForgeRequest(body);
      if (!parsed.ok) return Response.json(errorBody("bad_input", parsed.errors.message), { status: 400, headers: NO_STORE });
      const job = pickJob(parsed.value, jobs);
      if (job === undefined) return unavailable();
      return Response.json({ jobId: replayJobId(job.slug, now) }, { status: 202, headers: NO_STORE });
    },
    async get(jobId, now) {
      const match = /^replay_([a-z0-9-]{1,48})_([0-9a-z]{1,12})$/.exec(jobId);
      const job = match?.[1] === undefined ? undefined : bySlug.get(match[1]);
      if (match?.[2] === undefined || job === undefined) {
        return Response.json(errorBody("bad_input", "No such forge job."), { status: 404, headers: NO_STORE });
      }
      const elapsed = Math.max(0, now - Number.parseInt(match[2], 36));
      return Response.json(replayView(job, jobId, statusAt(job, elapsed), elapsed), { headers: NO_STORE });
    },
  };
}

let shared: ForgeReplay | undefined;

/** The replay plane over the committed jobs, built on first use. */
export const bundledReplay: ForgeReplay = {
  post: (body, now) => (shared ??= createForgeReplay(bundledJobs())).post(body, now),
  get: (jobId, now) => (shared ??= createForgeReplay(bundledJobs())).get(jobId, now),
};
