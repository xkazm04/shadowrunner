// forge-creator L2: the server-side casting records (live plane). Like ForgeJob they live in the job
// store between steps, never with image bytes, each under 50 KB: one `CastBatch` (the brief, the
// three slots' portraits and diagnostics, the chain links) and per candidate one `CastCut` (its
// named parts and provisional rig), so three rigs never share one record. `toCastView` is the only
// way they reach the client; `castRecordOf` checks a record read back (validate.ts parses the text).
import { validateRig, type Rig } from "@sr/rig";
import { parseBrief } from "./brief.js";
import { CAST_SIZE, rerollsLeft } from "./cast.js";
import type { PortraitMime } from "./job.js";
import { parseParts } from "./parts.js";
import type { PartsV2 } from "./types.js";
import type { CastCandidateView, CastStatus, CastView, CharacterBrief, ForgeErrorCode } from "./wire.js";

export type CastSlotState = CastCandidateView["state"];

export interface CastSlot {
  state: CastSlotState;
  portraitUrl?: string;
  portraitMime?: PortraitMime;
  missing: string[];
  empty: string[];
  warnings: string[];
  note?: string;
}

export interface CastBatch {
  /** The batch id (the store's key). */
  jobId: string;
  kind: "batch";
  plane: "live";
  status: CastStatus;
  createdAt: number;
  stepStartedAt?: number;
  brief: CharacterBrief;
  /** 0 for a fresh batch, n for the n-th re-roll of its chain. */
  round: number;
  slots: CastSlot[];
  /** The batch this one re-rolled. */
  after?: string;
  /** The batch that re-rolled this one (a second re-roll of this batch returns it). */
  next?: string;
  /** The forge job cast from this batch (a second cast returns it). */
  forgeJobId?: string;
  error?: { code: ForgeErrorCode; message: string };
}

export interface CastCut {
  /** `<batchId>-c<index>`. */
  jobId: string;
  kind: "cut";
  named: PartsV2;
  rig?: Rig;
  assets?: Record<string, string>;
}

export type CastRecord = CastBatch | CastCut;

/** The store key of candidate `index`'s cut record (also its images' folder). */
export const castCutId = (batchId: string, index: number): string => `${batchId}-c${index}`;

/** The client's view of a batch and its cut records (`cuts[i]` for slot i, when stored). */
export function toCastView(batch: CastBatch, cuts: readonly (CastCut | undefined)[]): CastView {
  const candidates = batch.slots.map((slot, index): CastCandidateView => {
    const cut = cuts[index];
    const rigged = slot.state === "cut" && cut?.rig !== undefined && cut.assets !== undefined;
    return {
      index,
      state: slot.state,
      ...(slot.portraitUrl === undefined ? {} : { portraitUrl: slot.portraitUrl }),
      ...(rigged ? { rig: cut.rig, assets: { ...cut.assets } } : {}),
      missing: [...slot.missing],
      empty: [...slot.empty],
      warnings: [...slot.warnings],
      ...(slot.note === undefined ? {} : { note: slot.note }),
    };
  });
  return {
    batchId: batch.jobId,
    status: batch.status,
    plane: batch.plane,
    rerollsLeft: batch.next === undefined ? rerollsLeft(batch.round) : 0,
    candidates,
    ...(batch.forgeJobId === undefined ? {} : { jobId: batch.forgeJobId }),
    ...(batch.status === "failed" && batch.error !== undefined ? { error: batch.error } : {}),
  };
}

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const STATUSES: readonly string[] = ["drafting", "segmenting", "cutting", "ready", "failed"] satisfies CastStatus[];
const SLOT_STATES: readonly string[] = ["drafting", "cut", "uncut", "failed"] satisfies CastSlotState[];
const MIMES: readonly string[] = ["image/png", "image/jpeg", "image/webp"] satisfies PortraitMime[];
const CODES: readonly string[] = ["quota", "refused_likeness", "refused_content", "upstream", "bad_input"] satisfies ForgeErrorCode[];

function slotOf(v: unknown): CastSlot | undefined {
  if (!isRecord(v) || !isString(v.state) || !SLOT_STATES.includes(v.state)) return undefined;
  if (!strings(v.missing) || !strings(v.empty) || !strings(v.warnings)) return undefined;
  if (v.portraitUrl !== undefined && !isString(v.portraitUrl)) return undefined;
  if (v.portraitMime !== undefined && !(isString(v.portraitMime) && MIMES.includes(v.portraitMime))) return undefined;
  if (v.note !== undefined && !isString(v.note)) return undefined;
  return {
    state: v.state as CastSlotState,
    ...(isString(v.portraitUrl) ? { portraitUrl: v.portraitUrl } : {}),
    ...(isString(v.portraitMime) ? { portraitMime: v.portraitMime as PortraitMime } : {}),
    missing: [...v.missing],
    empty: [...v.empty],
    warnings: [...v.warnings],
    ...(isString(v.note) ? { note: v.note } : {}),
  };
}

function batchOf(v: Fields): CastBatch | undefined {
  if (!isString(v.jobId) || v.plane !== "live" || !isString(v.status) || !STATUSES.includes(v.status)) return undefined;
  if (!isCount(v.createdAt) || !isCount(v.round) || !Array.isArray(v.slots) || v.slots.length > CAST_SIZE) return undefined;
  const brief = parseBrief(v.brief);
  if (!brief.ok) return undefined;
  const slots = v.slots.map(slotOf);
  if (slots.some((s) => s === undefined)) return undefined;
  for (const key of ["after", "next", "forgeJobId"] as const) if (v[key] !== undefined && !isString(v[key])) return undefined;
  if (v.stepStartedAt !== undefined && !isCount(v.stepStartedAt)) return undefined;
  let error: CastBatch["error"];
  if (v.error !== undefined) {
    if (!isRecord(v.error) || !isString(v.error.code) || !CODES.includes(v.error.code) || !isString(v.error.message)) return undefined;
    error = { code: v.error.code as ForgeErrorCode, message: v.error.message };
  }
  return {
    jobId: v.jobId,
    kind: "batch",
    plane: "live",
    status: v.status as CastStatus,
    createdAt: v.createdAt,
    ...(isCount(v.stepStartedAt) ? { stepStartedAt: v.stepStartedAt } : {}),
    brief: brief.value,
    round: v.round,
    slots: slots.filter((s): s is CastSlot => s !== undefined),
    ...(isString(v.after) ? { after: v.after } : {}),
    ...(isString(v.next) ? { next: v.next } : {}),
    ...(isString(v.forgeJobId) ? { forgeJobId: v.forgeJobId } : {}),
    ...(error === undefined ? {} : { error }),
  };
}

function cutOf(v: Fields): CastCut | undefined {
  if (!isString(v.jobId)) return undefined;
  const parsed = parseParts(v.named);
  if (!parsed.ok || parsed.value.named === undefined) return undefined;
  const named: PartsV2 = { version: 2, parts: parsed.value.named, ...(parsed.value.cut === undefined ? {} : { cut: parsed.value.cut }) };
  const cut: CastCut = { jobId: v.jobId, kind: "cut", named };
  if (v.rig !== undefined) {
    const rig = validateRig(v.rig);
    if (!rig.ok) return undefined;
    cut.rig = rig.value;
  }
  if (v.assets !== undefined) {
    if (!isRecord(v.assets) || !Object.values(v.assets).every(isString)) return undefined;
    cut.assets = { ...(v.assets as Record<string, string>) };
  }
  return cut;
}

/** A casting record read back from the store (already decoded); undefined when off-contract. */
export function castRecordOf(value: unknown): CastRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "batch") return batchOf(value);
  if (value.kind === "cut") return cutOf(value);
  return undefined;
}
