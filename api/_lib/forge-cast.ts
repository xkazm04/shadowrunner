// forge-creator L2, casting from three drafts (live plane). After the brief is approved the creator
// asks for a casting batch: three draft portraits from the cheap draft image model, each cut into
// a provisional rig over the pure fallback plate (no fill edit), with what could not be found said
// plainly. Only the candidate the streamer casts goes on to the paid steps (fill, eyes, six faces),
// continuing from exactly that portrait and decomposition (`castJobFrom`, used by POST /api/forge).
//
// Stepwise like the forge, because three drafts and three parts calls cannot be trusted to fit one
// serverless call (decision 0003 measured 15 s per portrait and 14-20 s per parts call):
//   POST /api/forge/drafts       three draft portraits in parallel              -> segmenting
//   GET  segmenting              three parts calls in parallel (no re-ask)      -> cutting
//   GET  cutting                 one candidate's provisional rig per GET        -> ready
// The GET lease is the forge's (60 s); a GET inside it returns the batch as it stands.
//
// Charges: a fresh batch counts ONE forge use for this IP and charges 3 x imageDraft; each parts
// call charges `segment` in USD only. A re-roll (`after`) charges 3 x imageDraft in USD only and is
// capped per chain (MAX_REROLLS); a second re-roll of the same batch returns the batch that
// already replaced it. Casting a candidate counts nothing more: the job it starts charges its own
// fill, eyes and faces in USD as every forge does.
import {
  CAST_SIZE,
  MAX_REROLLS,
  castCutId,
  draftPrompt,
  missingParts,
  parseBriefPartsJson,
  parseCastRequest,
  partsPromptFromBrief,
  toCastView,
  type CastBatch,
  type CastCut,
  type CastPick,
  type CastRecord,
  type CastSlot,
  type ForgeJob,
} from "@sr/forge";
import { COST_USD } from "./costs.js";
import { ApiError, errorBody, errorResponse } from "./errors.js";
import type { GeminiClient } from "./gemini.js";
import { isJobId, newJobId, type JobStore } from "./jobstore.js";
import { planeFromRequest, type Env } from "./plane.js";
import { clientIp, type Quota } from "./quota.js";
import { assembleNamed, decodePortrait, extensionOf, uploadMime } from "./forge-steps.js";

/** As the forge's STEP_LEASE_MS: a step that started less than this long ago is still running. */
export const CAST_LEASE_MS = 60_000;

/** The recorded casting (replay plane): no key, no quota, no fetch. */
export interface CastReplay {
  post(body: string, now: number): Promise<Response>;
  get(batchId: string, now: number): Promise<Response>;
}

export interface CastDeps {
  env: Env;
  gemini(): GeminiClient;
  quota: Quota;
  /** The live casting store (batches and cut records). */
  store(): JobStore<CastRecord>;
  replay: CastReplay;
  now(): number;
}

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 16 * 1024;
const badInput = (message: string) => new ApiError("bad_input", message);
const QUOTA = () => new ApiError("quota", "The cellar's budget for today is spent. Try the recorded gallery.");
const NO_BATCH = () => badInput("No such casting batch.");

const emptySlot = (state: CastSlot["state"], note?: string): CastSlot => ({ state, missing: [], empty: [], warnings: [], ...(note === undefined ? {} : { note }) });

async function getBatch(store: JobStore<CastRecord>, id: string): Promise<CastBatch | undefined> {
  const record = isJobId(id) ? await store.get(id) : undefined;
  return record?.kind === "batch" ? record : undefined;
}

async function getCut(store: JobStore<CastRecord>, batchId: string, index: number): Promise<CastCut | undefined> {
  const record = await store.get(castCutId(batchId, index));
  return record?.kind === "cut" ? record : undefined;
}

async function viewResponse(store: JobStore<CastRecord>, batch: CastBatch, status = 200): Promise<Response> {
  const cuts = await Promise.all(batch.slots.map((_, i) => getCut(store, batch.jobId, i)));
  return Response.json(toCastView(batch, cuts), { status, headers: NO_STORE });
}

/** POST /api/forge/drafts: validate, charge, create the batch and draw its drafts; 202 { batchId }. */
export async function handleCastPost(req: Request, deps: CastDeps): Promise<Response> {
  try {
    const now = deps.now();
    const text = await req.text();
    if (planeFromRequest(req, deps.env) === "replay") return await deps.replay.post(text, now);
    if (text.length > MAX_BODY) throw badInput("The request is too large.");
    const parsed = parseCastRequest(text);
    if (!parsed.ok) throw badInput(parsed.errors.message);
    const store = deps.store();
    const ip = clientIp(req);
    const previous = parsed.value.after === undefined ? undefined : await getBatch(store, parsed.value.after);
    if (parsed.value.after !== undefined) {
      if (previous === undefined) throw NO_BATCH();
      if (previous.forgeJobId !== undefined) throw badInput("This casting is already cast.");
      if (previous.next !== undefined) return Response.json({ batchId: previous.next }, { status: 202, headers: NO_STORE });
      if (previous.round >= MAX_REROLLS) throw new ApiError("quota", "No re-rolls left for this brief. Cast one of these, or go back to the brief.");
    }
    const usd = COST_USD.imageDraft * CAST_SIZE;
    const charged = await deps.quota.checkAndCharge(ip, "forge", usd, previous === undefined ? {} : { count: false });
    if (!charged.ok) throw QUOTA();

    const batch: CastBatch = {
      jobId: newJobId(),
      kind: "batch",
      plane: "live",
      status: "drafting",
      createdAt: now,
      brief: previous?.brief ?? parsed.value.brief,
      round: previous === undefined ? 0 : previous.round + 1,
      slots: [],
      ...(previous === undefined ? {} : { after: previous.jobId }),
    };
    await store.put(batch);
    if (previous !== undefined) await store.put({ ...previous, next: batch.jobId });
    await draftStep(batch, deps.gemini(), store);
    await store.put(batch);
    return Response.json({ batchId: batch.jobId }, { status: 202, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The batch id of `/api/forge/drafts/<id>` (or `?batchId=` when a rewrite passes it as a query). */
export function batchIdOf(req: Request): string {
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get("batchId") ?? decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
}

/** GET /api/forge/drafts/:batchId: advance at most one step and return the CastView. */
export async function handleCastGet(req: Request, deps: CastDeps): Promise<Response> {
  try {
    const now = deps.now();
    const id = batchIdOf(req);
    if (planeFromRequest(req, deps.env) === "replay") return await deps.replay.get(id, now);
    const store = deps.store();
    const batch = await getBatch(store, id);
    if (batch === undefined) return Response.json(errorBody("bad_input", "No such casting batch."), { status: 404, headers: NO_STORE });
    if (batch.status === "ready" || batch.status === "failed") return await viewResponse(store, batch);
    if (batch.stepStartedAt !== undefined && now - batch.stepStartedAt < CAST_LEASE_MS) return await viewResponse(store, batch);
    batch.stepStartedAt = now;
    await store.put(batch);
    const ip = clientIp(req);
    const charge = async (usd: number) => (await deps.quota.checkAndCharge(ip, "forge", usd, { count: false })).ok;
    try {
      if (batch.status === "segmenting") await partsStep(batch, deps.gemini(), store, charge);
      else if (batch.status === "cutting") await cutStep(batch, store);
    } catch (err) {
      batch.status = "failed";
      batch.error = { code: "upstream", message: "The casting failed. Try again." };
      console.warn(`forge cast: batch failed (${err instanceof Error ? err.name : typeof err})`);
    }
    delete batch.stepStartedAt;
    await store.put(batch);
    return await viewResponse(store, batch);
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST: the drafts, in parallel; a draft that fails leaves its slot "failed"; all three failing fails the batch. */
async function draftStep(batch: CastBatch, gemini: GeminiClient, store: JobStore<CastRecord>): Promise<void> {
  const drawn = await Promise.allSettled(
    Array.from({ length: CAST_SIZE }, async (_, i): Promise<CastSlot> => {
      const image = await gemini.generateImage(draftPrompt(batch.brief, i), { draft: true });
      const mime = uploadMime(image.data);
      if (mime === undefined || mime === "image/webp") throw badInput("unreadable");
      decodePortrait(image.data);
      const portraitUrl = await store.putImage(batch.jobId, `draft${i}.${extensionOf(mime)}`, { bytes: image.data, contentType: mime });
      return { ...emptySlot("drafting"), portraitUrl, portraitMime: mime };
    }),
  );
  batch.slots = drawn.map((r) => (r.status === "fulfilled" ? r.value : emptySlot("failed", "The draft painter did not finish this one.")));
  if (batch.slots.every((s) => s.state === "failed")) {
    batch.status = "failed";
    batch.error = { code: "upstream", message: "The draft painter did not answer. Try again." };
    return;
  }
  batch.status = "segmenting";
}

/** GET segmenting: one parts call per drawn draft, in parallel, each charged; no re-ask (at most three calls). */
async function partsStep(batch: CastBatch, gemini: GeminiClient, store: JobStore<CastRecord>, charge: (usd: number) => Promise<boolean>): Promise<void> {
  const planned = batch.brief.parts.map((p) => p.name);
  await Promise.all(
    batch.slots.map(async (slot, i) => {
      if (slot.state !== "drafting" || slot.portraitUrl === undefined || slot.portraitMime === undefined) return;
      if (!(await charge(COST_USD.segment))) {
        batch.slots[i] = { ...slot, state: "uncut", note: "Today's budget ran out before its parts were read; casting it reads them." };
        return;
      }
      try {
        const image = { mimeType: slot.portraitMime, data: await store.readImage(slot.portraitUrl) };
        const parsed = parseBriefPartsJson(await gemini.generateJson(partsPromptFromBrief(batch.brief), image), batch.brief);
        if (!parsed.ok || parsed.value.named === undefined) throw badInput("parts");
        const { named, cut } = parsed.value;
        await store.put({ jobId: castCutId(batch.jobId, i), kind: "cut", named: { version: 2, parts: named, ...(cut === undefined ? {} : { cut }) } });
        batch.slots[i] = { ...slot, missing: missingParts(planned, named.map((p) => p.name)) };
      } catch {
        batch.slots[i] = { ...slot, state: "uncut", missing: [...planned], note: "Its planned parts could not be read; casting it asks for them again." };
      }
    }),
  );
  batch.status = "cutting";
}

/** GET cutting: the next drawn candidate's provisional rig (fallback plate, no regions); none left -> ready. */
async function cutStep(batch: CastBatch, store: JobStore<CastRecord>): Promise<void> {
  const i = batch.slots.findIndex((s) => s.state === "drafting");
  const slot = batch.slots[i];
  if (slot === undefined) {
    batch.status = "ready";
    return;
  }
  const cut = await getCut(store, batch.jobId, i);
  try {
    if (cut === undefined || slot.portraitUrl === undefined) throw badInput("lost");
    const portrait = decodePortrait(await store.readImage(slot.portraitUrl));
    const { assembled, empty } = assembleNamed(portrait, cut.named, { id: `cast-${batch.jobId.slice(0, 8)}-${i}`, name: batch.brief.name });
    if (!assembled.ok) throw badInput("assemble");
    const assets: Record<string, string> = {};
    const folder = castCutId(batch.jobId, i);
    for (const [file, bytes] of Object.entries(assembled.value.files)) assets[file] = await store.putImage(folder, file, { bytes, contentType: "image/png" });
    await store.put({ ...cut, rig: assembled.value.rig, assets });
    batch.slots[i] = { ...slot, state: "cut", empty: [...empty], warnings: assembled.value.warnings.map((w) => w.message) };
  } catch {
    batch.slots[i] = { ...slot, state: "uncut", note: "No working face could be cut from this draft; casting it asks for its parts again." };
  }
  if (!batch.slots.some((s) => s.state === "drafting")) batch.status = "ready";
}

/** The forge job's id for a batch: one per batch, so a second cast finds the first. */
export const castJobId = (batchId: string): string => `${batchId}-job`;

/**
 * POST /api/forge with `candidate` (live): the job continued from the cast candidate: its draft
 * portrait (copied into the job's own folder, byte for byte) and, when it was cut, its named parts,
 * so the job starts at "cutting" (the fill edit) with no portrait call and no parts call. An uncut
 * candidate starts at "segmenting" (its parts are asked again). The brief is the batch's own (the
 * one its parts were planned from). Casting a batch twice returns the same job.
 */
export async function castJobFrom(pick: CastPick, casts: JobStore<CastRecord>, jobs: JobStore<ForgeJob>, now: number): Promise<string> {
  const batch = await getBatch(casts, pick.batchId);
  if (batch === undefined) throw NO_BATCH();
  const jobId = batch.forgeJobId ?? castJobId(batch.jobId);
  if (batch.forgeJobId !== undefined || (await jobs.get(jobId)) !== undefined) return jobId;
  if (batch.status !== "ready") throw badInput("The casting is not finished yet.");
  const slot = batch.slots[pick.index];
  if (slot === undefined || slot.portraitUrl === undefined || slot.portraitMime === undefined || slot.state === "failed") throw badInput("That candidate has no portrait.");
  const cut = slot.state === "cut" ? await getCut(casts, batch.jobId, pick.index) : undefined;
  const bytes = await casts.readImage(slot.portraitUrl);
  const portraitUrl = await jobs.putImage(jobId, `portrait.${extensionOf(slot.portraitMime)}`, { bytes, contentType: slot.portraitMime });
  const job: ForgeJob = {
    jobId,
    plane: "live",
    mode: "brief",
    status: cut === undefined ? "segmenting" : "cutting",
    createdAt: now,
    brief: batch.brief,
    portraitUrl,
    portraitMime: slot.portraitMime,
    ...(cut === undefined ? {} : { named: cut.named, decomposition: "named" as const, partsAsks: 1 }),
  };
  await jobs.put(job);
  await casts.put({ ...batch, forgeJobId: jobId });
  return jobId;
}
