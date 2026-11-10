// The lip-sync fit in one command (perfection-pass task 14; README.md here):
//   node scripts/lipfit/fit.mjs [--corpus <corpus.jsonl>] [--fresh] [--no-judge]
// 1. corpus: speaks scripts/lipfit/sentences.jsonl through the Avatar Lab's Kokoro sidecar
//    (tools/lab-voice, `pnpm lab setup`) into var/lipfit/corpus.jsonl, unless that file exists
//    (--fresh speaks it again) or --corpus names another one (the archived original, say);
// 2. train.ts: the classifier, written to packages/avatar/src/speech/weights.ts;
// 3. judge.ts: the held-out-voice scores quoted in speech/analyse.ts.
// The corpus' sha256 is printed: the shipped weights come from 1f401a6b... (see README.md).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SENTENCES = join(HERE, "sentences.jsonl");
const VOICE_DIR = join(ROOT, "tools", "lab-voice");
const PYTHON = process.env.SR_LAB_PYTHON ?? join(VOICE_DIR, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const MODELS = process.env.SR_LAB_MODELS ?? join(ROOT, "var", "lab", "models");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const named = args.indexOf("--corpus");
const corpus = named >= 0 ? resolve(args[named + 1] ?? "") : join(ROOT, "var", "lipfit", "corpus.jsonl");

/** Speaks every sentence through the sidecar, its stdout (one JSON line per clip) into `out`. */
async function speak(out) {
  if (!existsSync(PYTHON)) throw new Error(`no voice sidecar at ${PYTHON}: run \`pnpm lab setup\` (or set SR_LAB_PYTHON)`);
  mkdirSync(dirname(out), { recursive: true });
  const want = readFileSync(SENTENCES, "utf8").trim().split("\n").length;
  console.log(`corpus: speaking ${want} sentences with Kokoro (a few minutes on CPU) -> ${out}`);
  const child = spawn(PYTHON, ["-m", "lab_voice.server", "--models", MODELS], { cwd: VOICE_DIR, stdio: ["pipe", "pipe", "inherit"] });
  const file = createWriteStream(out);
  child.stdout.pipe(file);
  child.stdin.end(readFileSync(SENTENCES));
  const [code] = await Promise.all([new Promise((done) => child.on("close", done)), finished(file)]);
  if (code !== 0) throw new Error(`the voice sidecar exited ${code}`);
  const lines = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const failed = lines.filter((l) => l.error !== undefined);
  const spoken = lines.filter((l) => l.pcmBase64 !== undefined).length;
  if (failed.length > 0 || spoken !== want) throw new Error(`corpus: ${spoken}/${want} spoken, ${failed.length} failed (${failed[0]?.error ?? ""})`);
}

function step(script) {
  const run = spawnSync(process.execPath, ["--import", "./apps/lab/src/hooks.mjs", join("scripts", "lipfit", script), corpus, SENTENCES], { cwd: ROOT, stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

if (named < 0 && (flag("--fresh") || !existsSync(corpus))) await speak(corpus);
if (!existsSync(corpus)) throw new Error(`no corpus at ${corpus}`);
console.log("corpus", corpus, "sha256", createHash("sha256").update(readFileSync(corpus)).digest("hex"));
step("train.ts");
if (!flag("--no-judge")) step("judge.ts");
