// Shared by the offline forge tools (scripts/forge-replay.mjs, scripts/cast-forge.mjs): load the
// real pipeline modules, run plate -> cut -> assemble, write a replay job folder with the size
// cap, and lay review panels side by side. No network, no key.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";

export const OUT = join("assets", "replay", "forge");
/** Per file. The background is the whole plate as a lossless PNG since task 9 (about 0.7-1.5 MB). */
export const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

/** The modules the server runs: @sr/forge, the API's forge steps (`plateFor`) and @sr/rig. */
export async function loadPipeline() {
  const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
  const { module: steps } = await runnerImport("/api/_lib/forge-steps.ts");
  const { module: rigCore } = await runnerImport("/packages/rig/src/index.ts");
  return { forge, steps, rigCore };
}

export function readImage(forge, path) {
  const decoded = forge.decodeImage(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) throw new Error(`${path}: ${decoded.errors.message}`);
  return decoded.value;
}

/**
 * The real pipeline on recorded inputs. v1 `parts` go through the server's `plateFor`, `cutAll`
 * and `assembleRig`; v2 `named` parts through `liftedNamed` + `composePlate` (the edit, else the
 * pure `fallbackFill`), `cutNamed` and `assembleRig`. Throws when the rig is invalid.
 */
export function runPipeline({ forge, steps }, { portrait, parts, named, edit, id, name }) {
  const started = performance.now();
  let plate;
  let cut;
  if (named !== undefined) {
    const lifted = forge.liftedNamed(named, portrait.width, portrait.height);
    plate = forge.composePlate(portrait, edit ?? forge.fallbackFill(portrait, lifted), lifted);
    cut = forge.cutNamed(portrait, named, { plate });
  } else {
    plate = steps.plateFor(portrait, parts, edit);
    cut = forge.cutAll(portrait, parts, { plate });
  }
  const assembled = forge.assembleRig(named ?? parts, cut.layers, { id, name, portrait, plate });
  const cutMs = Math.round(performance.now() - started);
  if (!assembled.ok) throw new Error(`${id}: rig invalid: ${assembled.errors.map((e) => `${e.code} ${e.path ?? ""}`).join(", ")}`);
  return { plate, cut, assembled: assembled.value, cutMs };
}

/** Replay latency per status, 1.5-3 s (requirement 7.5), scaled from the recorded step it stands for. */
export const hold = (ms) => Math.round(Math.min(3000, Math.max(1500, (ms ?? 0) / 8)));

export const stepsOf = (timings) => [
  { status: "queued", holdMs: 1500 },
  { status: "portrait", holdMs: hold(timings.portraitMs) },
  { status: "segmenting", holdMs: hold(timings.partsMs) },
  { status: "cutting", holdMs: hold(timings.fillMs) },
  { status: "filling", holdMs: hold(timings.cutMs) },
  { status: "done" },
];

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * assets/replay/forge/<slug>/: the portrait as given, every layer PNG and job.json (`job` gets
 * `portrait` set). Throws when a file is over MAX_FILE_BYTES. Returns the total bytes written.
 */
export function writeReplayJob(forge, slug, portraitBytes, files, job) {
  const dir = join(OUT, slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const portraitFile = `portrait.${forge.sniffImage(portraitBytes) === "png" ? "png" : "jpg"}`;
  writeFileSync(join(dir, portraitFile), portraitBytes);
  const sizes = { [portraitFile]: portraitBytes.length };
  for (const [file, png] of Object.entries(files)) {
    writeFileSync(join(dir, file), png);
    sizes[file] = png.length;
  }
  const over = Object.entries(sizes).filter(([, n]) => n > MAX_FILE_BYTES);
  if (over.length > 0) throw new Error(`${slug}: files over ${MAX_FILE_BYTES} bytes: ${over.map(([f]) => f).join(", ")}`);
  const ordered = { slug: job.slug, name: job.name, fictional: true, source: job.source, prompt: job.prompt, promptSha256: sha256(job.prompt), portrait: portraitFile, ...job };
  writeFileSync(join(dir, "job.json"), `${JSON.stringify(ordered, null, 2)}\n`);
  return Object.values(sizes).reduce((a, b) => a + b, 0);
}

/** Same-size panels left to right in one image. */
export function sideBySide(panels) {
  const { width, height } = panels[0];
  const data = new Uint8ClampedArray(width * panels.length * height * 4);
  panels.forEach((p, k) => {
    for (let y = 0; y < height; y++) data.set(p.data.subarray(y * width * 4, (y + 1) * width * 4), (y * width * panels.length + k * width) * 4);
  });
  return { width: width * panels.length, height, data };
}

/** Decoded layer pixels by file name. */
export const imagesOf = (forge, files) => Object.fromEntries(Object.entries(files).map(([file, png]) => [file, forge.decodeImage(png).value]));
