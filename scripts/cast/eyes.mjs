// Socketed eyes for recorded cast characters (face-control, WP-B):
//   node scripts/cast/eyes.mjs <slug> [--request | --import] [--dry]
// --request  writes var/cast-eyes/<slug>/: iris-free.request.txt (`irisFreePrompt`: the whites painted
//            where the irises are), closed.request.txt (`closedEyesPrompt`: the closed lids) and, for
//            white and dark eyes, eye-marks.request.txt (a mask edit: openings green, irises magenta),
//            a copy of the portrait, and prints the Codex commands (about 50-90 s each):
//              cd var/cast-eyes/<slug> && codex exec --skip-git-repo-check --ephemeral \
//                --dangerously-bypass-approvals-and-sandbox -i portrait.png -C . - < iris-free.request.txt
// --import   `socketEyes` on the recorded rig: each eye layer's file becomes the iris-free eye, with
//            `<eye>.socket.png` (lid opening) and `<eye>.closed.png` (closed lids), and an iris layer
//            `iris_<side>.png` follows it. The edits are area-resized to the portrait: iris-free.png
//            (white eyes take their whites from it; every eye's opening), eye-marks.png (openings and
//            irises), closed.png (the closed-lid art, else the plate). The old expression faces are
//            retired (variants dropped, files kept in the backup): expressions.mjs regenerates them.
// The first run backs up job.json and every file it replaces or retires in var/cast-eyes/<slug>/orig/;
// every run starts from that backup, so it can be re-run. Then re-run, in order:
//   expressions.mjs <slug> --import, regions.mjs <slug>, mouth-backfill.mjs --slug <slug> --reset-expressions,
//   mouth-backfill.mjs --slug <slug> --lips, and node scripts/build-packs.mjs.
// No network, no model.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { writeJsonFile } from "../forge-lib.mjs";
import { CAST_EYES, jobDir, origDir, socketing, workDir } from "./face-lib.mjs";

/** The mask edits (cast only, never shipped): the opening green, the iris magenta (`markOf`); a dark eye's eyeball green. */
const MARKS_WHITE =
  "Edit this image into a mask for an animator. In both eyes, paint everything visible between the upper and lower eyelids (the white of the eye, the iris and the pupil) solid flat pure green #00FF00, then paint each iris together with its pupil solid flat pure magenta #FF00FF on top of the green, as a full disc where it is visible. Do not paint the eyelids, lashes, lid lines or the skin. Keep every other pixel of the image exactly as it is, the same size and framing.";
const MARKS_DARK =
  "Edit this image into a mask for an animator. In both eyes, paint everything visible between the eyelids (the whole dark eyeball with its gold sheen and highlight) solid flat pure green #00FF00. Do not paint the eyelids, the gold lid rims, lid lines or the fur. Keep every other pixel of the image exactly as it is, the same size and framing.";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
if (slug === undefined || CAST_EYES[slug] === undefined) throw new Error(`usage: node scripts/cast/eyes.mjs <${Object.keys(CAST_EYES).join("|")}> [--request | --import] [--dry]`);
const dry = args.includes("--dry");

const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const JOB_DIR = jobDir(slug);
const WORK = workDir(slug);
const ORIG = origDir(slug);

/** The first run backs up the recorded job, its eye files and its faces (var/cast-eyes/<slug>/orig/). */
function backup() {
  if (!existsSync(join(ORIG, "job.json"))) {
    mkdirSync(ORIG, { recursive: true });
    copyFileSync(join(JOB_DIR, "job.json"), join(ORIG, "job.json"));
    const job = JSON.parse(readFileSync(join(JOB_DIR, "job.json"), "utf8"));
    for (const layer of job.rig.layers) {
      if (layer.kind === "eye") copyFileSync(join(JOB_DIR, layer.file), join(ORIG, layer.file));
      for (const patch of Object.values(layer.variants ?? {})) if (existsSync(join(JOB_DIR, patch.file))) copyFileSync(join(JOB_DIR, patch.file), join(ORIG, patch.file));
    }
  }
}

function request() {
  const job = JSON.parse(readFileSync(join(JOB_DIR, "job.json"), "utf8"));
  const briefPath = join("assets", "characters", "cast", slug, "brief.json");
  const style = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, "utf8")).style?.name : undefined;
  mkdirSync(WORK, { recursive: true });
  const portraitName = `portrait.${job.portrait.split(".").pop()}`;
  copyFileSync(join(JOB_DIR, job.portrait), join(WORK, portraitName));
  const { look } = CAST_EYES[slug];
  const edits = {
    "iris-free": forge.irisFreePrompt(job.name, style),
    closed: forge.closedEyesPrompt(job.name),
    ...(look === "glow" ? {} : { "eye-marks": look === "dark" ? MARKS_DARK : MARKS_WHITE }),
  };
  for (const [out, prompt] of Object.entries(edits)) {
    const text = `Use your image generation tool to EDIT the attached input image ./${portraitName} (pass it to the tool as the input/reference image). Prompt, verbatim: "${prompt}"\nThen save the result as ${out}.png in this folder and verify the copy. Report whether the tool actually received the input image (yes/no) and the output pixel size.\n`;
    writeFileSync(join(WORK, `${out}.request.txt`), text);
    console.log(`cd ${WORK.replaceAll("\\", "/")} && codex exec --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox -i ${portraitName} -C . - < ${out}.request.txt`);
  }
}

function importEyes() {
  backup();
  const { orig, out } = socketing(forge, slug);
  for (const note of out.notes) console.log(`eyes: ${slug}: ${note}`);
  // The old faces are retired: expressions.mjs regenerates them against the iris-free eyes.
  const retired = [];
  const layers = out.rig.layers.map((layer) => {
    if (layer.variants === undefined) return layer;
    retired.push(...Object.values(layer.variants).map((p) => p.file));
    const rest = { ...layer };
    delete rest.variants;
    return rest;
  });
  const job = { ...orig.value, rig: { ...out.rig, layers } };
  if (dry) return console.log(`eyes: ${slug}: --dry, nothing written (${Object.keys(out.files).length} files, ${retired.length} faces would retire)`);
  for (const [file, image] of Object.entries(out.files)) writeFileSync(join(JOB_DIR, file), forge.encodePng(image));
  for (const file of retired) rmSync(join(JOB_DIR, file), { force: true });
  writeJsonFile(join(JOB_DIR, "job.json"), job, orig);
  console.log(`eyes: ${slug}: wrote ${Object.keys(out.files).join(", ")}; retired ${retired.length} faces; job.json`);
}

if (args.includes("--request")) request();
else if (args.includes("--import")) importEyes();
else console.log(`eyes: ${slug}: ${CAST_EYES[slug].look} eyes; edit ${existsSync(join(WORK, "iris-free.png")) ? "yes" : "no"}; backup ${existsSync(join(ORIG, "job.json")) ? "yes" : "no"}`);
