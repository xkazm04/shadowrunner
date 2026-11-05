// metrics.json from what a run observed. Keys the run could not measure are omitted (contract
// convention), never written as 0. avOffsetMs is WP4's and is never computed here.
import type { Metrics, RunConfig } from "../contract.js";
import type { ControlUsage } from "./arms/control/index.js";

export interface RunObservations {
  runId: string;
  config: RunConfig;
  durationMs: number;
  /** Turn number -> director clock ms when its chat message arrived. */
  turnArrivals: Map<number, number>;
  /** Turn number -> id of the first utterance spoken for it. */
  firstUtterance: Map<number, string>;
  /** Utterance id -> director clock ms when the page reported its first audible sample. */
  audioStarts: Map<string, number>;
  /** Instantaneous fps samples from the page's frameStats. */
  fps: number[];
  dropped?: number;
  renderBackend?: string;
  cpuPct?: number;
  /** Absent on replay: no control arm ran. */
  usage?: ControlUsage;
  sceneOps?: number;
}

/** Nearest-rank percentile (p in 0..100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Chat arrival to first audible sample, per turn that spoke, in turn order. */
export function turnLatencies(obs: RunObservations): { turn: number; ms: number }[] {
  const out: { turn: number; ms: number }[] = [];
  for (const [turn, arrived] of [...obs.turnArrivals.entries()].sort((a, b) => a[0] - b[0])) {
    const id = obs.firstUtterance.get(turn);
    const started = id === undefined ? undefined : obs.audioStarts.get(id);
    if (started !== undefined) out.push({ turn, ms: Math.round(started - arrived) });
  }
  return out;
}

export function computeMetrics(obs: RunObservations): Metrics {
  const latencies = turnLatencies(obs);
  const first = latencies[0];
  const firstTurn = Math.min(...obs.turnArrivals.keys());
  const fps = obs.fps.filter((f) => Number.isFinite(f) && f > 0);
  const usage = obs.usage;
  return {
    runId: obs.runId,
    config: obs.config,
    durationS: round1(obs.durationMs / 1000),
    ...(first !== undefined && first.turn === firstTurn ? { ttfaMs: first.ms } : {}),
    ...(latencies.length > 0 ? { turnLatencyMs: latencies.map((l) => l.ms) } : {}),
    ...(fps.length > 0 ? { fpsP50: round1(percentile(fps, 50)), fpsP5: round1(percentile(fps, 5)) } : {}),
    ...(obs.dropped === undefined ? {} : { droppedFrames: obs.dropped }),
    ...(obs.cpuPct === undefined ? {} : { cpuPct: round1(obs.cpuPct) }),
    ...(usage === undefined ? {} : { controlErrors: usage.controlErrors }),
    ...(obs.sceneOps === undefined ? {} : { sceneOps: obs.sceneOps }),
    ...(usage === undefined || usage.tokensIn + usage.tokensOut === 0 ? {} : { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut }),
    ...(usage === undefined || usage.costUsd <= 0 ? {} : { costUsd: Math.round(usage.costUsd * 1e6) / 1e6 }),
    ...(obs.renderBackend === undefined ? {} : { renderBackend: obs.renderBackend }),
  };
}
