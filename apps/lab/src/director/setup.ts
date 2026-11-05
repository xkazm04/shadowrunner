// `pnpm lab setup`: the voice sidecar's venv (tools/lab-voice/.venv, Python 3.12 via uv, falling
// back to `py -3.12 -m venv` + pip) and the Kokoro model files in var/lab/models/. Idempotent:
// existing files are kept.
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { MODELS_DIR, VOICE_DIR, VOICE_PYTHON, VOICE_VENV } from "./paths.js";

/** kokoro-onnx model files (MIT code, Apache-2.0 Kokoro-82M weights); the v1.1 export has durations. */
export const MODEL_FILES = [
  { name: "kokoro-v1.0.onnx", url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx" },
  { name: "voices-v1.0.bin", url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin" },
];

function has(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore", shell: false }).status === 0;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: VOICE_DIR, stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`\`${command} ${args.join(" ")}\` exited ${result.status ?? "by signal"}.`);
}

function setupVenv(log: (line: string) => void): void {
  const requirements = join(VOICE_DIR, "requirements.txt");
  if (has("uv", ["--version"])) {
    if (!existsSync(VOICE_PYTHON)) run("uv", ["venv", VOICE_VENV, "--python", "3.12"]);
    run("uv", ["pip", "install", "--python", VOICE_PYTHON, "-r", requirements]);
  } else {
    log("setup: uv not found; using the system Python 3.12 and pip");
    if (!existsSync(VOICE_PYTHON)) {
      if (process.platform === "win32") run("py", ["-3.12", "-m", "venv", VOICE_VENV]);
      else run("python3.12", ["-m", "venv", VOICE_VENV]);
    }
    run(VOICE_PYTHON, ["-m", "pip", "install", "-r", requirements]);
  }
}

async function download(url: string, target: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || res.body === null) throw new Error(`Downloading ${url} answered HTTP ${res.status}.`);
  const part = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), createWriteStream(part));
    renameSync(part, target);
  } catch (error) {
    rmSync(part, { force: true });
    throw error;
  }
}

export async function setup(log: (line: string) => void): Promise<void> {
  log(`setup: voice venv at ${VOICE_VENV}`);
  setupVenv(log);
  mkdirSync(MODELS_DIR, { recursive: true });
  for (const file of MODEL_FILES) {
    const target = join(MODELS_DIR, file.name);
    if (existsSync(target)) {
      log(`setup: ${file.name} present`);
      continue;
    }
    log(`setup: downloading ${file.name}`);
    await download(file.url, target);
  }
  log("setup: done. Check it with: tools/lab-voice/.venv python -m unittest (from tools/lab-voice).");
}
