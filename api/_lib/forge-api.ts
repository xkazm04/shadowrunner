// The forge door (forge-pipeline requirement 7, task 7): request validation, plane, quota and the
// job lease, shared by POST /api/forge and GET /api/forge/:jobId. Everything that can spend money
// or reach the network is in `ForgeDeps`, so tests inject fakes. `x-sr-plane: replay` (or a replay
// deploy) sends both routes to the recorded forges, which make no paid call and no fetch.
import { parseForgeJob, parseForgeRequest, toJobView, MAX_UPLOAD_BASE64, MAX_UPLOAD_BYTES, UPLOAD_LIMIT_MESSAGE, type ForgeJob } from "@sr/forge";
import { COST_USD } from "./costs.js";
import { ApiError, errorBody, errorResponse } from "./errors.js";
import { geminiFromEnv, type GeminiClient } from "./gemini.js";
import { MemoryJobStore, isJobId, jobStoreFor, newJobId, type JobStore } from "./jobstore.js";
import { planeFromRequest, type Env } from "./plane.js";
import { checkAndCharge, clientIp, type Quota } from "./quota.js";
import { bundledReplay } from "./forge-replay.js";
import { runStep, startJob, uploadMime, type StepContext } from "./forge-steps.js";

/** A step that started less than this long ago is still running in another invocation. */
export const STEP_LEASE_MS = 60_000;

/** The recorded forges (task 8): no key, no quota, no fetch. */
export interface ForgeReplay {
  post(body: string, now: number): Promise<Response>;
  get(jobId: string, now: number): Promise<Response>;
}

export interface ForgeDeps {
  env: Env;
  gemini(): GeminiClient;
  quota: Quota;
  /** The live store; may throw `ApiError("upstream")` when a deploy has no KV or Blob. */
  store(): JobStore<ForgeJob>;
  replay: ForgeReplay;
  now(): number;
}

const NO_STORE = { "cache-control": "no-store" };
const badInput = (message: string) => new ApiError("bad_input", message);

export function jobResponse(job: ForgeJob): Response {
  return Response.json(toJobView(job), { headers: NO_STORE });
}

function decodeUpload(base64: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) throw badInput(UPLOAD_LIMIT_MESSAGE);
  return bytes;
}

/** POST /api/forge: validate, check quota, create the job and run its first step; 202 { jobId }. */
export async function handleForgePost(req: Request, deps: ForgeDeps): Promise<Response> {
  try {
    const now = deps.now();
    const text = await req.text();
    if (planeFromRequest(req, deps.env) === "replay") return await deps.replay.post(text, now);
    if (text.length > MAX_UPLOAD_BASE64 + 4096) throw badInput(UPLOAD_LIMIT_MESSAGE);
    const parsed = parseForgeRequest(text);
    if (!parsed.ok) throw badInput(parsed.errors.message);
    const request = parsed.value;
    let upload: { bytes: Uint8Array; mime: NonNullable<ReturnType<typeof uploadMime>> } | undefined;
    if (request.mode === "image") {
      const bytes = decodeUpload(request.imageBase64 ?? "");
      const mime = uploadMime(bytes);
      if (mime === undefined) throw badInput(UPLOAD_LIMIT_MESSAGE);
      upload = { bytes, mime };
    }
    const store = deps.store();
    const firstCall = request.mode === "image" ? COST_USD.classify : COST_USD.imageFinal;
    const ip = clientIp(req);
    const charged = await deps.quota.checkAndCharge(ip, "forge", firstCall);
    if (!charged.ok) throw new ApiError("quota", "The cellar's budget for today is spent. Try the recorded gallery.");

    const job: ForgeJob = { jobId: newJobId(), plane: "live", mode: request.mode, status: "queued", createdAt: now };
    if (request.prompt !== undefined) job.prompt = request.prompt;
    if (request.brief !== undefined) job.brief = request.brief;
    await store.put(job);
    const started = await startJob(job, upload, context(deps, store, ip));
    await store.put(started);
    return Response.json({ jobId: started.jobId }, { status: 202, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The job id of `/api/forge/<id>` (or `?jobId=` when a rewrite passes it as a query). */
export function jobIdOf(req: Request): string {
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get("jobId") ?? decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
}

/** GET /api/forge/:jobId: advance at most one step and return the JobView. */
export async function handleForgeGet(req: Request, deps: ForgeDeps): Promise<Response> {
  try {
    const now = deps.now();
    const jobId = jobIdOf(req);
    if (planeFromRequest(req, deps.env) === "replay") return await deps.replay.get(jobId, now);
    if (!isJobId(jobId)) throw badInput("No such forge job.");
    const store = deps.store();
    const job = await store.get(jobId);
    if (job === undefined) return Response.json(errorBody("bad_input", "No such forge job."), { status: 404, headers: NO_STORE });
    if (job.status === "done" || job.status === "failed") return jobResponse(job);
    if (job.stepStartedAt !== undefined && now - job.stepStartedAt < STEP_LEASE_MS) return jobResponse(job);

    job.stepStartedAt = now;
    await store.put(job);
    const next = await runStep(job, context(deps, store, clientIp(req)));
    delete next.stepStartedAt;
    await store.put(next);
    return jobResponse(next);
  } catch (err) {
    return errorResponse(err);
  }
}

function context(deps: ForgeDeps, store: JobStore<ForgeJob>, ip: string): StepContext {
  let gemini: GeminiClient | undefined;
  return {
    get gemini() {
      gemini ??= deps.gemini();
      return gemini;
    },
    store,
    charge: async (usd) => (await deps.quota.checkAndCharge(ip, "forge", usd, { count: false })).ok,
    now: deps.now,
  };
}

/** Process-wide memory store for `pnpm dev` without KV/Blob (it must outlive one request). */
const memory = new MemoryJobStore<ForgeJob>();

export function defaultForgeDeps(env: Env = process.env, replay: ForgeReplay = bundledReplay): ForgeDeps {
  return {
    env,
    gemini: () => geminiFromEnv(env),
    quota: { checkAndCharge },
    store: () => jobStoreFor("live", env, { parse: parseForgeJob, memory }),
    replay,
    now: Date.now,
  };
}
