// The only place @sr/forge decodes external text (steering tech.md): the POST /api/forge body, the
// segmentation model's parts and likeness replies, and job records read back from the job store.
// Each function takes raw text, runs the one JSON.parse, and checks the shape. No text is repaired:
// a reply that is not JSON is an error (task 7: the parts step re-asks once, then fails `upstream`).
// Messages name the rule broken, never the offending value, so upstream text cannot leak.
import { EXPRESSION_FAMILIES, type ExpressionFamily, type Result, validateRig } from "@sr/rig";
import { FORGE_STEPS, type ExpressionOutcome, type ForgeJob, type ForgeStep, type PortraitMime } from "./job.js";
import { parseBrief, type BriefError } from "./brief.js";
import { MAX_EXTRA_EDITS, MAX_FACE_ATTEMPT } from "./faceMaterial.js";
import { readFaceGate } from "./faceGate.js";
import { settleBriefParts } from "./briefParts.js";
import { parseParts, type ParsedParts, type PartsError } from "./parts.js";
import type { BriefRequest, CharacterBrief, ForgeErrorCode, ForgeRequest, ForgeStatus } from "./wire.js";

/** Upper bound of the user's text in a request (the prompt uses at most MAX_CHARACTER_TEXT of it). */
export const MAX_REQUEST_PROMPT = 2000;
/**
 * Requirement 2.4 as amended (2026-11-01): uploads up to 3 MB after the client's downscale, so the
 * base64 body stays under Vercel's 4.5 MB request cap; base64 needs 4 characters per 3 bytes.
 */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
/** The bad_input message for an upload that is too large or not an image. */
export const UPLOAD_LIMIT_MESSAGE = "The image must be a PNG, JPEG or WebP of at most 3 MB.";
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
      return badInput(UPLOAD_LIMIT_MESSAGE);
    }
    return { ok: true, value: { mode: "image", imageBase64: data } };
  }
  if (body.mode === "brief") {
    const brief = parseBrief(body.brief);
    if (!brief.ok) return badInput(`The brief is not valid: ${briefProblem(brief.errors)}.`);
    return { ok: true, value: { mode: "brief", brief: brief.value } };
  }
  return badInput("Unknown forge mode.");
}

/** The first broken rule of a brief, for a bad_input message (a path and a rule, never a value). */
export const briefProblem = (errors: readonly BriefError[]): string => (errors[0] === undefined ? "unknown" : `${errors[0].path} ${errors[0].message}`);

/** The POST /api/forge/brief body: a non-blank `request` of at most MAX_REQUEST_PROMPT characters. */
export function parseBriefRequest(text: string): Result<BriefRequest, RequestError> {
  const decoded = decode(text);
  if (!decoded.ok || !isRecord(decoded.value)) return badInput("The request is not a JSON object.");
  const request = decoded.value.request;
  if (typeof request !== "string" || request.trim() === "") return badInput("Describe the character.");
  if (request.length > MAX_REQUEST_PROMPT) return badInput(`Keep the description under ${MAX_REQUEST_PROMPT} characters.`);
  return { ok: true, value: { request: request.trim() } };
}

export interface BriefJsonError {
  /** True when the answer is not JSON at all. */
  syntax: boolean;
  errors: BriefError[];
}

/** The brief model's answer: one strict JSON.parse, then `parseBrief`. */
export function parseBriefJson(text: string): Result<CharacterBrief, BriefJsonError> {
  const decoded = decode(text);
  if (!decoded.ok) return { ok: false, errors: { syntax: true, errors: [{ path: "$", message: "is not valid JSON" }] } };
  const parsed = parseBrief(decoded.value);
  return parsed.ok ? parsed : { ok: false, errors: { syntax: false, errors: parsed.errors } };
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

/**
 * The parts model's answer to `partsPromptFromBrief`: one strict JSON.parse, `settleBriefParts`
 * against the brief, then `parseParts`, which must find a v2 file. `notes` say what was settled.
 */
export function parseBriefPartsJson(text: string, brief: CharacterBrief): Result<ParsedParts & { notes: string[] }, PartsJsonError> {
  const decoded = decode(text);
  if (!decoded.ok) return { ok: false, errors: { syntax: true, errors: [{ code: "upstream", path: "$", message: "is not valid JSON" }] } };
  const settled = settleBriefParts(decoded.value, brief);
  const parsed = parseParts(settled.value);
  if (!parsed.ok) return { ok: false, errors: { syntax: false, errors: parsed.errors } };
  if (parsed.value.named === undefined) return { ok: false, errors: { syntax: false, errors: [{ code: "upstream", path: "$", message: "must be a named-parts file" }] } };
  return { ok: true, value: { ...parsed.value, notes: settled.notes } };
}

const STATUSES: readonly string[] = ["queued", "portrait", "segmenting", "cutting", "filling", "expressing", "done", "failed"] satisfies ForgeStatus[];
const OUTCOMES: readonly string[] = ["ok", "skipped", "failed"] satisfies ExpressionOutcome[];
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

function expressionsOf(v: unknown): ForgeJob["expressions"] | undefined {
  if (!isRecord(v)) return undefined;
  const out: NonNullable<ForgeJob["expressions"]> = {};
  for (const [k, value] of Object.entries(v)) {
    if (!(EXPRESSION_FAMILIES as readonly string[]).includes(k) || typeof value !== "string" || !OUTCOMES.includes(value)) return undefined;
    out[k as ExpressionFamily] = value as ExpressionOutcome;
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
  if (!isString(j.jobId) || (j.plane !== "replay" && j.plane !== "live") || (j.mode !== "prompt" && j.mode !== "image" && j.mode !== "brief")) return undefined;
  if (!isStatus(j.status) || !isCount(j.createdAt)) return undefined;
  if (!optional(j.stepStartedAt, isCount) || !optional(j.prompt, isString) || !optional(j.uploadUrl, isString)) return undefined;
  if (!optional(j.uploadMime, isMime) || !optional(j.portraitUrl, isString) || !optional(j.portraitMime, isMime)) return undefined;
  if (!optional(j.partsAsks, isCount) || !optional(j.plateUrl, isString)) return undefined;
  if (!optional(j.fill, (v) => v === "edit" || v === "fallback")) return undefined;
  if (!optional(j.decomposition, (v) => v === "named" || v === "fallback")) return undefined;
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
  if (j.decomposition === "named" || j.decomposition === "fallback") job.decomposition = j.decomposition;
  if (j.brief !== undefined) {
    const brief = parseBrief(j.brief);
    if (!brief.ok) return undefined;
    job.brief = brief.value;
  }
  if (j.mode === "brief" && job.brief === undefined) return undefined;
  if (j.parts !== undefined) {
    const parts = parseParts(j.parts);
    if (!parts.ok) return undefined;
    job.parts = parts.value.parts;
  }
  if (j.named !== undefined) {
    const named = parseParts(j.named);
    if (!named.ok || named.value.named === undefined) return undefined;
    job.named = { version: 2, parts: named.value.named, ...(named.value.cut === undefined ? {} : { cut: named.value.cut }) };
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
  if (j.expressionIndex !== undefined) {
    if (!isCount(j.expressionIndex) || j.expressionIndex > EXPRESSION_FAMILIES.length) return undefined;
    job.expressionIndex = j.expressionIndex;
  }
  if (j.expressionAttempt !== undefined) {
    if (!isCount(j.expressionAttempt) || j.expressionAttempt < 1 || j.expressionAttempt > MAX_FACE_ATTEMPT) return undefined;
    job.expressionAttempt = j.expressionAttempt;
  }
  if (j.extraEdits !== undefined) {
    if (!isCount(j.extraEdits) || j.extraEdits < 1 || j.extraEdits > MAX_EXTRA_EDITS) return undefined;
    job.extraEdits = j.extraEdits;
  }
  if (j.eyes !== undefined) {
    if (j.eyes !== "edit" && j.eyes !== "fallback" && j.eyes !== "none") return undefined;
    job.eyes = j.eyes;
  }
  if (j.expressions !== undefined) {
    const expressions = expressionsOf(j.expressions);
    if (!expressions) return undefined;
    job.expressions = expressions;
  }
  // forge-creator S1: a note, not the character: malformed readings are dropped, never the job.
  const gate = readFaceGate(j.expressionGate);
  if (gate !== undefined) job.expressionGate = gate;
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
