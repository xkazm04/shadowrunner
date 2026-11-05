// `pnpm lab <command> [flags]` -> a Command. Pure, so the flag grammar is unit-tested.
import type { LlmKind } from "./llm/index.js";

export const USAGE = `Avatar Lab (docs/lab.md)

  pnpm lab setup                         voice venv + Kokoro models
  pnpm lab run [flags]                   one run -> var/lab/runs/<runId>/
      --config baseline|<json>|<file>    arms (default baseline: C0 L0 S0 O0)
      --scenario <id>                    src/scenarios/<id>.json (default haunt-01)
      --seed <n>                         default: the scenario's seed
      --headless                         headless Chromium (GPU first, SwiftShader fallback)
      --llm api|cli                      default api with ANTHROPIC_API_KEY, else cli
      --model <id>                       model for the control arm
      --control-fixture [file]           recorded replies instead of a model
                                         (default src/scenarios/<scenario>.fixture.json)
      --time-scale <x>                   multiplies chat times (default 1)
      --debug                            draw the live event list on the page
  pnpm lab replay <runId> [--headless] [--debug]
                                         re-render a run: zero LLM and zero TTS calls
  pnpm lab fixture <runId>               write the run's replies as its scenario's fixture`;

export interface RunCommand {
  command: "run";
  config: string;
  scenario: string;
  seed?: number;
  headless: boolean;
  llm?: LlmKind;
  model?: string;
  /** "" means the scenario's default fixture file. */
  fixture?: string;
  timeScale: number;
  debug: boolean;
}

export type Command =
  | RunCommand
  | { command: "replay"; runId: string; headless: boolean; debug: boolean }
  | { command: "fixture"; runId: string }
  | { command: "setup" }
  | { command: "help" };

function number(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(n)) throw new Error(`${flag} needs a number.`);
  return n;
}

function value(flag: string, next: string | undefined): string {
  if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return next;
}

export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv.filter((a) => a !== "--");
  if (command === undefined || command === "help" || command === "--help" || command === "-h") return { command: "help" };
  if (command === "setup") return { command: "setup" };
  if (command === "replay" || command === "fixture") {
    const runId = rest.find((a) => !a.startsWith("--"));
    if (runId === undefined) throw new Error(`pnpm lab ${command} needs a run id.`);
    if (command === "fixture") return { command, runId };
    return { command, runId, headless: rest.includes("--headless"), debug: rest.includes("--debug") };
  }
  if (command !== "run") throw new Error(`Unknown command "${command}". Commands: run, replay, fixture, setup.`);
  const out: RunCommand = { command: "run", config: "baseline", scenario: "haunt-01", headless: false, timeScale: 1, debug: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const next = rest[i + 1];
    switch (flag) {
      case "--config":
        out.config = value(flag, next);
        i += 1;
        break;
      case "--scenario":
        out.scenario = value(flag, next);
        i += 1;
        break;
      case "--seed":
        out.seed = number(flag, next);
        i += 1;
        break;
      case "--time-scale":
        out.timeScale = number(flag, next);
        if (out.timeScale <= 0) throw new Error("--time-scale must be above 0.");
        i += 1;
        break;
      case "--llm": {
        const kind = value(flag, next);
        if (kind !== "api" && kind !== "cli") throw new Error("--llm must be api or cli.");
        out.llm = kind;
        i += 1;
        break;
      }
      case "--model":
        out.model = value(flag, next);
        i += 1;
        break;
      case "--control-fixture":
        if (next !== undefined && !next.startsWith("--")) {
          out.fixture = next;
          i += 1;
        } else out.fixture = "";
        break;
      case "--headless":
        out.headless = true;
        break;
      case "--debug":
        out.debug = true;
        break;
      default:
        throw new Error(`Unknown flag "${flag}" for pnpm lab run.`);
    }
  }
  return out;
}
