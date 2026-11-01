// The forge's replay plane (forge-pipeline requirement 7.5, task 8): pre-forged jobs from
// assets/replay/forge/<slug>/ (built offline by scripts/forge-replay.mjs). No key, no quota, no
// network: the job files are bundled into the function as data: URLs at build time.
// Stateless on purpose: replay instances share nothing, so the job id carries the slug and the start
// time, and every GET derives the status from the elapsed time and the recorded per-status holds
// (1.5-3 s each). POST picks a job by hashing the prompt (or the upload), so the same text always
// gets the same character.
import { createHash } from "node:crypto";
import { parseForgeRequest, type ForgeStatus, type JobView } from "@sr/forge";
import { validateRig, type Rig } from "@sr/rig";
import { errorBody } from "./errors.js";
import type { ForgeReplay } from "./forge-api.js";

const NO_STORE = { "cache-control": "no-store" };

export interface ReplayJob {
  slug: string;
  name: string;
  /** Holds per status in order, ending with "done". */
  steps: { status: ForgeStatus; holdMs: number }[];
  portraitUrl: string;
  rig: Rig;
  assets: Record<string, string>;
}

const STATUS_ORDER: readonly ForgeStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling", "done"];
const SLUG = /^[a-z0-9-]{1,48}$/;

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isStatus = (v: unknown): v is ForgeStatus => typeof v === "string" && (STATUS_ORDER as readonly string[]).includes(v);

/**
 * One committed job.json plus its files (published path -> data: URL). Undefined, and a warning,
 * when anything is off: a recorded job must be fictional, its rig must validate, its holds must be
 * 1.5-3 s in status order, and every layer file must exist.
 */
export function replayJobOf(value: unknown, files: Readonly<Record<string, string>>): ReplayJob | undefined {
  if (!isRecord(value) || typeof value.slug !== "string" || !SLUG.test(value.slug) || typeof value.name !== "string") return undefined;
  if (value.fictional !== true || typeof value.portrait !== "string" || !Array.isArray(value.steps)) return undefined;
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
  const portraitUrl = files[value.portrait];
  if (portraitUrl === undefined) return undefined;
  const assets: Record<string, string> = {};
  for (const layer of rig.value.layers) {
    const url = files[layer.file];
    if (url === undefined || !url.startsWith("data:image/png;base64,")) return undefined;
    assets[layer.file] = url;
  }
  return { slug: value.slug, name: value.name, steps, portraitUrl, rig: rig.value, assets };
}

/** The committed jobs, bundled at build time (Vite glob imports; vitest resolves them the same way). */
function bundledJobs(): ReplayJob[] {
  const manifests = import.meta.glob("../../assets/replay/forge/*/job.json", { eager: true, import: "default" });
  const files = import.meta.glob<string>("../../assets/replay/forge/*/*.{png,jpg}", { eager: true, query: "?inline", import: "default" });
  const jobs: ReplayJob[] = [];
  for (const [path, manifest] of Object.entries(manifests)) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    const own: Record<string, string> = {};
    for (const [file, url] of Object.entries(files)) if (file.startsWith(dir)) own[file.slice(dir.length)] = url;
    const job = replayJobOf(manifest, own);
    if (job) jobs.push(job);
    else console.warn(`forge replay: skipped an invalid recorded job (${dir})`);
  }
  return jobs.sort((a, b) => a.slug.localeCompare(b.slug));
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

export function replayView(job: ReplayJob, jobId: string, status: ForgeStatus): JobView {
  const view: JobView = { jobId, status, plane: "replay" };
  if (STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf("segmenting")) view.portraitUrl = job.portraitUrl;
  if (status === "done") {
    view.rig = job.rig;
    view.assets = job.assets;
    view.fill = "fallback";
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
      const job = jobs[pickIndex(parsed.value.prompt ?? parsed.value.imageBase64 ?? "", Math.max(jobs.length, 1))];
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
      return Response.json(replayView(job, jobId, statusAt(job, elapsed)), { headers: NO_STORE });
    },
  };
}

let shared: ForgeReplay | undefined;

/** The replay plane over the committed jobs, built on first use. */
export const bundledReplay: ForgeReplay = {
  post: (body, now) => (shared ??= createForgeReplay(bundledJobs())).post(body, now),
  get: (jobId, now) => (shared ??= createForgeReplay(bundledJobs())).get(jobId, now),
};
