// Overlord's processes for a baseline run, started from its own build and config (nothing in the
// Overlord repo is written by the lab): the daemon (`shadowrunr --config <toml> daemon --scripted`,
// HTTP + WS on 127.0.0.1:<port>) and the stage dev server (`pnpm -C apps/stage dev`), plus the
// daemon's `/rpc` (`{ method, params }` -> `{ result } | { error }`).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface OverlordSetup {
  /** The Overlord repo (default C:\Users\kazda\kiro\overlord or SR_LAB_OVERLORD). */
  repo: string;
  /** A shadowrunr.toml whose runs/data paths point outside the repo (docs runbook). */
  toml: string;
  port: number;
  stagePort: number;
  log(line: string): void;
}

export const DEFAULT_REPO = process.env.SR_LAB_OVERLORD ?? "C:\\Users\\kazda\\kiro\\overlord";

export function daemonExe(repo: string): string {
  return join(repo, "target", "release", process.platform === "win32" ? "shadowrunr.exe" : "shadowrunr");
}

/** Kills a process and its children (Windows needs taskkill /T for pnpm -> node -> vite). */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `url` until it answers (any HTTP status) or `ms` passes. */
export async function waitHttp(url: string, ms: number, init?: RequestInit): Promise<void> {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    try {
      await fetch(url, init);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s (${last}).`);
}

export async function rpc(port: number, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body: unknown = await res.json();
  if (typeof body === "object" && body !== null && "result" in body) return body.result;
  throw new Error(`Overlord ${method} answered ${JSON.stringify(body)}.`);
}

function pipeLog(child: ChildProcess, tag: string, log: (line: string) => void): void {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (text: string) => {
      for (const line of text.split(/\r?\n/)) if (line.trim() !== "") log(`${tag}: ${line.trim()}`);
    });
  }
}

export interface Started {
  daemon: ChildProcess;
  stage: ChildProcess;
  stop(): void;
}

export async function startOverlord(s: OverlordSetup): Promise<Started> {
  const exe = daemonExe(s.repo);
  if (!existsSync(exe)) throw new Error(`${exe} is missing: build it with "cargo build --release -p shadowrunr-daemon" in ${s.repo}.`);
  if (!existsSync(s.toml)) throw new Error(`${s.toml} is missing: write the baseline shadowrunr.toml (docs/lab.md, Overlord baseline).`);
  const daemon = spawn(exe, ["--config", s.toml, "daemon", "--scripted", "--port", String(s.port)], { cwd: dirname(s.toml), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  pipeLog(daemon, "overlord daemon", s.log);
  const stage = spawn("pnpm", ["-C", join(s.repo, "apps", "stage"), "dev", "--port", String(s.stagePort), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true });
  pipeLog(stage, "overlord stage", () => undefined);
  const stop = (): void => {
    killTree(stage);
    killTree(daemon);
  };
  try {
    await waitHttp(`http://127.0.0.1:${s.port}/rpc`, 60_000, { method: "POST", body: "{}" });
    await waitHttp(`http://localhost:${s.stagePort}/`, 90_000);
  } catch (error) {
    stop();
    throw error;
  }
  return { daemon, stage, stop };
}
