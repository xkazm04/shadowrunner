// The recorded forge jobs on the client: `assets/replay/forge/<slug>/job.json` and its files, the
// same jobs the server's replay plane serves (api/_lib/forge-replay.ts). The replay client walks
// their recorded holds and the gallery lists their rigs. Coded against the job format, not file
// names, so new jobs dropped into the folder appear without a code change.
//
// Decisions the spec leaves open:
// - design.md names `assets/replay/forge-timings.json`; it does not exist. Each job's own
//   `steps` (status + holdMs, recorded by the forge lane) are the timings instead.
// - The manifests are imported lazily (one small chunk per job) and the images as URLs, so the
//   creator's own bundle carries no art; an image is fetched only when it is shown or adopted.
import type { ForgeStatus } from "@sr/forge/wire";
import { validateRig, type Rig } from "@sr/rig";

export interface ReplayStep {
  status: ForgeStatus;
  holdMs: number;
}

export interface ReplayJob {
  slug: string;
  name: string;
  /** The text the job was forged from, when recorded. */
  prompt?: string;
  /** Holds per status in order, ending with "done" (hold 0). */
  steps: ReplayStep[];
  portraitUrl: string;
  /** A small still of the portrait (`assets/replay/thumbs/<slug>.webp`), when one is committed. */
  thumbUrl?: string;
  rig: Rig;
  /** Layer.file -> URL. */
  assets: Record<string, string>;
  fill?: "edit" | "fallback";
}

const ORDER: readonly ForgeStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling", "done"];
const SLUG = /^[a-z0-9-]{1,48}$/;

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * One manifest plus its files (name in the job folder -> URL), or undefined when anything is off:
 * a job must be fictional, its rig must validate and be fictional, its steps must move forward and
 * end in "done", and the portrait and every layer file must exist.
 */
export function replayJobOf(value: unknown, files: Readonly<Record<string, string>>): ReplayJob | undefined {
  if (!isRecord(value) || typeof value.slug !== "string" || !SLUG.test(value.slug) || typeof value.name !== "string") return undefined;
  if (value.fictional !== true || typeof value.portrait !== "string" || !Array.isArray(value.steps)) return undefined;
  const rig = validateRig(value.rig);
  if (!rig.ok || rig.value.fictional !== true) return undefined;
  const steps: ReplayStep[] = [];
  for (const step of value.steps) {
    if (!isRecord(step) || typeof step.status !== "string" || !(ORDER as readonly string[]).includes(step.status)) return undefined;
    const status = step.status as ForgeStatus;
    const holdMs = status === "done" ? 0 : step.holdMs;
    if (typeof holdMs !== "number" || !Number.isFinite(holdMs) || holdMs < 0) return undefined;
    steps.push({ status, holdMs });
  }
  const ranks = steps.map((s) => ORDER.indexOf(s.status));
  if (steps.at(-1)?.status !== "done" || ranks.some((r, i) => i > 0 && r <= (ranks[i - 1] ?? -1))) return undefined;
  const portraitUrl = files[value.portrait];
  if (portraitUrl === undefined) return undefined;
  const assets: Record<string, string> = {};
  for (const layer of rig.value.layers) {
    const url = files[layer.file];
    if (url === undefined) return undefined;
    assets[layer.file] = url;
  }
  const job: ReplayJob = { slug: value.slug, name: value.name, steps, portraitUrl, rig: rig.value, assets };
  if (typeof value.prompt === "string" && value.prompt !== "") job.prompt = value.prompt;
  if (value.fill === "edit" || value.fill === "fallback") job.fill = value.fill;
  return job;
}

/** The status `elapsedMs` after the start, walking the recorded holds. */
export function statusAt(steps: readonly ReplayStep[], elapsedMs: number): ForgeStatus {
  let end = 0;
  for (const step of steps) {
    end += step.holdMs;
    if (step.status === "done" || elapsedMs < end) return step.status;
  }
  return "done";
}

/** Total recorded time of a job, ms. */
export const durationOf = (steps: readonly ReplayStep[]): number => steps.reduce((sum, s) => sum + s.holdMs, 0);

const MANIFESTS = import.meta.glob<unknown>("../../../../assets/replay/forge/*/job.json", { import: "default" });
const FILES = import.meta.glob<string>("../../../../assets/replay/forge/*/*.{png,jpg,jpeg,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});

// Small stills for lists (CH 4, the gallery), kept outside the job folders, which the forge-replay
// script rebuilds from scratch. A job without one falls back to its full portrait.
const THUMBS = import.meta.glob<string>("../../../../assets/replay/thumbs/*.webp", { eager: true, query: "?url", import: "default" });

/** The committed still for a job slug, if any. */
export function thumbOf(slug: string): string | undefined {
  return Object.entries(THUMBS).find(([path]) => path.endsWith(`/${slug}.webp`))?.[1];
}

/** Folder path -> (file name -> URL). */
function filesByFolder(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const [path, url] of Object.entries(FILES)) {
    const cut = path.lastIndexOf("/");
    const dir = path.slice(0, cut + 1);
    const own = out.get(dir) ?? {};
    own[path.slice(cut + 1)] = url;
    out.set(dir, own);
  }
  return out;
}

let loaded: Promise<ReplayJob[]> | undefined;

/** Every committed job that passes `replayJobOf`, by slug. Loaded once per page. */
export function loadReplayJobs(): Promise<ReplayJob[]> {
  loaded ??= (async () => {
    const files = filesByFolder();
    const jobs = await Promise.all(
      Object.entries(MANIFESTS).map(async ([path, load]) => {
        const dir = path.slice(0, path.lastIndexOf("/") + 1);
        const job = replayJobOf(await load(), files.get(dir) ?? {});
        const thumbUrl = job === undefined ? undefined : thumbOf(job.slug);
        return job === undefined || thumbUrl === undefined ? job : { ...job, thumbUrl };
      }),
    );
    return jobs.filter((j): j is ReplayJob => j !== undefined).sort((a, b) => a.slug.localeCompare(b.slug));
  })();
  return loaded;
}
