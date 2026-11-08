// The forge client (creator design.md "Contracts"): the creator's only door to the forge server.
// The wire types are owned by forge-pipeline in `@sr/forge/wire` and never redeclared here.
// `createHttpForgeClient` talks to POST /api/forge and GET /api/forge/:jobId through `apiFetch`
// (so `?plane=replay` adds `x-sr-plane: replay`); `forgeClient.replay.ts` is the in-browser twin.
//
// Decisions the spec leaves open:
// - Every failure the client sees becomes a `ForgeError` with a wire `ForgeErrorCode`: an
//   `{ error: { code, message } }` body keeps its code; an unreadable body falls back on the HTTP
//   status (429 quota, 400/404/413/415 bad_input, anything else upstream); a network fault is
//   `upstream`. The creator therefore has one failure path.
// - A job view is checked before use (`readJobView`): unknown status, wrong plane, a `rig` that
//   fails `validateRig` or non-string asset URLs make the response `upstream`, never a crash.
import { readFaceGate } from "@sr/forge/faceGate";
import type { ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";
import { EXPRESSION_FAMILIES, validateRig, type ExpressionFamily } from "@sr/rig";
import { apiFetch, type Fetcher } from "../app/plane";

export type { ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";

export interface ForgeClient {
  /** POST /api/forge */
  start(req: ForgeRequest): Promise<{ jobId: string }>;
  /** GET /api/forge/:jobId */
  poll(jobId: string): Promise<JobView>;
}

export const FORGE_URL = "/api/forge";

/** Every status, in step order (wire.ts). */
export const FORGE_STATUSES: readonly ForgeStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling", "expressing", "done", "failed"];

export const FORGE_ERROR_CODES: readonly ForgeErrorCode[] = ["quota", "refused_likeness", "refused_content", "upstream", "bad_input"];

/** A forge failure as the creator handles it: a wire code and a message for people. */
export class ForgeError extends Error {
  readonly code: ForgeErrorCode;
  constructor(code: ForgeErrorCode, message: string) {
    super(message);
    this.name = "ForgeError";
    this.code = code;
  }
}

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);

export const isForgeErrorCode = (v: unknown): v is ForgeErrorCode =>
  typeof v === "string" && (FORGE_ERROR_CODES as readonly string[]).includes(v);

const isStatus = (v: unknown): v is ForgeStatus => typeof v === "string" && (FORGE_STATUSES as readonly string[]).includes(v);

/** The code an HTTP status means when the body names none. */
export function codeForStatus(status: number): ForgeErrorCode {
  if (status === 429) return "quota";
  if (status === 400 || status === 404 || status === 413 || status === 415) return "bad_input";
  return "upstream";
}

/** `{ error: { code, message } }` -> ForgeError; anything else falls back on the HTTP status. */
export function errorFromBody(body: unknown, status: number): ForgeError {
  const error = isRecord(body) ? body.error : undefined;
  if (isRecord(error) && isForgeErrorCode(error.code)) {
    return new ForgeError(error.code, typeof error.message === "string" && error.message !== "" ? error.message : "The forge refused.");
  }
  return new ForgeError(codeForStatus(status), `The forge answered ${status}.`);
}

/** A checked JobView, or undefined when the value is not one. Optional fields are copied only when present. */
export function readJobView(value: unknown): JobView | undefined {
  if (!isRecord(value) || typeof value.jobId !== "string" || value.jobId === "" || !isStatus(value.status)) return undefined;
  if (value.plane !== "replay" && value.plane !== "live") return undefined;
  const view: JobView = { jobId: value.jobId, status: value.status, plane: value.plane };
  if (value.portraitUrl !== undefined) {
    if (typeof value.portraitUrl !== "string") return undefined;
    view.portraitUrl = value.portraitUrl;
  }
  if (value.rig !== undefined) {
    const rig = validateRig(value.rig);
    if (!rig.ok) return undefined;
    view.rig = rig.value;
  }
  if (value.assets !== undefined) {
    if (!isRecord(value.assets)) return undefined;
    const assets: Record<string, string> = {};
    for (const [file, url] of Object.entries(value.assets)) {
      if (typeof url !== "string") return undefined;
      assets[file] = url;
    }
    view.assets = assets;
  }
  if (value.fill !== undefined) {
    if (value.fill !== "edit" && value.fill !== "fallback") return undefined;
    view.fill = value.fill;
  }
  // cast-forge task 11: how a brief job was cut ("fallback": the standard ten parts).
  if (value.decomposition !== undefined) {
    if (value.decomposition !== "named" && value.decomposition !== "fallback") return undefined;
    view.decomposition = value.decomposition;
  }
  // character-control: what each expression family came to; an unknown family or outcome is refused.
  if (value.expressions !== undefined) {
    if (!isRecord(value.expressions)) return undefined;
    const expressions: NonNullable<JobView["expressions"]> = {};
    for (const [family, outcome] of Object.entries(value.expressions)) {
      if (!(EXPRESSION_FAMILIES as readonly string[]).includes(family) || (outcome !== "ok" && outcome !== "skipped" && outcome !== "failed")) return undefined;
      expressions[family as ExpressionFamily] = outcome;
    }
    view.expressions = expressions;
  }
  // forge-creator S1: why a family has no painted face; a malformed reading is dropped, not the view.
  const gate = readFaceGate(value.expressionGate);
  if (gate !== undefined) view.expressionGate = gate;
  // forge-creator S2: the repaint window's end (a live job's); malformed, it is dropped, not the view.
  const expiresAt = value.expiresAt;
  if (typeof expiresAt === "number" && Number.isSafeInteger(expiresAt) && expiresAt > 0) view.expiresAt = expiresAt;
  if (value.error !== undefined) {
    const error = value.error;
    if (!isRecord(error) || !isForgeErrorCode(error.code) || typeof error.message !== "string") return undefined;
    view.error = { code: error.code, message: error.message };
  }
  return view;
}

async function bodyOf(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function send(fetcher: Fetcher, url: string, init: RequestInit): Promise<{ res: Response; body: unknown }> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch {
    throw new ForgeError("upstream", "The forge could not be reached.");
  }
  const body = await bodyOf(res);
  if (!res.ok) throw errorFromBody(body, res.status);
  return { res, body };
}

/** The live client: POST /api/forge and GET /api/forge/:jobId through `apiFetch`. */
export function createHttpForgeClient(fetcher: Fetcher = apiFetch): ForgeClient {
  return {
    async start(req) {
      const { body } = await send(fetcher, FORGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(req),
      });
      const jobId = isRecord(body) ? body.jobId : undefined;
      if (typeof jobId !== "string" || jobId === "") throw new ForgeError("upstream", "The forge did not return a job.");
      return { jobId };
    },
    async poll(jobId) {
      const { body } = await send(fetcher, `${FORGE_URL}/${encodeURIComponent(jobId)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const view = readJobView(body);
      if (view === undefined) throw new ForgeError("upstream", "The forge sent a job the creator cannot read.");
      return view;
    },
  };
}
