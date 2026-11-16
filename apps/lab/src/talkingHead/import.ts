// `pnpm lab th-import <th run dir>`: turns a tools/talking-head run (run.json schema "th-run/1",
// .kiro/specs/talking-head) into a lab run folder, so measure and board treat it like any other
// external run. config.external is "talking-head"; the arm, script and seed come from run.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, runDir } from "../director/paths.js";

export type Roi = readonly [number, number, number, number];

export interface ThRun {
  arm: string;
  script: string;
  seed: number;
  durationS: number;
  /** Mouth region in video.mp4 pixels, or null when no face was found. */
  faceRoi: Roi | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRoi(v: unknown): v is Roi {
  return Array.isArray(v) && v.length === 4 && v.every((n) => Number.isInteger(n) && n >= 0);
}

/** Reads the fields the lab needs from a th-run/1 run.json; throws on anything else. */
export function readThRun(text: string): ThRun {
  const v: unknown = JSON.parse(text);
  if (!isRecord(v) || v.schema !== "th-run/1") throw new Error('run.json: schema must be "th-run/1".');
  const { arm, script, seed, durationS, faceRoi } = v;
  if (typeof arm !== "string" || !/^[a-z0-9-]+$/.test(arm)) throw new Error("run.json: arm must be an arm id.");
  if (typeof script !== "string" || !/^[a-z0-9-]+$/.test(script)) throw new Error("run.json: script must be a script id.");
  if (typeof seed !== "number" || !Number.isFinite(seed)) throw new Error("run.json: seed must be a number.");
  if (typeof durationS !== "number" || !(durationS > 0)) throw new Error("run.json: durationS must be positive.");
  if (faceRoi !== null && !isRoi(faceRoi)) throw new Error("run.json: faceRoi must be [x,y,w,h] or null.");
  return { arm, script, seed, durationS, faceRoi };
}

/** The lab run id, config and timeline for one talking-head run. */
export function labRunFor(th: ThRun, scriptText: string, stamp: string): { runId: string; config: Record<string, unknown>; timeline: string } {
  const runId = `${stamp}-${th.script}-th-${th.arm}-s${th.seed}`;
  const config = {
    external: "talking-head",
    scenario: th.script,
    seed: th.seed,
    thArm: th.arm,
    note: `talking-head arm ${th.arm}: offline render of script ${th.script} (${th.durationS.toFixed(1)} s); no chat, one spoken line from t=0.`,
  };
  const timeline = `${JSON.stringify({ t: 0, kind: "say", id: "say-1", text: scriptText.trim() })}\n`;
  return { runId, config, timeline };
}

export function measureHint(dir: string, roi: Roi | null): string {
  const file = join(dir, "run.mp4");
  return roi === null
    ? `no faceRoi in run.json: measure needs --roi x,y,w,h for ${file}`
    : `measure it: pnpm lab measure ${file} --roi ${roi.join(",")}`;
}

export async function thImportCommand(argv: readonly string[], log: (line: string) => void): Promise<void> {
  const src = argv[0];
  if (src === undefined || argv.length > 1) throw new Error("usage: pnpm lab th-import <talking-head run dir>");
  const from = resolve(src);
  const runJson = join(from, "run.json");
  const video = join(from, "video.mp4");
  if (!existsSync(runJson) || !existsSync(video)) throw new Error(`${from} has no run.json and video.mp4 (a th render output dir).`);
  const th = readThRun(readFileSync(runJson, "utf8"));
  const scriptFile = join(REPO_ROOT, "tools", "talking-head", "scripts", `${th.script}.txt`);
  const scriptText = existsSync(scriptFile) ? readFileSync(scriptFile, "utf8") : th.script;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const { runId, config, timeline } = labRunFor(th, scriptText, stamp);
  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  copyFileSync(video, join(dir, "run.mp4"));
  copyFileSync(runJson, join(dir, "th-run.json"));
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(dir, "timeline.jsonl"), timeline);
  log(`th-import ${runId}: ${dir}`);
  log(measureHint(dir, th.faceRoi));
}
