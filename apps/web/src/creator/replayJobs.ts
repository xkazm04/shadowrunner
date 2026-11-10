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
// - Served art is WebP (perfection-pass task 12): a cast job's PNGs stay in the repo as the sources
//   the pack builder and the forge scripts read, and only their `.webp` siblings
//   (scripts/art-webp.mjs) are bundled. The job's rig is handed out naming the file it is served
//   as, so a library record or an exported pack never carries WebP bytes under a `.png` name.
//   Malakor's job keeps its PNGs (pre-existing house art, never re-encoded).
import { withFacesStep } from "@sr/forge/replayFaces";
import type { ForgeStatus } from "@sr/forge/wire";
import { validateRig, type Layer, type Rig } from "@sr/rig";
import { rigFiles } from "./library/assets";

export interface ReplayStep {
  status: ForgeStatus;
  holdMs: number;
}

export interface ReplayJob {
  slug: string;
  name: string;
  /** The text the job was forged from, when recorded. */
  prompt?: string;
  /** Holds per status in order, ending with "done" (hold 0); a rig with faces adds the synthetic expressing hold (C1). */
  steps: ReplayStep[];
  portraitUrl: string;
  /** A small still of the portrait (`assets/replay/thumbs/<slug>.webp`), when one is committed. */
  thumbUrl?: string;
  rig: Rig;
  /** Layer.file -> URL. */
  assets: Record<string, string>;
  fill?: "edit" | "fallback";
  /** How long each model step took on the live run that was recorded (job.json `timings`), ms. */
  live?: Partial<Record<ForgeStatus, number>>;
}

/** job.json `timings` keys -> the status whose model work they measured. */
const LIVE_KEYS: Readonly<Record<string, ForgeStatus>> = { portraitMs: "portrait", partsMs: "segmenting", cutMs: "cutting", fillMs: "filling" };

function liveOf(value: unknown): Partial<Record<ForgeStatus, number>> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Partial<Record<ForgeStatus, number>> = {};
  for (const [key, status] of Object.entries(LIVE_KEYS)) {
    const ms = value[key];
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) out[status] = ms;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** `rig` with every image file it names (layers, region maps, faces, sockets, lids) passed through `serve`. */
export function servedRig(rig: Rig, serve: (file: string) => string): Rig {
  const layers = rig.layers.map((layer): Layer => {
    const next: Layer = { ...layer, file: serve(layer.file) };
    if (layer.regions !== undefined) next.regions = { ...layer.regions, map: serve(layer.regions.map) };
    if (layer.socket !== undefined) next.socket = serve(layer.socket);
    if (layer.closed !== undefined) next.closed = serve(layer.closed);
    if (layer.variants !== undefined) {
      next.variants = Object.fromEntries(
        Object.entries(layer.variants).map(([family, patch]) => [family, { ...patch, file: serve(patch.file), ...(patch.socket === undefined ? {} : { socket: serve(patch.socket) }) }]),
      );
    }
    return next;
  });
  return { ...rig, layers };
}

/** The name a job file is served as: itself when bundled, else its committed `.webp` sibling (task 12). */
export function servedName(file: string, files: Readonly<Record<string, string>>): string {
  if (files[file] !== undefined || !file.endsWith(".png")) return file;
  const webp = `${file.slice(0, -".png".length)}.webp`;
  return files[webp] === undefined ? file : webp;
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
  const portraitUrl = files[servedName(value.portrait, files)];
  if (portraitUrl === undefined) return undefined;
  const served = servedRig(rig.value, (file) => servedName(file, files));
  const assets: Record<string, string> = {};
  const layerFiles = new Set(served.layers.map((l) => l.file));
  // Layer images must exist; region maps and expression patches (character-control) when committed.
  for (const file of rigFiles(served)) {
    const url = files[file];
    if (url === undefined && layerFiles.has(file)) return undefined;
    if (url !== undefined) assets[file] = url;
  }
  // forge-creator C1: a rig with faces gets the synthetic expressing hold (the server's replay does the same).
  const job: ReplayJob = { slug: value.slug, name: value.name, steps: withFacesStep(steps, served), portraitUrl, rig: served, assets };
  if (typeof value.prompt === "string" && value.prompt !== "") job.prompt = value.prompt;
  if (value.fill === "edit" || value.fill === "fallback") job.fill = value.fill;
  const live = liveOf(value.timings);
  if (live !== undefined) job.live = live;
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
// A cast job's PNGs are not bundled (their WebP is); Malakor's are (house art, never re-encoded).
const FILES = import.meta.glob<string>(["../../../../assets/replay/forge/*/*.{jpg,jpeg,webp}", "../../../../assets/replay/forge/malakor/*.png"], {
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
