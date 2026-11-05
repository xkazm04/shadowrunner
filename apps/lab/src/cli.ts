// Avatar Lab director CLI (`pnpm lab ...`, see director/args.ts USAGE and docs/lab.md). Node only:
// ANTHROPIC_API_KEY is read here and nowhere in the page.
import { DEFAULT_ENGINE_MODEL } from "@sr/engine";
import { loadFixture } from "./director/arms/control/fixture.js";
import { createControlArm } from "./director/arms/control/index.js";
import { parseArgs, USAGE, type RunCommand } from "./director/args.js";
import { resolveConfig } from "./director/config.js";
import { runLive } from "./director/live.js";
import { createTransport, defaultLlmKind } from "./director/llm/index.js";
import { createOutputArm } from "./director/output/index.js";
import { ensureStageAssets } from "./director/prep.js";
import { fixturePath, recordFixture } from "./director/recordFixture.js";
import { runReplay } from "./director/replay.js";
import type { RunDeps, RunResult } from "./director/run.js";
import { loadScenario } from "./director/scenario.js";
import { realClock } from "./director/session.js";
import { setup } from "./director/setup.js";
import { launchStage } from "./director/stage/browser.js";
import { openStage } from "./director/stage/server.js";
import { startKokoro } from "./director/voice/kokoro.js";
import { boardCommand } from "./board/board.js";
import { loopCommand } from "./director/output/o1/loop.js";
import { measureCommand } from "./measure/measure.js";
import { synthCommand } from "./measure/synthCommand.js";
import { mouthsCommand } from "./mouths/command.js";
import { overlordCommand } from "./overlord/run.js";

const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const deps: RunDeps = {
  prepare: (character) => ensureStageAssets(character, log),
  openStage,
  launch: launchStage,
  createOutput: createOutputArm,
  createControl: createControlArm,
  startVoice: startKokoro,
  clock: realClock,
  log,
};

function report(result: RunResult): void {
  log(`run ${result.runId} done: ${result.dir}`);
  log(`recording: ${result.recording}`);
  process.stdout.write(`${JSON.stringify(result.metrics, null, 2)}\n`);
}

async function run(cmd: RunCommand): Promise<RunResult> {
  const scenario = loadScenario(cmd.scenario);
  const config = resolveConfig(cmd.config, scenario.id, cmd.seed ?? scenario.seed);
  const kind = cmd.llm ?? defaultLlmKind(process.env);
  const apiKey = kind === "api" ? process.env.ANTHROPIC_API_KEY?.trim() : undefined;
  if (kind === "api" && !apiKey) throw new Error("--llm api needs ANTHROPIC_API_KEY in the environment.");
  const fixture = cmd.fixture === undefined ? undefined : loadFixture(cmd.fixture === "" ? fixturePath(scenario.id) : cmd.fixture);
  const model = cmd.model ?? DEFAULT_ENGINE_MODEL;
  return runLive(
    {
      config,
      scenario,
      llm: createTransport(kind, process.env, model),
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(fixture === undefined ? {} : { fixture }),
      model,
      wire: fixture === undefined ? `${kind} ${model}` : `fixture ${fixture.source}`,
      timeScale: cmd.timeScale,
      headless: cmd.headless,
      debug: cmd.debug,
    },
    deps,
  );
}

/** Commands that own their own flags (WP3, WP4); the rest go through director/args.ts. */
const TOOLS: Readonly<Record<string, (argv: readonly string[], log: (line: string) => void) => Promise<void>>> = {
  mouths: (argv, l) => mouthsCommand(argv, l),
  measure: measureCommand,
  synth: synthCommand,
  loop: loopCommand,
  overlord: overlordCommand,
  board: boardCommand,
};

async function main(argv: readonly string[]): Promise<void> {
  const tool = argv[0] === undefined ? undefined : TOOLS[argv[0]];
  if (tool !== undefined) return tool(argv.slice(1), log);
  const cmd = parseArgs(argv);
  switch (cmd.command) {
    case "help":
      process.stdout.write(`${USAGE}\n`);
      return;
    case "setup":
      return setup(log);
    case "fixture":
      log(`fixture written: ${recordFixture(cmd.runId)}`);
      return;
    case "replay":
      return report(await runReplay({ sourceRunId: cmd.runId, headless: cmd.headless, debug: cmd.debug }, deps));
    case "run":
      return report(await run(cmd));
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
