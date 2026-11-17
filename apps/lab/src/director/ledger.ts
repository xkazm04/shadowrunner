// The run ledger: every folder under var/lab/runs/ read back as a row (never rewritten), the
// per-metric comparison of two runs, and the peer a run is judged against. Unmeasured keys stay
// absent end to end (metrics.ts omits them), so a key one run lacks is "unmeasured", never a 0 delta.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BASELINE, type Metrics, type RunConfig } from "../contract.js";
import { axisOf, parseRunConfig } from "./config.js";
import { isFiniteNumber, isRecord, readJsonFile } from "./json.js";
import { percentile } from "./metrics.js";
import { RUN_ID } from "./paths.js";

type ScalarKey = "ttfaMs" | "fpsP50" | "fpsP5" | "droppedFrames" | "cpuPct" | "gpuPct" | "avOffsetMs" | "controlErrors" | "costUsd";
export type MetricKey = ScalarKey | "turnLatencyMs";
export type MetricValues = Partial<Pick<Metrics, MetricKey>>;

/** Table order and which way is better. avOffsetMs is judged by its size (+ lags, - leads). */
export const DIRECTIONS: readonly { key: MetricKey; better: "lower" | "higher" | "smaller-abs" }[] = [
  { key: "ttfaMs", better: "lower" },
  { key: "turnLatencyMs", better: "lower" },
  { key: "fpsP50", better: "higher" },
  { key: "fpsP5", better: "higher" },
  { key: "droppedFrames", better: "lower" },
  { key: "cpuPct", better: "lower" },
  { key: "gpuPct", better: "lower" },
  { key: "avOffsetMs", better: "smaller-abs" },
  { key: "controlErrors", better: "lower" },
  { key: "costUsd", better: "lower" },
];

export type Verdict = "better" | "worse" | "same" | "unmeasured";

/** One metric, run a -> run b. turnLatencyMs is compared on its p50. delta = b - a. */
export interface CompareRow {
  key: MetricKey;
  a?: number;
  b?: number;
  delta?: number;
  verdict: Verdict;
}

export interface LedgerRun {
  runId: string;
  dir: string;
  /** "incomplete": config.json or metrics.json missing or unreadable (a crashed run). */
  status: "complete" | "incomplete";
  config?: RunConfig;
  metrics?: MetricValues;
}

function scalar(m: MetricValues, key: MetricKey): number | undefined {
  if (key !== "turnLatencyMs") return m[key];
  const list = m.turnLatencyMs;
  return list === undefined || list.length === 0 ? undefined : percentile(list, 50);
}

export function compareMetrics(a: MetricValues, b: MetricValues): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const { key, better } of DIRECTIONS) {
    const va = scalar(a, key);
    const vb = scalar(b, key);
    if (va === undefined && vb === undefined) continue;
    if (va === undefined || vb === undefined) {
      rows.push({ key, ...(va === undefined ? {} : { a: va }), ...(vb === undefined ? {} : { b: vb }), verdict: "unmeasured" });
      continue;
    }
    const delta = Math.round((vb - va) * 1e6) / 1e6 + 0;
    const gain = better === "higher" ? vb - va : better === "lower" ? va - vb : Math.abs(va) - Math.abs(vb);
    rows.push({ key, a: va, b: vb, delta, verdict: gain > 0 ? "better" : gain < 0 ? "worse" : "same" });
  }
  return rows;
}

/** metrics.json -> the comparable keys; anything malformed is left out, never coerced. */
export function parseMetricValues(value: unknown): MetricValues | undefined {
  if (!isRecord(value)) return undefined;
  const out: MetricValues = {};
  for (const { key } of DIRECTIONS) {
    const v = value[key];
    if (key === "turnLatencyMs") {
      if (Array.isArray(v) && v.length > 0 && v.every(isFiniteNumber)) out.turnLatencyMs = v.filter(isFiniteNumber);
    } else if (isFiniteNumber(v)) out[key] = v;
  }
  return out;
}

function readOptional<T>(file: string, parse: (value: unknown) => T): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return parse(readJsonFile(file));
  } catch {
    return undefined;
  }
}

/** One run folder as a ledger row; nothing thrown for a crashed or half-written run. */
export function readRun(root: string, runId: string): LedgerRun {
  const dir = join(root, runId);
  const config = readOptional(join(dir, "config.json"), parseRunConfig);
  const metrics = readOptional(join(dir, "metrics.json"), parseMetricValues);
  return {
    runId,
    dir,
    status: config !== undefined && metrics !== undefined ? "complete" : "incomplete",
    ...(config === undefined ? {} : { config }),
    ...(metrics === undefined ? {} : { metrics }),
  };
}

const STAMP = /^\d{8}-\d{6}/;

/** Newest first: by the run id's UTC stamp (run.ts newRunId), else the folder's mtime. */
function sortKey(dir: string, runId: string): string {
  const stamp = STAMP.exec(runId)?.[0];
  if (stamp !== undefined) return stamp;
  return statSync(dir).mtime.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export function listRuns(root: string, filter: { scenario?: string } = {}): LedgerRun[] {
  if (!existsSync(root)) return [];
  const rows = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && RUN_ID.test(e.name))
    .map((e) => ({ run: readRun(root, e.name), key: sortKey(join(root, e.name), e.name) }))
    .filter(({ run }) => filter.scenario === undefined || run.config?.scenario === filter.scenario);
  rows.sort((x, y) => (x.key === y.key ? y.run.runId.localeCompare(x.run.runId) : y.key.localeCompare(x.key)));
  return rows.map((r) => r.run);
}

function onBaseline(config: RunConfig): boolean {
  return config.control === BASELINE.control && config.lip === BASELINE.lip && config.scene === BASELINE.scene && config.output === BASELINE.output;
}

/**
 * The run `run` is judged against: the first (newest) complete, non-replay, non-external run of the
 * same scenario and seed that differs on exactly one arm, or sits on the BASELINE arms.
 */
export function referenceRun(ledger: readonly LedgerRun[], run: LedgerRun): LedgerRun | undefined {
  const own = run.config;
  if (own === undefined) return undefined;
  return ledger.find((peer) => {
    const c = peer.config;
    if (peer.runId === run.runId || peer.status !== "complete" || c === undefined) return false;
    if (c.replayOf !== undefined || c.external !== undefined || c.scenario !== own.scenario || c.seed !== own.seed) return false;
    const axis = axisOf(c, own);
    return onBaseline(c) || (axis !== "same" && axis !== "external" && !axis.includes("+"));
  });
}
