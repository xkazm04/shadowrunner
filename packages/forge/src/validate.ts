// The only place @sr/forge decodes external text (steering tech.md): the POST /api/forge body, the
// segmentation model's parts and likeness replies, and job records read back from the job store.
// Each function takes raw text, runs the one JSON.parse, and checks the shape. No text is repaired:
// a reply that is not JSON is an error (task 7: the parts step re-asks once, then fails `upstream`).
// Messages name the rule broken, never the offending value, so upstream text cannot leak.
import { type Result, validateRig } from "@sr/rig";
import { FORGE_STEPS, type ForgeJob, type ForgeStep, type PortraitMime } from "./job.js";
import { parseParts, type ParsedParts, type PartsError } from "./parts.js";
import type { ForgeErrorCode, ForgeRequest, ForgeStatus } from "./wire.js";

/** Upper bound of the user's text in a request (the prompt uses at most MAX_CHARACTER_TEXT of it). */
export const MAX_REQUEST_PROMPT = 2000;
/** Requirement 2.4: uploads up to 8 MB; base64 needs 4 characters per 3 bytes. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BASE64 = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

function decode(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export interface RequestError {
  code: Extract<ForgeErrorCode, "bad_input">;
  message: string;
}

const badInput = (message: string): { ok: false; errors: RequestError } => ({ ok: false, errors: { code: "bad_input", message } });

/**
 * The POST /api/forge body (design.md `ForgeRequest`). `mode: "prompt"` needs a non-blank `prompt`
 * of at most MAX_REQUEST_PROMPT characters; `mode: "image"` needs `imageBase64` (standard base64,
 * an optional `data:image/...;base64,` prefix is dropped) of at most MAX_UPLOAD_BYTES. Fields the
 * mode does not use are dropped. Image format is checked by the caller on the decoded bytes.
 */
export function parseForgeRequest(text: string): Result<ForgeRequest, RequestError> {
  const decoded = decode(text);
  if (!decoded.ok || !isRecord(decoded.value)) return badInput("The request is not a JSON object.");
  const body = decoded.value;
  if (body.mode === "prompt") {
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") return badInput("Describe the character.");
    if (body.prompt.length > MAX_REQUEST_PROMPT) return badInput(`Keep the description under ${MAX_REQUEST_PROMPT} characters.`);
    return { ok: true, value: { mode: "prompt", prompt: body.prompt.trim() } };
  }
  if (body.mode === "image") {
    if (typeof body.imageBase64 !== "string") return badInput("Choose an image.");
    const data = body.imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    if (data.length === 0 || data.length > MAX_UPLOAD_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return badInput("The image must be a PNG, JPEG or WebP of at most 8 MB.");
    }
    return { ok: true, value: { mode: "image", imageBase64: data } };
  }
  return badInput("Unknown forge mode.");
}

export interface PartsJsonError {
  /** True when the reply is not JSON at all (the parts step may re-ask once). */
  syntax: boolean;
  errors: PartsError[];
}

/** The segmentation model's parts reply: one strict JSON.parse, then `parseParts`. */
export function parsePartsJson(text: string): Result<ParsedParts, PartsJsonError> {
  const decoded = decode(text);
  if (!decoded.ok) return { ok: false, errors: { syntax: true, errors: [{ code: "upstream", path: "$", message: "is not valid JSON" }] } };
  const parsed = parseParts(decoded.value);
  return parsed.ok ? parsed : { ok: false, errors: { syntax: false, errors: parsed.errors } };
}

export interface Likeness {
  realPerson: boolean;
  unsafe: boolean;
}

/** The LIKENESS_PROMPT reply `{ real_person, unsafe, reason }`; undefined when off-contract. */
export function parseLikenessJson(text: string): Likeness | undefined {
  const decoded = decode(text);
  if (!decoded.ok || !isRecord(decoded.value)) return undefined;
  const { real_person: realPerson, unsafe } = decoded.value;
  return typeof realPerson === "boolean" && typeof unsafe === "boolean" ? { realPerson, unsafe } : undefined;
}

const STATUSES: readonly string[] = ["queued", "portrait", "segmenting", "cutting", "filling", "done", "failed"] satisfies ForgeStatus[];
const ERROR_CODES: readonly string[] = ["quota", "refused_likeness", "refused_content", "upstream", "bad_input"] satisfies ForgeErrorCode[];
const MIMES: readonly string[] = ["image/png", "image/jpeg", "image/webp"] satisfies PortraitMime[];
const STEPS: readonly string[] = FORGE_STEPS;

const isStatus = (v: unknown): v is ForgeStatus => typeof v === "string" && STATUSES.includes(v);
const isCode = (v: unknown): v is ForgeErrorCode => typeof v === "string" && ERROR_CODES.includes(v);
const isMime = (v: unknown): v is PortraitMime => typeof v === "string" && MIMES.includes(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const optional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isStep = (k: string): k is ForgeStep => STEPS.includes(k);

function stringMap(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v)) {
    if (typeof value !== "string") return undefined;
    out[k] = value;
  }
  return out;
}

function timingsOf(v: unknown): ForgeJob["timings"] | undefined {
  if (!isRecord(v)) return undefined;
  const out: NonNullable<ForgeJob["timings"]> = {};
  for (const [k, value] of Object.entries(v)) {
    if (!isStep(k) || !isCount(value)) return undefined;
    out[k] = value;
  }
  return out;
}

/** A job record read back from the job store; undefined when any field is off-contract. */
export function parseForgeJob(text: string): ForgeJob | undefined {
  const decoded = decode(text);
  if (!decoded.ok || !isRecord(decoded.value)) return undefined;
  const j = decoded.value;
  if (!isString(j.jobId) || (j.plane !== "replay" && j.plane !== "live") || (j.mode !== "prompt" && j.mode !== "image")) return undefined;
  if (!isStatus(j.status) || !isCount(j.createdAt)) return undefined;
  if (!optional(j.stepStartedAt, isCount) || !optional(j.prompt, isString) || !optional(j.uploadUrl, isString)) return undefined;
  if (!optional(j.uploadMime, isMime) || !optional(j.portraitUrl, isString) || !optional(j.portraitMime, isMime)) return undefined;
  if (!optional(j.partsAsks, isCount) || !optional(j.plateUrl, isString)) return undefined;
  if (!optional(j.fill, (v) => v === "edit" || v === "fallback")) return undefined;
  const job: ForgeJob = { jobId: j.jobId, plane: j.plane, mode: j.mode, status: j.status, createdAt: j.createdAt };
  if (isCount(j.stepStartedAt)) job.stepStartedAt = j.stepStartedAt;
  if (isString(j.prompt)) job.prompt = j.prompt;
  if (isString(j.uploadUrl)) job.uploadUrl = j.uploadUrl;
  if (isMime(j.uploadMime)) job.uploadMime = j.uploadMime;
  if (isString(j.portraitUrl)) job.portraitUrl = j.portraitUrl;
  if (isMime(j.portraitMime)) job.portraitMime = j.portraitMime;
  if (isCount(j.partsAsks)) job.partsAsks = j.partsAsks;
  if (isString(j.plateUrl)) job.plateUrl = j.plateUrl;
  if (j.fill === "edit" || j.fill === "fallback") job.fill = j.fill;
  if (j.parts !== undefined) {
    const parts = parseParts(j.parts);
    if (!parts.ok) return undefined;
    job.parts = parts.value.parts;
  }
  if (j.rig !== undefined) {
    const rig = validateRig(j.rig);
    if (!rig.ok) return undefined;
    job.rig = rig.value;
  }
  if (j.assets !== undefined) {
    const assets = stringMap(j.assets);
    if (!assets) return undefined;
    job.assets = assets;
  }
  if (j.error !== undefined) {
    if (!isRecord(j.error) || !isCode(j.error.code) || !isString(j.error.message)) return undefined;
    job.error = { code: j.error.code, message: j.error.message };
  }
  if (j.timings !== undefined) {
    const timings = timingsOf(j.timings);
    if (!timings) return undefined;
    job.timings = timings;
  }
  return job;
}
