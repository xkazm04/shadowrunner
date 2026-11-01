// The server-side forge job record (forge-pipeline design.md "Job store", task 7). It lives in the
// JobStore between steps (KV on the live plane, at most 50 KB): statuses, parts and URLs, never
// image bytes. `toJobView` is the only way a record reaches the client.
import type { Rig } from "@sr/rig";
import type { Part } from "./types.js";
import type { ForgeErrorCode, ForgeStatus, JobView } from "./wire.js";

export type PortraitMime = "image/png" | "image/jpeg" | "image/webp";

/** The pipeline steps, as timed in `ForgeJob.timings` (milliseconds of each step's own work). */
export const FORGE_STEPS = ["classify", "portrait", "parts", "fill", "cut"] as const;
export type ForgeStep = (typeof FORGE_STEPS)[number];

export interface ForgeJob {
  jobId: string;
  plane: "replay" | "live";
  mode: "prompt" | "image";
  status: ForgeStatus;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the step in flight; a second GET inside the lease does not run it again. */
  stepStartedAt?: number;
  /** The user's text (mode "prompt"), at most MAX_CHARACTER_TEXT characters are used. */
  prompt?: string;
  /** The accepted upload (mode "image"), kept only for the job's 24 h lifetime. */
  uploadUrl?: string;
  uploadMime?: PortraitMime;
  portraitUrl?: string;
  portraitMime?: PortraitMime;
  parts?: Part[];
  /** Parts requests made so far (one re-ask after malformed JSON). */
  partsAsks?: number;
  /** The filled portrait from the Gemini edit (fill "edit"). */
  plateUrl?: string;
  fill?: "edit" | "fallback";
  rig?: Rig;
  assets?: Record<string, string>;
  error?: { code: ForgeErrorCode; message: string };
  timings?: Partial<Record<ForgeStep, number>>;
}

/** The client's view of a job (design.md `JobView`): optional fields omitted, never null. */
export function toJobView(job: ForgeJob): JobView {
  const showPortrait = job.status !== "queued" && job.status !== "portrait";
  return {
    jobId: job.jobId,
    status: job.status,
    plane: job.plane,
    ...(showPortrait && job.portraitUrl !== undefined ? { portraitUrl: job.portraitUrl } : {}),
    ...(job.status === "done" && job.rig !== undefined ? { rig: job.rig } : {}),
    ...(job.status === "done" && job.assets !== undefined ? { assets: job.assets } : {}),
    ...(job.fill !== undefined && job.status === "done" ? { fill: job.fill } : {}),
    ...(job.status === "failed" && job.error !== undefined ? { error: job.error } : {}),
  };
}
