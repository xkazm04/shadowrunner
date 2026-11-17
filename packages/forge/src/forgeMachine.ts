// @sr/forge/machine: the forge job's lifecycle, the one runtime definition of it. The status order,
// the error codes and the cast's statuses (wire.ts derives its unions from these lists), the step
// each status runs (api/_lib/forge-steps.ts dispatches by it), the legal transitions, and what a
// record at each status must carry (validate.ts `parseForgeJob` ends with `jobShapeError`, so a
// record whose status contradicts its fields is refused at the store boundary). Pure and
// type-imports only, so it is safe to import in the browser.
//
// Status names follow what the client sees, not the server's step: "cutting" runs the fill edit,
// "filling" composes the plate, cuts and assembles (the status names the step that comes NEXT).
import type { ForgeJob, ForgeStep } from "./job.js";
import type { ForgeErrorCode, ForgeStatus } from "./wire.js";

/** Every job status, in step order; `failed` last. */
export const FORGE_STATUSES = ["queued", "portrait", "segmenting", "cutting", "filling", "expressing", "done", "failed"] as const;

/** The statuses a job is still moving through, in order (neither `done` nor `failed`). */
export const RUNNING_STATUSES = ["queued", "portrait", "segmenting", "cutting", "filling", "expressing"] as const;

/** Error codes that may cross the API in `{ error: { code, message } }`. */
export const FORGE_ERROR_CODES = ["quota", "refused_likeness", "refused_content", "upstream", "bad_input"] as const;

export const isForgeStatus = (v: unknown): v is ForgeStatus => typeof v === "string" && (FORGE_STATUSES as readonly string[]).includes(v);
export const isForgeErrorCode = (v: unknown): v is ForgeErrorCode => typeof v === "string" && (FORGE_ERROR_CODES as readonly string[]).includes(v);

/** forge-creator L2: a casting batch's statuses, in order; `failed` last. */
export const CAST_STATUSES = ["drafting", "segmenting", "cutting", "ready", "failed"] as const;

/** The step a GET runs at each status. `queued` runs on POST (startJob); `expressing` is per family (forge-expressions.ts). */
export const STEP_OF_STATUS: Readonly<Partial<Record<ForgeStatus, ForgeStep>>> = {
  portrait: "portrait",
  segmenting: "parts",
  cutting: "fill",
  filling: "cut",
};

export const stepFor = (status: ForgeStatus): ForgeStep | undefined => STEP_OF_STATUS[status];

const PROGRESS: readonly ForgeStatus[] = [...RUNNING_STATUSES, "done"];
const isRunning = (status: ForgeStatus): boolean => (RUNNING_STATUSES as readonly ForgeStatus[]).includes(status);

/**
 * Whether one step may move a job from `from` to `to`: forward in step order, to `failed` from any
 * running status, or `segmenting` again (a malformed parts reply is re-asked on the next GET).
 * Nothing leaves `done` or `failed`.
 */
export function canAdvance(from: ForgeStatus, to: ForgeStatus): boolean {
  if (!isRunning(from)) return false;
  if (to === "failed") return true;
  if (from === "segmenting" && to === "segmenting") return true;
  return PROGRESS.indexOf(to) > PROGRESS.indexOf(from);
}

type Need = { name: string; has: (job: ForgeJob) => boolean };
const field = (name: keyof ForgeJob): Need => ({ name, has: (job) => job[name] !== undefined });
const PORTRAIT: Need[] = [field("portraitUrl"), field("portraitMime")];
const PARTS: Need = { name: "parts or named", has: (job) => job.parts !== undefined || job.named !== undefined };

/**
 * What a record at each status carries, limited to what every writer today always sets (so a
 * record in flight across a deploy still reads). An image job at `portrait` holds its upload.
 */
function needsOf(job: ForgeJob): Need[] {
  switch (job.status) {
    case "portrait":
      return job.mode === "image" ? [field("uploadUrl"), field("uploadMime")] : [];
    case "segmenting":
      return PORTRAIT;
    case "cutting":
      return [...PORTRAIT, PARTS];
    case "filling":
      return [...PORTRAIT, PARTS, field("fill")];
    case "expressing":
      return [field("rig"), field("assets"), field("expressionIndex")];
    case "done":
      return [field("rig"), field("assets")];
    case "failed":
      return [field("error")];
    default:
      return [];
  }
}

/** Why a record cannot be at its status (`<status> needs <fields>`), or undefined when it is whole. */
export function jobShapeError(job: ForgeJob): string | undefined {
  const needs = needsOf(job);
  return needs.every((need) => need.has(job)) ? undefined : `${job.status} needs ${needs.map((need) => need.name).join(", ")}`;
}
