// One run end to end, live or replay: run folder + config.json, stage server, output arm (which
// opens the page), wait for the page's `ready`, play, drain, `end`, stop the output, metrics.json.
// Everything with a side effect outside the run folder comes in through RunDeps, so tests swap
// the browser, the stage, the model and the voice for fakes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ControlArm, ControlArmId, Metrics, OutputArm, OutputArmId, PageMessage, RunConfig } from "../contract.js";
import type { ControlContext, ControlUsage } from "./arms/control/index.js";
import { computeMetrics } from "./metrics.js";
import type { OutputContext } from "./output/index.js";
import { runDir } from "./paths.js";
import { Session, type Clock } from "./session.js";
import type { Stage, StageLaunch } from "./stage/browser.js";
import type { StageServer } from "./stage/server.js";
import { TimelineWriter } from "./timeline.js";
import type { VoiceSynth } from "./voice/kokoro.js";

export interface RunDeps {
  /** Makes sure the page can load `character` (theme CSS, cast packs). */
  prepare(character: string): void;
  openStage(log: (line: string) => void): Promise<StageServer>;
  launch(options: StageLaunch): Promise<Stage>;
  createOutput(id: OutputArmId, ctx: OutputContext): OutputArm;
  createControl(id: ControlArmId, ctx: ControlContext): ControlArm;
  startVoice(log: (line: string) => void): Promise<VoiceSynth>;
  clock(): Clock;
  log(line: string): void;
}

export interface StageRun {
  runId: string;
  config: RunConfig;
  character: string;
  headless: boolean;
  debug: boolean;
}

export interface RunResult {
  runId: string;
  dir: string;
  metrics: Metrics;
  recording: string;
}

const READY_TIMEOUT_MS = 90_000;

export function newRunId(config: RunConfig, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const kind = config.replayOf === undefined ? `${config.control}${config.lip}${config.scene}${config.output}` : "replay";
  return `${stamp}-${config.scenario}-${kind}-s${config.seed}`;
}

/** Runs `play` on a ready stage and writes config.json, timeline.jsonl and metrics.json. */
export async function runOnStage(
  run: StageRun,
  deps: RunDeps,
  play: (session: Session, dir: string) => Promise<ControlUsage | undefined>,
): Promise<RunResult> {
  const dir = runDir(run.runId);
  mkdirSync(join(dir, "audio"), { recursive: true });
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(run.config, null, 2)}\n`);
  deps.prepare(run.character);
  const clock = deps.clock();
  const server = await deps.openStage(deps.log);
  let stage: Stage | undefined;
  try {
    const session = new Session((m) => server.send(m), new TimelineWriter(join(dir, "timeline.jsonl")), clock);
    let pageFailed: ((e: Error) => void) | undefined;
    let pageReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      pageReady = resolve;
      pageFailed = reject;
    });
    server.onMessage((m: PageMessage) => {
      session.onPage(m);
      if (m.type === "ready") pageReady?.();
      if (m.type === "error") {
        deps.log(`page: ${m.message}`);
        pageFailed?.(new Error(`The stage page failed: ${m.message}`));
      }
    });
    const output = deps.createOutput(run.config.output, {
      runId: run.runId,
      headless: run.headless,
      server,
      launch: (url) => deps.launch({ url, headless: run.headless, log: deps.log }),
      onStage: (s) => {
        stage = s;
      },
      log: deps.log,
    });
    server.send({ type: "load", runId: run.runId, character: run.character, config: run.config });
    const pageUrl = server.pageUrl({ run: run.runId, ...(run.debug ? { debug: "1" } : {}) });
    await output.start({ pageUrl, runDir: dir });
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The stage page was not ready within ${READY_TIMEOUT_MS / 1000} s.`)), READY_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));

    const cpuStart = await stage?.cpuSeconds();
    const wallStart = performance.now();
    clock.reset();
    const usage = await play(session, dir);
    await session.drain();
    const durationMs = clock.now();
    const cpuEnd = await stage?.cpuSeconds();
    const wall = (performance.now() - wallStart) / 1000;
    server.send({ type: "end" });
    const { file } = await output.stop();
    stage = undefined;

    const obs = session.observations({ runId: run.runId, config: run.config }, durationMs);
    const cpuPct = cpuStart !== undefined && cpuEnd !== undefined && wall > 0 ? ((cpuEnd - cpuStart) / wall) * 100 : undefined;
    const metrics = computeMetrics({
      ...obs,
      ...(usage === undefined ? {} : { usage }),
      ...(cpuPct === undefined ? {} : { cpuPct }),
    });
    writeFileSync(join(dir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
    return { runId: run.runId, dir, metrics, recording: file };
  } finally {
    if (stage !== undefined) await stage.close().catch(() => undefined);
    await server.close();
  }
}
