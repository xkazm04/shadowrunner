// Where the lab reads and writes, from the repo root. Runtime output lives under var/lab/ (gitignored).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const LAB_ROOT = resolve(HERE, "..", "..");
export const REPO_ROOT = resolve(LAB_ROOT, "..", "..");
export const PAGE_DIR = join(LAB_ROOT, "src", "page");
export const SCENARIOS_DIR = join(LAB_ROOT, "src", "scenarios");
export const VAR_LAB = join(REPO_ROOT, "var", "lab");
/** var/lab/runs, or SR_LAB_RUNS_DIR when set (tests use a temp folder). Read on every call. */
export function runsRoot(): string {
  return process.env.SR_LAB_RUNS_DIR ?? join(VAR_LAB, "runs");
}
export const MODELS_DIR = join(VAR_LAB, "models");
/** An empty folder the `claude` CLI runs in, so it discovers no CLAUDE.md or project settings. */
export const CLI_CWD = join(VAR_LAB, "cli-cwd");
export const VOICE_DIR = join(REPO_ROOT, "tools", "lab-voice");
export const VOICE_VENV = join(VOICE_DIR, ".venv");
export const VOICE_PYTHON =
  process.platform === "win32" ? join(VOICE_VENV, "Scripts", "python.exe") : join(VOICE_VENV, "bin", "python");
/** Built cast packs (scripts/build-packs.mjs); the page loads `/packs/<id>.srpack`. */
export const WEB_PUBLIC = join(REPO_ROOT, "apps", "web", "public");
export const PACKS_DIR = join(WEB_PUBLIC, "packs");
export const THEME_DIST = join(REPO_ROOT, "packages", "theme", "dist");

/** A run id names one folder under var/lab/runs/; nothing else is accepted. */
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function runDir(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`"${runId}" is not a run id (letters, digits, dot, dash, underscore).`);
  return join(runsRoot(), runId);
}
