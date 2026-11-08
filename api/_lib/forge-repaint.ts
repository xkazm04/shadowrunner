// POST /api/forge/:jobId/faces (forge-creator S2, repaint one face): on a live job that is awake or
// done and unexpired (its start + 24 h, jobExpiresAt), one expression family is repainted with ONE
// paid edit (COST_USD.expression, charged in USD only through the step context: no per-IP forge
// count). Nothing else re-runs (no portrait, parts, fill or eye edits): the edit goes through the
// forge's own per-family pipeline (`paintFamily`: register, gate, cutVariants, socket re-read).
// - The prompt: `repaintAttempt` from the family's gate reading (`job.expressionGate`) and the
//   "too subtle" hint; the material sentence from the request's eyes line, else the brief's.
// - The answer is a candidate (RepaintCandidate). The job's stored rig is NOT changed: the client
//   merges the candidate on Accept. Its files are stored under the job as `<layer>.<family>_r<n>.png`.
// - Idempotent by `key` and capped (faceRepaint.ts): the ledger rides in the job record; a key is
//   reserved before the edit and settled after it. Writes re-read the record and change only the
//   ledger, so a forge step running meanwhile keeps its own fields.
// - Plane: `x-sr-plane: replay` (or a replay deploy) answers from the recorded jobs: the recorded
//   face, unchanged, `plane: "replay"`, or "no face to repaint"; no paid call, no store.
import type { ExpressionFamily, LayerPatch } from "@sr/rig";
import {
  MAX_FAMILY_REPAINTS,
  MAX_JOB_REPAINTS,
  REPAINT_PENDING_MS,
  expressionPrompt,
  eyesMaterial,
  gateReading,
  isAwake,
  jobExpiresAt,
  parseRepaintRequest,
  repaintAttempt,
  repaintRefusal,
  repaintTag,
  repaintsLeft,
  reserveRepaint,
  settleRepaint,
  type ForgeJob,
  type RepaintCandidate,
  type RepaintLedger,
  type RepaintRequest,
} from "@sr/forge";
import { COST_USD } from "./costs.js";
import { ApiError, errorBody, errorResponse } from "./errors.js";
import { context, type ForgeDeps } from "./forge-api.js";
import { paintFamily, type Painted } from "./forge-expressions.js";
import { bundledJobs, type ReplayJob } from "./forge-replay.js";
import { isJobId, type JobStore } from "./jobstore.js";
import { clientIp } from "./quota.js";
import { planeFromRequest } from "./plane.js";

const NO_STORE = { "cache-control": "no-store" };
/** A body larger than this is not a repaint request (a family, a key, a 200-character line). */
const MAX_BODY = 4096;

export const EXPIRED_MESSAGE = "Repaint was open for 24 h after the forge. This forge has expired.";
const badInput = (message: string, status?: number) => new ApiError("bad_input", message, status);

/** The job id of `/api/forge/<id>/faces` (or `?jobId=` when the rewrite passes it as a query). */
export function repaintJobIdOf(req: Request): string {
  const url = new URL(req.url, "http://localhost");
  const fromQuery = url.searchParams.get("jobId");
  if (fromQuery !== null) return fromQuery;
  const segments = url.pathname.split("/").filter(Boolean);
  return decodeURIComponent(segments.at(-1) === "faces" ? (segments.at(-2) ?? "") : "");
}

/** The family's patches in `rig`, by layer name. */
function familyPatches(rig: { layers: readonly { name: string; variants?: Partial<Record<ExpressionFamily, LayerPatch>> }[] }, family: ExpressionFamily): Record<string, LayerPatch> {
  const out: Record<string, LayerPatch> = {};
  for (const layer of rig.layers) {
    const patch = layer.variants?.[family];
    if (patch !== undefined) out[layer.name] = patch;
  }
  return out;
}

/** The replay twin (see the header): the recorded face, unchanged; never a paid call. */
export type ReplayFaces = (jobId: string, body: string) => Promise<Response>;

export function createReplayFaces(jobs: readonly ReplayJob[]): ReplayFaces {
  const bySlug = new Map(jobs.map((j) => [j.slug, j]));
  return async (jobId, body) => {
    const parsed = parseRepaintRequest(body);
    if (!parsed.ok) return Response.json(errorBody("bad_input", parsed.errors.message), { status: 400, headers: NO_STORE });
    const match = /^replay_([a-z0-9-]{1,48})_[0-9a-z]{1,12}$/.exec(jobId);
    const job = match?.[1] === undefined ? undefined : bySlug.get(match[1]);
    if (job === undefined) return Response.json(errorBody("bad_input", "No such recorded forge."), { status: 404, headers: NO_STORE });
    const { family } = parsed.value;
    const layers = familyPatches(job.rig, family);
    if (Object.keys(layers).length === 0) return Response.json(errorBody("bad_input", `This recorded character has no ${family} face to repaint.`), { status: 400, headers: NO_STORE });
    const assets: Record<string, string> = {};
    for (const patch of Object.values(layers)) {
      for (const file of [patch.file, ...(patch.socket === undefined ? [] : [patch.socket])]) {
        const url = job.assets[file];
        if (url !== undefined) assets[file] = url;
      }
    }
    const candidate: RepaintCandidate = { family, ok: true, plane: "replay", patch: { layers, assets }, left: { family: MAX_FAMILY_REPAINTS, job: MAX_JOB_REPAINTS } };
    return Response.json(candidate, { headers: NO_STORE });
  };
}

let shared: ReplayFaces | undefined;
/** The replay twin over the committed jobs, built on first use. */
export const bundledReplayFaces: ReplayFaces = (jobId, body) => (shared ??= createReplayFaces(bundledJobs()))(jobId, body);

/** Writes `ledger` into the stored job, re-read first so a forge step's own fields are kept. */
async function saveLedger(store: JobStore<ForgeJob>, jobId: string, ledger: RepaintLedger): Promise<void> {
  const fresh = await store.get(jobId);
  if (fresh === undefined) return;
  fresh.repaints = ledger;
  await store.put(fresh);
}

/** The job a repaint may run on, or the error that says why not. */
async function repaintable(store: JobStore<ForgeJob>, jobId: string, now: number): Promise<ForgeJob & Required<Pick<ForgeJob, "rig" | "assets" | "portraitUrl" | "portraitMime">>> {
  if (!isJobId(jobId)) throw badInput("No such forge job.", 404);
  const job = await store.get(jobId);
  if (job === undefined) throw badInput(EXPIRED_MESSAGE, 404);
  if (now >= jobExpiresAt(job)) throw badInput(EXPIRED_MESSAGE, 410);
  const { rig, assets, portraitUrl, portraitMime } = job;
  if (job.plane !== "live" || !isAwake(job) || rig === undefined || assets === undefined || portraitUrl === undefined || portraitMime === undefined) {
    throw badInput("This forge has no face to repaint yet.");
  }
  return { ...job, rig, assets, portraitUrl, portraitMime };
}

/** What a family's repaint may answer from the ledger alone: an earlier answer for the same key. */
function earlier(ledger: RepaintLedger | undefined, request: RepaintRequest, now: number): RepaintCandidate | undefined {
  const prior = ledger?.keys[request.key];
  if (prior === undefined) return undefined;
  if (prior.family !== request.family) throw badInput("That repaint key was used for another face.");
  if (prior.result !== undefined) return prior.result;
  if (now - prior.at < REPAINT_PENDING_MS) throw badInput("That repaint is still painting.");
  // A reserved repaint that never came back: it spent its turn and has no face.
  return { family: request.family, ok: false, plane: "live", gate: gateReading("failed"), left: repaintsLeft(ledger, request.family) };
}

/** POST /api/forge/:jobId/faces (see the header). */
export async function handleRepaintPost(req: Request, deps: ForgeDeps & { replayFaces?: ReplayFaces }): Promise<Response> {
  try {
    const now = deps.now();
    const jobId = repaintJobIdOf(req);
    const text = await req.text();
    if (planeFromRequest(req, deps.env) === "replay") return await (deps.replayFaces ?? bundledReplayFaces)(jobId, text);
    if (text.length > MAX_BODY) throw badInput("The request is too large.");
    const parsed = parseRepaintRequest(text);
    if (!parsed.ok) throw badInput(parsed.errors.message);
    const request = parsed.value;
    const { family } = request;
    const store = deps.store();
    const job = await repaintable(store, jobId, now);
    const answered = earlier(job.repaints, request, now);
    if (answered !== undefined) {
      // A stale reservation is settled as failed, so the key answers the same from now on.
      if (job.repaints !== undefined && job.repaints.keys[request.key]?.result === undefined) await saveLedger(store, jobId, settleRepaint(job.repaints, request.key, answered));
      return Response.json(answered, { headers: NO_STORE });
    }
    const refusal = repaintRefusal(job.repaints, family);
    if (refusal === "job") throw new ApiError("quota", `This character's ${MAX_JOB_REPAINTS} repaints are spent.`);
    if (refusal === "family") throw new ApiError("quota", `The ${family} face has been repainted ${MAX_FAMILY_REPAINTS} times already.`);

    const ctx = context(deps, store, clientIp(req));
    const bytes = await store.readImage(job.portraitUrl);
    if (!(await ctx.charge(COST_USD.expression))) throw new ApiError("quota", "The cellar's budget for today is spent. Try again tomorrow.");
    let ledger = reserveRepaint(job.repaints, request.key, family, now);
    await saveLedger(store, jobId, ledger);

    const attempt = repaintAttempt(job.expressionGate?.[family], request.hint);
    const material = eyesMaterial(request.eyes ?? job.brief?.face?.eyes);
    const prompt = expressionPrompt(job.brief?.name ?? job.rig.name, family, job.brief?.style.name, attempt, material);
    let painted: Painted;
    try {
      painted = await paintFamily({ ...job, repaints: ledger }, family, prompt, ctx, bytes, repaintTag(ledger, family));
    } catch (err) {
      console.warn(`forge: repaint ${family} failed (${err instanceof Error ? err.name : typeof err})`);
      painted = { verdict: "failed", reading: gateReading("failed"), edited: true };
    }
    const left = repaintsLeft(ledger, family);
    const candidate: RepaintCandidate =
      painted.verdict === "ok" && painted.patches !== undefined && painted.stored !== undefined
        ? { family, ok: true, plane: "live", patch: { layers: painted.patches, assets: painted.stored }, left }
        : { family, ok: false, plane: "live", gate: painted.reading ?? gateReading("failed"), left };
    ledger = settleRepaint(ledger, request.key, candidate);
    await saveLedger(store, jobId, ledger);
    return Response.json(candidate, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
