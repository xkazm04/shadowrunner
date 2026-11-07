// The casting client (forge-creator L2): the creator's door to POST /api/forge/drafts and
// GET /api/forge/drafts/:batchId through `apiFetch` (so `?plane=replay` adds `x-sr-plane: replay`),
// and its in-browser replay twin over the recorded jobs (the same three candidates the server's
// replay shows: `castTrio` and `replayCastView` from "@sr/forge/cast"). A view is checked before use
// (`readCastView`): a candidate's rig must pass `validateRig` with a URL for every layer file, or
// the whole view is `upstream`, never a half-shown candidate.
import { castTrio, MAX_REROLLS, parseReplayBatchId, replayBatchId, replayCastView } from "@sr/forge/cast";
import { requestKey } from "@sr/forge/brief";
import type { CastCandidateView, CastStatus, CastView, CharacterBrief } from "@sr/forge/wire";
import { validateRig } from "@sr/rig";
import { apiFetch, type Fetcher, type Plane } from "../app/plane";
import { errorFromBody, ForgeError, isForgeErrorCode } from "./forgeClient";
import { loadReplayJobs, type ReplayJob } from "./replayJobs";

export interface CastClient {
  /** POST /api/forge/drafts; `after` re-rolls that batch. */
  draft(brief: CharacterBrief, after?: string): Promise<{ batchId: string }>;
  /** GET /api/forge/drafts/:batchId */
  poll(batchId: string): Promise<CastView>;
}

export const CAST_URL = "/api/forge/drafts";
const STATUSES: readonly string[] = ["drafting", "segmenting", "cutting", "ready", "failed"] satisfies CastStatus[];
const STATES: readonly string[] = ["drafting", "cut", "uncut", "failed"] satisfies CastCandidateView["state"][];

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function candidateOf(v: unknown): CastCandidateView | undefined {
  if (!isRecord(v) || typeof v.index !== "number" || !Number.isInteger(v.index) || typeof v.state !== "string" || !STATES.includes(v.state)) return undefined;
  if (!strings(v.missing) || !strings(v.empty) || !strings(v.warnings)) return undefined;
  const out: CastCandidateView = { index: v.index, state: v.state as CastCandidateView["state"], missing: [...v.missing], empty: [...v.empty], warnings: [...v.warnings] };
  if (v.portraitUrl !== undefined) {
    if (typeof v.portraitUrl !== "string") return undefined;
    out.portraitUrl = v.portraitUrl;
  }
  if (v.note !== undefined) {
    if (typeof v.note !== "string") return undefined;
    out.note = v.note;
  }
  if (v.rig !== undefined || v.assets !== undefined) {
    const rig = validateRig(v.rig);
    if (!rig.ok || !isRecord(v.assets)) return undefined;
    const assets: Record<string, string> = {};
    for (const [file, url] of Object.entries(v.assets)) {
      if (typeof url !== "string") return undefined;
      assets[file] = url;
    }
    if (rig.value.layers.some((l) => assets[l.file] === undefined)) return undefined;
    out.rig = rig.value;
    out.assets = assets;
  }
  return out;
}

/** A checked CastView, or undefined when the value is not one. */
export function readCastView(value: unknown): CastView | undefined {
  if (!isRecord(value) || typeof value.batchId !== "string" || value.batchId === "" || typeof value.status !== "string" || !STATUSES.includes(value.status)) return undefined;
  if ((value.plane !== "replay" && value.plane !== "live") || typeof value.rerollsLeft !== "number" || !Array.isArray(value.candidates)) return undefined;
  const candidates = value.candidates.map(candidateOf);
  if (candidates.some((c) => c === undefined)) return undefined;
  const view: CastView = {
    batchId: value.batchId,
    status: value.status as CastStatus,
    plane: value.plane,
    rerollsLeft: Math.max(0, Math.floor(value.rerollsLeft)),
    candidates: candidates.filter((c): c is CastCandidateView => c !== undefined),
  };
  if (typeof value.jobId === "string" && value.jobId !== "") view.jobId = value.jobId;
  if (value.error !== undefined) {
    const e = value.error;
    if (!isRecord(e) || !isForgeErrorCode(e.code) || typeof e.message !== "string") return undefined;
    view.error = { code: e.code, message: e.message };
  }
  return view;
}

async function send(fetcher: Fetcher, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch {
    throw new ForgeError("upstream", "The casting could not be reached.");
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw errorFromBody(body, res.status);
  return body;
}

/** The live client, through `apiFetch`. */
export function createHttpCastClient(fetcher: Fetcher = apiFetch): CastClient {
  return {
    async draft(brief, after) {
      const body = await send(fetcher, CAST_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(after === undefined ? { brief } : { brief, after }),
      });
      const batchId = isRecord(body) ? body.batchId : undefined;
      if (typeof batchId !== "string" || batchId === "") throw new ForgeError("upstream", "The casting did not return a batch.");
      return { batchId };
    },
    async poll(batchId) {
      const view = readCastView(await send(fetcher, `${CAST_URL}/${encodeURIComponent(batchId)}`, { headers: { accept: "application/json" }, cache: "no-store" }));
      if (view === undefined) throw new ForgeError("upstream", "The casting sent something the creator cannot read.");
      return view;
    },
  };
}

export interface ReplayCastOptions {
  jobs?: () => Promise<readonly ReplayJob[]>;
  now?: () => number;
}

/** The replay twin: three recorded jobs, no request to /api. */
export function createReplayCastClient(options: ReplayCastOptions = {}): CastClient {
  const jobs = options.jobs ?? loadReplayJobs;
  const now = options.now ?? (() => Date.now());
  return {
    async draft(brief, after) {
      const previous = after === undefined ? undefined : parseReplayBatchId(after);
      if (after !== undefined && previous === undefined) throw new ForgeError("bad_input", "No such casting batch.");
      const round = previous === undefined ? 0 : previous.round + 1;
      if (round > MAX_REROLLS) throw new ForgeError("quota", "No re-rolls left for this brief. Cast one of these, or go back to the brief.");
      const list = await jobs();
      const key = brief.one_line_request;
      const primary = list.find((j) => j.prompt !== undefined && requestKey(j.prompt) === requestKey(key))?.slug;
      const slugs = castTrio(key, list.map((j) => j.slug), primary, round);
      if (slugs.length === 0) throw new ForgeError("upstream", "No recorded forges are available.");
      return { batchId: replayBatchId({ round, startedAt: now(), slugs, primary: round === 0 && primary !== undefined }) };
    },
    async poll(batchId) {
      const batch = parseReplayBatchId(batchId);
      const list = await jobs();
      const view = batch === undefined ? undefined : replayCastView(batchId, batch, new Map(list.map((j) => [j.slug, j])), Math.max(0, now() - batch.startedAt));
      if (view === undefined) throw new ForgeError("bad_input", "No such casting batch.");
      return view;
    },
  };
}

/** The client for this plane; a replay batch id is always polled by the replay twin. */
export function castClientFor(plane: Plane, options: ReplayCastOptions = {}): CastClient {
  const replay = createReplayCastClient(options);
  if (plane === "replay") return replay;
  const http = createHttpCastClient();
  return {
    draft: (brief, after) => (after !== undefined && parseReplayBatchId(after) !== undefined ? replay.draft(brief, after) : http.draft(brief, after)),
    poll: (batchId) => (parseReplayBatchId(batchId) !== undefined ? replay.poll(batchId) : http.poll(batchId)),
  };
}
