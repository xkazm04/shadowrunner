// The replay forge client (creator design.md "Plane and client selection"): on the replay plane the
// creator forges in the browser from the recorded jobs, with no request to /api. It walks
// queued -> portrait -> segmenting -> cutting -> filling -> done on each job's recorded holds and
// returns that job's rig (labelled RECORDED by the page). `?forge=fail:<code>` makes it fail with
// that code, so every failure state is reachable in replay and in tests.
//
// Decisions the spec leaves open:
// - Stateless like the server's replay: the job id carries the slug, the start time and the
//   seeded failure (`replay_<slug>_<t36>[_<code>]`), so polling resumes after a reload.
// - The job is chosen by hashing the prompt (or the upload): the same text, the same character.
//   A brief (cast-forge 4.3) starts the job recorded from its one_line_request when there is one
//   (a cast member), else the hash of that request.
// - Where each seeded failure happens mirrors the server: `quota` and `bad_input` are refused at
//   start (POST answers 429 / 400); `refused_likeness` and `refused_content` fail after the
//   portrait step; `upstream` fails while cutting.
import { requestKey } from "@sr/forge/brief";
import type { ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";
import { ForgeError, isForgeErrorCode, type ForgeClient } from "./forgeClient";
import { loadReplayJobs, statusAt, type ReplayJob } from "./replayJobs";

export const FAIL_MESSAGES: Readonly<Record<ForgeErrorCode, string>> = {
  quota: "Tonight's forging budget is spent.",
  refused_likeness: "That picture looks like a real person.",
  refused_content: "The forge will not make that.",
  upstream: "The image model stopped answering.",
  bad_input: "The forge could not read that request.",
};

/** Where a seeded runtime failure lands: the status the job reaches before it fails. */
const FAIL_AFTER: Readonly<Partial<Record<ForgeErrorCode, ForgeStatus>>> = {
  refused_likeness: "portrait",
  refused_content: "portrait",
  upstream: "cutting",
};

/** `?forge=fail:<code>` -> that code; undefined for anything else. */
export function failOf(search: string): ForgeErrorCode | undefined {
  for (const value of new URLSearchParams(search).getAll("forge")) {
    const v = value.trim().toLowerCase();
    const code = v.slice("fail:".length);
    if (v.startsWith("fail:") && isForgeErrorCode(code)) return code;
  }
  return undefined;
}

/** FNV-1a over the trimmed, lower-cased key: a stable index for `count` jobs. */
export function pickIndex(key: string, count: number): number {
  let h = 0x811c9dc5;
  for (const ch of key.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return count <= 0 ? 0 : h % count;
}

export function replayJobId(slug: string, startedAt: number, fail?: ForgeErrorCode): string {
  const base = `replay_${slug}_${Math.max(0, Math.floor(startedAt)).toString(36)}`;
  return fail === undefined ? base : `${base}_${fail}`;
}

const JOB_ID = /^replay_([a-z0-9-]{1,48})_([0-9a-z]{1,12})(?:_([a-z_]+))?$/;

export function parseReplayJobId(jobId: string): { slug: string; startedAt: number; fail?: ForgeErrorCode } | undefined {
  const m = JOB_ID.exec(jobId);
  if (m?.[1] === undefined || m[2] === undefined) return undefined;
  const startedAt = Number.parseInt(m[2], 36);
  if (m[3] === undefined) return { slug: m[1], startedAt };
  return isForgeErrorCode(m[3]) ? { slug: m[1], startedAt, fail: m[3] } : undefined;
}

const ORDER: readonly ForgeStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling", "done"];

/** The view of `job` at `status` (portrait from segmenting on, rig and assets when done). */
export function viewOf(job: ReplayJob, jobId: string, status: ForgeStatus): JobView {
  const view: JobView = { jobId, status, plane: "replay" };
  if (ORDER.indexOf(status) >= ORDER.indexOf("segmenting")) view.portraitUrl = job.portraitUrl;
  if (status === "done") {
    view.rig = job.rig;
    view.assets = { ...job.assets };
    if (job.fill !== undefined) view.fill = job.fill;
  }
  return view;
}

export interface ReplayClientOptions {
  /** The recorded jobs; default: the committed ones. */
  jobs?: () => Promise<readonly ReplayJob[]>;
  /** Seeded failure; default: none. */
  fail?: ForgeErrorCode;
  /** Clock, ms; default `Date.now`. */
  now?: () => number;
}

function keyOf(req: ForgeRequest): string | undefined {
  if (req.mode === "brief") return req.brief?.one_line_request;
  if (req.mode === "prompt") return typeof req.prompt === "string" && req.prompt.trim() !== "" ? req.prompt : undefined;
  return typeof req.imageBase64 === "string" && req.imageBase64 !== "" ? req.imageBase64.slice(0, 4096) : undefined;
}

export function createReplayForgeClient(options: ReplayClientOptions = {}): ForgeClient {
  const jobs = options.jobs ?? loadReplayJobs;
  const now = options.now ?? (() => Date.now());
  return {
    async start(req) {
      if (options.fail === "quota" || options.fail === "bad_input") throw new ForgeError(options.fail, FAIL_MESSAGES[options.fail]);
      const key = keyOf(req);
      if (key === undefined) throw new ForgeError("bad_input", "Describe a character or bring a picture.");
      const list = await jobs();
      const cast = req.mode === "brief" ? list.find((j) => j.prompt !== undefined && requestKey(j.prompt) === requestKey(key)) : undefined;
      const job = cast ?? list[pickIndex(key, list.length)];
      if (job === undefined) throw new ForgeError("upstream", "No recorded forges are available.");
      return { jobId: replayJobId(job.slug, now(), options.fail) };
    },
    async poll(jobId) {
      const id = parseReplayJobId(jobId);
      const job = id === undefined ? undefined : (await jobs()).find((j) => j.slug === id.slug);
      if (id === undefined || job === undefined) throw new ForgeError("bad_input", "No such forge job.");
      const status = statusAt(job.steps, Math.max(0, now() - id.startedAt));
      const failAt = id.fail === undefined ? undefined : FAIL_AFTER[id.fail];
      if (id.fail !== undefined && failAt !== undefined && ORDER.indexOf(status) > ORDER.indexOf(failAt)) {
        return { jobId, status: "failed", plane: "replay", error: { code: id.fail, message: FAIL_MESSAGES[id.fail] } };
      }
      return viewOf(job, jobId, status);
    },
  };
}
