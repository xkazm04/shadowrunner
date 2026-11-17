// Fixed-width text for the run ledger (stderr): `pnpm lab runs`, `pnpm lab compare`, and the verdict
// line every run and replay ends with.
import { armTag, axisOf } from "./config.js";
import { compareMetrics, listRuns, readRun, referenceRun, type CompareRow, type LedgerRun } from "./ledger.js";
import { percentile } from "./metrics.js";

const num = (n: number | undefined): string => (n === undefined ? "-" : String(Number(n.toPrecision(6))));
const signed = (n: number | undefined): string => (n === undefined ? "-" : n > 0 ? `+${num(n)}` : num(n));

function table(rows: readonly (readonly string[])[]): string[] {
  const widths = rows.reduce<number[]>((w, row) => row.map((cell, i) => Math.max(w[i] ?? 0, cell.length)), []);
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd());
}

function arms(run: LedgerRun): string {
  const c = run.config;
  if (c === undefined) return "-";
  if (c.external !== undefined) return `ext:${c.external}`;
  return c.replayOf === undefined ? armTag(c) : `${armTag(c)} replay`;
}

/** `pnpm lab runs`: one line per run, newest first; a crashed run says "incomplete". */
export function formatRunsTable(runs: readonly LedgerRun[]): string[] {
  const head = ["run", "arms", "ttfaMs", "latP50", "fpsP50", "errors", "costUsd", "status"];
  return table([
    head,
    ...runs.map((r) => {
      const m = r.metrics ?? {};
      const lat = m.turnLatencyMs === undefined ? undefined : percentile(m.turnLatencyMs, 50);
      return [r.runId, arms(r), num(m.ttfaMs), num(lat), num(m.fpsP50), num(m.controlErrors), num(m.costUsd), r.status];
    }),
  ]);
}

function axis(a: LedgerRun, b: LedgerRun): string {
  return a.config === undefined || b.config === undefined ? "?" : axisOf(a.config, b.config);
}

/** `pnpm lab compare a b`: the axis line, then metric / a / b / delta / verdict. */
export function formatComparison(a: LedgerRun, b: LedgerRun): string[] {
  const rows = compareMetrics(a.metrics ?? {}, b.metrics ?? {});
  const head = `${a.runId} -> ${b.runId} (${axis(a, b)})`;
  if (rows.length === 0) return [head, "no metric measured in either run"];
  const label = (r: CompareRow): string => (r.key === "turnLatencyMs" ? "turnLatencyMs p50" : r.key);
  return [head, ...table([["metric", "a", "b", "delta", "verdict"], ...rows.map((r) => [label(r), num(r.a), num(r.b), signed(r.delta), r.verdict])])];
}

/** One line: `vs <peer> (<axis>): ttfaMs 1840 -> 1610 better, ...`, or why there is no peer. */
export function formatVerdict(peer: LedgerRun | undefined, run: LedgerRun): string {
  if (peer === undefined) {
    const c = run.config;
    return c === undefined ? `no comparable run (${run.runId} has no readable config.json)` : `no comparable run (scenario ${c.scenario}, seed ${c.seed})`;
  }
  const rows = compareMetrics(peer.metrics ?? {}, run.metrics ?? {});
  const body = rows.length === 0 ? "no metric measured in either run" : rows.map((r) => `${r.key} ${num(r.a)} -> ${num(r.b)} ${r.verdict}`).join(", ");
  return `vs ${peer.runId} (${axis(peer, run)}): ${body}`;
}

/** The verdict for `runId` against its newest comparable peer under `root`. */
export function runVerdict(root: string, runId: string): string {
  const ledger = listRuns(root);
  const run = ledger.find((r) => r.runId === runId) ?? readRun(root, runId);
  return formatVerdict(referenceRun(ledger, run), run);
}
