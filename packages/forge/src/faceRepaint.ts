// forge-creator S2, repaint one face: the pure half of `POST /api/forge/:jobId/faces`. After a live
// forge the streamer may repaint ONE expression family within the source job's 24 h lifetime: one
// paid edit (REPAINT_ESTIMATE_USD), nothing else re-run. The server hands back a candidate (the
// family's patches and their stored files, or the gate's reading); the client merges it only on
// Accept, and only when it passed the gate.
// - `repaintAttempt`: the prompt's strictness from why the family has no painted face (its
//   FaceGateReading): "iris" -> attempt 1 (STRICTER[0]); "band"/"drift" -> attempt 2
//   (STRICTER[0..1]); "no_change" (the edit was already too faint) -> 0; a family that painted (no
//   reading), "budget" or "failed" -> 1. The streamer's "too subtle" hint drops the stricter
//   wording (attempt 0) whatever the reading.
// - The ledger in the job record (`ForgeJob.repaints`, a few hundred bytes): repaints spent per
//   family (at most MAX_FAMILY_REPAINTS) and per job (MAX_JOB_REPAINTS), and each request `key`
//   with its result, so a repeated key answers the first result without spending. A key is
//   reserved (and the counts spent) before the paid edit, so a crash costs a repaint, never money twice.
// - `readRepaintLedger` / `readRepaintCandidate`: the readers of a stored ledger (the job parser) and
//   of a candidate on the wire (the client); anything off-contract is undefined.
// Browser-safe and pure.
import { EXPRESSION_FAMILIES, type ExpressionFamily, type LayerPatch } from "@sr/rig";
import { readGateReading, type FaceGateReading } from "./faceGate.js";
import type { RepaintCandidate, RepaintHint } from "./wire.js";

/** One repaint is one expression edit (api/_lib/costs.ts COST_USD.expression), shown before spending. */
export const REPAINT_ESTIMATE_USD = 0.14;
/** Repaints one family may spend. */
export const MAX_FAMILY_REPAINTS = 2;
/** Repaints one job may spend over its six families. */
export const MAX_JOB_REPAINTS = 4;
/** A request's idempotency key. */
export const REPAINT_KEY = /^[A-Za-z0-9_-]{8,40}$/;
/** A pending key older than this (the 60 s step lease) is a repaint that never came back. */
export const REPAINT_PENDING_MS = 60_000;

/** The attempt (expressionPrompt's STRICTER sentences) a repaint runs at (see the header). */
export function repaintAttempt(reading: Pick<FaceGateReading, "reason"> | undefined, hint?: RepaintHint): number {
  if (hint === "too_subtle") return 0;
  if (reading === undefined) return 1;
  if (reading.reason === "band" || reading.reason === "drift") return 2;
  if (reading.reason === "no_change") return 0;
  return 1;
}

export interface RepaintEntry {
  family: ExpressionFamily;
  /** Epoch ms the repaint was reserved. */
  at: number;
  /** The answer, once the edit came back; omitted while it runs. */
  result?: RepaintCandidate;
}

export interface RepaintLedger {
  /** Repaints spent per family (1..MAX_FAMILY_REPAINTS); a family with none is omitted. */
  counts: Partial<Record<ExpressionFamily, number>>;
  /** Every reserved request by its key (at most MAX_JOB_REPAINTS). */
  keys: Record<string, RepaintEntry>;
}

export const EMPTY_LEDGER: RepaintLedger = { counts: {}, keys: {} };

const total = (ledger: RepaintLedger): number => Object.values(ledger.counts).reduce((a, n) => a + n, 0);

/** Repaints still open for `family` and for the job. */
export function repaintsLeft(ledger: RepaintLedger | undefined, family: ExpressionFamily): { family: number; job: number } {
  const l = ledger ?? EMPTY_LEDGER;
  const job = Math.max(0, MAX_JOB_REPAINTS - total(l));
  return { family: Math.min(job, Math.max(0, MAX_FAMILY_REPAINTS - (l.counts[family] ?? 0))), job };
}

/** Why a new repaint of `family` is refused ("family": its two are spent; "job": the job's four are), or undefined. */
export function repaintRefusal(ledger: RepaintLedger | undefined, family: ExpressionFamily): "family" | "job" | undefined {
  const left = repaintsLeft(ledger, family);
  if (left.job === 0) return "job";
  return left.family === 0 ? "family" : undefined;
}

/** `ledger` with `key` reserved for `family` at `at` and the counts spent (call only when `repaintRefusal` is undefined). */
export function reserveRepaint(ledger: RepaintLedger | undefined, key: string, family: ExpressionFamily, at: number): RepaintLedger {
  const l = ledger ?? EMPTY_LEDGER;
  return { counts: { ...l.counts, [family]: (l.counts[family] ?? 0) + 1 }, keys: { ...l.keys, [key]: { family, at } } };
}

/** `ledger` with the answer for `key` (a key it never reserved is left out). */
export function settleRepaint(ledger: RepaintLedger, key: string, result: RepaintCandidate): RepaintLedger {
  const entry = ledger.keys[key];
  if (entry === undefined) return ledger;
  return { counts: { ...ledger.counts }, keys: { ...ledger.keys, [key]: { ...entry, result } } };
}

/** The repaint number of `family` once reserved (1 or 2): it names the candidate's files apart. */
export const repaintTag = (ledger: RepaintLedger, family: ExpressionFamily): string => `r${ledger.counts[family] ?? 0}`;

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isFamily = (v: unknown): v is ExpressionFamily => typeof v === "string" && (EXPRESSION_FAMILIES as readonly string[]).includes(v);
const isCount = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
/** A patch file or socket: `<layer>.<suffix>[.<suffix>].png`, no path. */
const PATCH_FILE = /^[A-Za-z0-9_-]{1,64}(?:\.[A-Za-z0-9_-]{1,32}){1,2}\.png$/;
const LAYER_NAME = /^[a-z0-9_]{1,64}$/;
const MAX_URL = 2048;
/** A candidate never patches more layers than a rig can have face layers. */
const MAX_PATCHES = 32;

/** One layer patch, or undefined when off-contract (rig validation of the merged rig is the final check). */
export function readLayerPatch(v: unknown): LayerPatch | undefined {
  if (!isRecord(v) || typeof v.file !== "string" || !PATCH_FILE.test(v.file) || (v.mode !== "over" && v.mode !== "replace")) return undefined;
  const b = v.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const [x, y, w, h] = b as [number, number, number, number];
  if (w <= 0 || h <= 0) return undefined;
  if (v.socket !== undefined && (typeof v.socket !== "string" || !PATCH_FILE.test(v.socket))) return undefined;
  if (v.narrowed !== undefined && v.narrowed !== true) return undefined;
  return { file: v.file, bbox: [x, y, w, h], mode: v.mode, ...(typeof v.socket === "string" ? { socket: v.socket } : {}), ...(v.narrowed === true ? { narrowed: true as const } : {}) };
}

/** A candidate (the wire answer, or one kept in the ledger), or undefined when off-contract. */
export function readRepaintCandidate(v: unknown): RepaintCandidate | undefined {
  if (!isRecord(v) || !isFamily(v.family) || typeof v.ok !== "boolean" || (v.plane !== "replay" && v.plane !== "live")) return undefined;
  const left = v.left;
  if (!isRecord(left) || !isCount(left.family, MAX_FAMILY_REPAINTS) || !isCount(left.job, MAX_JOB_REPAINTS)) return undefined;
  const out: RepaintCandidate = { family: v.family, ok: v.ok, plane: v.plane, left: { family: left.family, job: left.job } };
  if (v.gate !== undefined) {
    const gate = readGateReading(v.gate);
    if (gate === undefined) return undefined;
    out.gate = gate;
  }
  if (v.patch !== undefined) {
    const p = v.patch;
    if (!isRecord(p) || !isRecord(p.layers) || !isRecord(p.assets)) return undefined;
    const entries = Object.entries(p.layers);
    if (entries.length === 0 || entries.length > MAX_PATCHES) return undefined;
    const layers: Record<string, LayerPatch> = {};
    for (const [name, raw] of entries) {
      const patch = readLayerPatch(raw);
      if (!LAYER_NAME.test(name) || patch === undefined) return undefined;
      layers[name] = patch;
    }
    const assets: Record<string, string> = {};
    for (const patch of Object.values(layers)) {
      for (const file of [patch.file, ...(patch.socket === undefined ? [] : [patch.socket])]) {
        const url = p.assets[file];
        if (typeof url !== "string" || url === "" || url.length > MAX_URL) return undefined;
        assets[file] = url;
      }
    }
    out.patch = { layers, assets };
  }
  // A candidate that passed carries its face; one that did not carries no face to accept.
  if (out.ok !== (out.patch !== undefined)) return undefined;
  return out;
}

/** A stored ledger, or undefined when it is off-contract (the job parser then drops the job: the counts guard money). */
export function readRepaintLedger(v: unknown): RepaintLedger | undefined {
  if (!isRecord(v) || !isRecord(v.counts) || !isRecord(v.keys)) return undefined;
  const counts: RepaintLedger["counts"] = {};
  for (const [family, n] of Object.entries(v.counts)) {
    if (!isFamily(family) || !isCount(n, MAX_FAMILY_REPAINTS) || n === 0) return undefined;
    counts[family] = n;
  }
  const ledger: RepaintLedger = { counts, keys: {} };
  if (total(ledger) > MAX_JOB_REPAINTS) return undefined;
  const keys = Object.entries(v.keys);
  if (keys.length > MAX_JOB_REPAINTS) return undefined;
  for (const [key, raw] of keys) {
    if (!REPAINT_KEY.test(key) || !isRecord(raw) || !isFamily(raw.family) || !isCount(raw.at, Number.MAX_SAFE_INTEGER)) return undefined;
    const entry: RepaintEntry = { family: raw.family, at: raw.at };
    if (raw.result !== undefined) {
      const result = readRepaintCandidate(raw.result);
      if (result === undefined || result.family !== raw.family) return undefined;
      entry.result = result;
    }
    ledger.keys[key] = entry;
  }
  return ledger;
}
