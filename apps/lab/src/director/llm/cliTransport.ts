// `cli` transport: the locally logged-in `claude` CLI in print mode, one process per complete().
// It runs in an empty folder (var/lab/cli-cwd) with no tools, no MCP servers and no setting
// sources, so the only prompt is ours. Cost comes from the CLI's result line (total_cost_usd).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { CLI_CWD } from "../paths.js";
import { cliArgs, cliPrompt, CliStreamParser } from "./cliStream.js";
import { DEFAULT_LAB_MODEL, type LlmChunk, type LlmRequest, type LlmTransport } from "./types.js";

export interface CliTransportOptions {
  /** Executable; default `claude` from PATH. */
  command?: string;
  model?: string;
  /** Per-call timeout; default 120 s. */
  timeoutMs?: number;
}

export function createCliTransport(options: CliTransportOptions = {}): LlmTransport {
  const command = options.command ?? "claude";
  const timeoutMs = options.timeoutMs ?? 120_000;
  return {
    kind: "cli",
    async *complete(request: LlmRequest): AsyncIterable<LlmChunk> {
      mkdirSync(CLI_CWD, { recursive: true });
      const model = request.model ?? options.model ?? DEFAULT_LAB_MODEL;
      const parser = new CliStreamParser(request.tools !== undefined && request.tools.length > 0);
      const child = spawn(command, cliArgs(request, model), { cwd: CLI_CWD, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d: string) => {
        stderr = (stderr + d).slice(-4000);
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once("error", (error) => reject(new Error(`claude CLI could not start (${command}): ${error.message}`)));
        child.once("close", (code) => resolve(code));
      });
      // Keep a spawn failure from surfacing as an unhandled rejection before it is awaited.
      exited.catch(() => undefined);
      const timer = setTimeout(() => child.kill(), timeoutMs);
      try {
        child.stdin.end(cliPrompt(request.messages), "utf8");
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        for await (const line of lines) {
          for (const chunk of parser.line(line)) yield chunk;
        }
        parser.finish(stderr, await exited);
      } finally {
        clearTimeout(timer);
        if (child.exitCode === null) child.kill();
      }
    },
  };
}
