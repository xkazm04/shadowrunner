// forge-creator S1, say why a face was refused: the stability gate's reading of a family that
// settled without a painted face, small enough to ride in the job record (<= 50 KB) and on a kept
// character. `reason` is what turned it down:
// - "iris": the irises moved (`irisDriftPx` over `limit`, IRIS_DRIFT_LIMIT);
// - "band": the edit repainted outside the brow+lid band (`outsideBandMean` over `limit`, outsideLimit);
// - "drift": an unsocketed rig's edit drifted (`drift` over `limit`, EXPRESSION_DRIFT_LIMIT);
// - "no_change": the edit changed no layer; "budget": the daily budget refused the charge;
// - "failed": the edit threw or came back unreadable.
// `attempts` is how many edits that family spent (C3 re-runs refused faces), omitted at 0. The
// numbers are the LAST attempt's, rounded to one decimal. `readFaceGate` is the one reader (the job
// parser, the client's readJobView, the library's readRecord): it drops a malformed entry rather
// than the whole record, since the reading is a note, not part of the character.
// Browser-safe and pure.
import { EXPRESSION_FAMILIES, type ExpressionFamily } from "@sr/rig";

export const FACE_GATE_REASONS = ["iris", "band", "drift", "no_change", "budget", "failed"] as const;
export type FaceGateReason = (typeof FACE_GATE_REASONS)[number];

export interface FaceGateReading {
  reason: FaceGateReason;
  /** Edits spent on the family (1 + its stricter re-runs); omitted at 0 (a budget refusal before any edit). */
  attempts?: number;
  /** "iris": the largest iris move in the last edit, px. */
  irisDriftPx?: number;
  /** "band": the mean |RGB| change outside the brow+lid band in the last edit. */
  outsideBandMean?: number;
  /** "drift": the unsocketed drift of the last edit. */
  drift?: number;
  /** The limit the number went over. */
  limit?: number;
}

export type FaceGate = Partial<Record<ExpressionFamily, FaceGateReading>>;

/** The largest number a reading keeps (an |RGB| mean is <= 255, a drift in px stays well under this). */
export const GATE_NUMBER_MAX = 10_000;
/** The most edits one family can spend is far under this; anything above is not a reading. */
export const GATE_ATTEMPTS_MAX = 99;

const NUMBERS = ["irisDriftPx", "outsideBandMean", "drift", "limit"] as const;

/** `n` to one decimal (-0 as 0). */
export const round1 = (n: number): number => Math.round(n * 10) / 10 + 0;

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= GATE_NUMBER_MAX;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isReason = (v: unknown): v is FaceGateReason => typeof v === "string" && (FACE_GATE_REASONS as readonly string[]).includes(v);

/** A reading with its numbers rounded; a number that is not finite and in range is left out. */
export function gateReading(reason: FaceGateReason, fields: Omit<FaceGateReading, "reason"> = {}): FaceGateReading {
  const out: FaceGateReading = { reason };
  const { attempts } = fields;
  if (attempts !== undefined && Number.isInteger(attempts) && attempts >= 1 && attempts <= GATE_ATTEMPTS_MAX) out.attempts = attempts;
  for (const key of NUMBERS) {
    const v = fields[key];
    if (isNumber(v)) out[key] = round1(v);
  }
  return out;
}

/** One stored reading, or undefined when any field is off-contract (unknown fields are dropped). */
export function readGateReading(v: unknown): FaceGateReading | undefined {
  if (!isRecord(v) || !isReason(v.reason)) return undefined;
  const a = v.attempts;
  if (a !== undefined && (typeof a !== "number" || !Number.isInteger(a) || a < 1 || a > GATE_ATTEMPTS_MAX)) return undefined;
  const fields: Omit<FaceGateReading, "reason"> = typeof a === "number" ? { attempts: a } : {};
  for (const key of NUMBERS) {
    const n = v[key];
    if (n === undefined) continue;
    if (!isNumber(n)) return undefined;
    fields[key] = n;
  }
  return gateReading(v.reason, fields);
}

/** The readings in `v` that are on-contract (others dropped), or undefined when none is. */
export function readFaceGate(v: unknown): FaceGate | undefined {
  if (!isRecord(v)) return undefined;
  const out: FaceGate = {};
  let any = false;
  for (const family of EXPRESSION_FAMILIES) {
    if (!Object.prototype.hasOwnProperty.call(v, family)) continue;
    const reading = readGateReading(v[family]);
    if (reading === undefined) continue;
    out[family] = reading;
    any = true;
  }
  return any ? out : undefined;
}

/** `gate` with `family` set to `reading`. */
export const withGate = (gate: FaceGate | undefined, family: ExpressionFamily, reading: FaceGateReading): FaceGate => ({ ...gate, [family]: reading });
