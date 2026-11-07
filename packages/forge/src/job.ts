// The server-side forge job record (forge-pipeline design.md "Job store", task 7). It lives in the
// JobStore between steps (KV on the live plane, at most 50 KB): statuses, parts and URLs, never
// image bytes. `toJobView` is the only way a record reaches the client.
import type { ExpressionFamily, Rig } from "@sr/rig";
import type { Part, PartsV2 } from "./types.js";
import type { CharacterBrief, Decomposition, ForgeErrorCode, ForgeStatus, JobView } from "./wire.js";

export type PortraitMime = "image/png" | "image/jpeg" | "image/webp";

/** The pipeline steps, as timed in `ForgeJob.timings` (milliseconds of each step's own work). */
export const FORGE_STEPS = ["classify", "portrait", "parts", "fill", "cut"] as const;
export type ForgeStep = (typeof FORGE_STEPS)[number];

export interface ForgeJob {
  jobId: string;
  plane: "replay" | "live";
  mode: "prompt" | "image" | "brief";
  status: ForgeStatus;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the step in flight; a second GET inside the lease does not run it again. */
  stepStartedAt?: number;
  /** The user's text (mode "prompt"), at most MAX_CHARACTER_TEXT characters are used. */
  prompt?: string;
  /** The approved brief (mode "brief"): the portrait prompt and the parts plan (cast-forge task 11). */
  brief?: CharacterBrief;
  /** The accepted upload (mode "image"), kept only for the job's 24 h lifetime. */
  uploadUrl?: string;
  uploadMime?: PortraitMime;
  portraitUrl?: string;
  portraitMime?: PortraitMime;
  parts?: Part[];
  /** A brief job's named parts (cast-forge task 11), settled against the brief; then `parts` is unset. */
  named?: PartsV2;
  /** A brief job: "named" when the parts came from the brief, "fallback" when the v1 prompt took over. */
  decomposition?: Decomposition;
  /** Parts requests made so far (one re-ask after malformed JSON). */
  partsAsks?: number;
  /** The filled portrait from the Gemini edit (fill "edit"). */
  plateUrl?: string;
  fill?: "edit" | "fallback";
  rig?: Rig;
  assets?: Record<string, string>;
  /** Status "expressing" (character-control): the next family to run, an index into EXPRESSION_FAMILIES. */
  expressionIndex?: number;
  /**
   * face-control: the eye step (the first GET of "expressing") came to socketed eyes from the
   * iris-free edit ("edit"), from the pure fallback ("fallback"), or none ("none"); unset before it ran.
   */
  eyes?: "edit" | "fallback" | "none";
  /** What each expression family came to, from "expressing" on. */
  expressions?: Partial<Record<ExpressionFamily, ExpressionOutcome>>;
  error?: { code: ForgeErrorCode; message: string };
  timings?: Partial<Record<ForgeStep, number>>;
}

export type ExpressionOutcome = "ok" | "skipped" | "failed";

/**
 * forge-creator C1, wake after eyes: the job's rig is final in structure once the eye step has
 * settled (`eyes` set: socketed, fallback or none). From then on each expression family only adds
 * `Layer.variants` patches and their files, so the character can wake while its faces paint in.
 * True at `done`, and at `expressing` once `eyes` is set.
 */
export function isAwake(job: Pick<ForgeJob, "status" | "eyes">): boolean {
  return job.status === "done" || (job.status === "expressing" && job.eyes !== undefined);
}

/** The client's view of a job (design.md `JobView`): optional fields omitted, never null. */
export function toJobView(job: ForgeJob): JobView {
  const showPortrait = job.status !== "queued" && job.status !== "portrait";
  const awake = isAwake(job);
  return {
    jobId: job.jobId,
    status: job.status,
    plane: job.plane,
    ...(showPortrait && job.portraitUrl !== undefined ? { portraitUrl: job.portraitUrl } : {}),
    ...(awake && job.rig !== undefined ? { rig: job.rig } : {}),
    ...(awake && job.assets !== undefined ? { assets: job.assets } : {}),
    ...(job.fill !== undefined && job.status === "done" ? { fill: job.fill } : {}),
    ...(job.decomposition === undefined ? {} : { decomposition: job.decomposition }),
    ...(job.expressions === undefined ? {} : { expressions: { ...job.expressions } }),
    ...(job.status === "failed" && job.error !== undefined ? { error: job.error } : {}),
  };
}
