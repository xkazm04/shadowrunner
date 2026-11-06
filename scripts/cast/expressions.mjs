// Expression faces for recorded characters (character-control design.md "Expressions", task 3):
//   node scripts/cast/expressions.mjs <slug> [--families a,b] [--request|--import] [--force] [--root <dir>]
// --request  writes var/cast-expr/<slug>/<family>.request.txt (the prompt, `expressionPrompt`, plus
//            where to save the result) and a copy of the portrait, and prints the Codex commands:
//              cd var/cast-expr/<slug> && codex exec --skip-git-repo-check --ephemeral \
//                --dangerously-bypass-approvals-and-sandbox -i portrait.png -C . - < <family>.request.txt
//            (the fill-edit recipe of docs/cast-forge-ledger.md "Tooling"; about 50 s per image)
// --import   reads var/cast-expr/<slug>/<family>.png, area-resizes it to the portrait's size, runs
//            `cutVariants` and writes the patches (`<layer>.<family>.png`) beside the layer files and
//            the `variants` into job.json (its own line ending, key order kept, new keys appended). A
//            family whose drift is over EXPRESSION_DRIFT_LIMIT is refused unless --force.
// `malakor`: his replay job as above, and his imported rig (assets/characters/malakor/rig/): patches
//            in expressions/ there and a `variants.json` sidecar ({ <layer>: { <family>: LayerPatch } },
//            files relative to the rig folder) that the seed merges into the rig. Same portrait, one edit.
// face-control: `--ink-brows` writes `<family>.ink.request.txt` (the prompt plus INK_BROWS) for a brows-only
// re-cut (face-lib.mjs CAST_EYES `brows`); `--attempt N` writes a stricter re-run (`<family>.aN.request.txt` -> `<family>.aN.png`);
// for the socketed four (face-lib.mjs CAST_EYES) --import is expressions-socketed.mjs (stability gate,
// brow+lid band, sockets; `--measure` prints the numbers only). Run eyes.mjs --import first.
// With neither flag it lists, per family, whether a request and an edit exist. No network, no model.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { readJsonFile, writeJsonFile } from "../forge-lib.mjs";
import { importSocketed } from "./expressions-socketed.mjs";
import { CAST_EYES } from "./face-lib.mjs";
import { resize } from "./measure.mjs";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const root = option("--root") ?? ".";
const slug = args.find((a, i) => !a.startsWith("--") && !["--root", "--families", "--attempt"].includes(args[i - 1]));
if (slug === undefined) throw new Error("usage: node scripts/cast/expressions.mjs <slug> [--families a,b] [--request|--import] [--force] [--root <dir>]");

const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const { module: rigCore } = await runnerImport("/packages/rig/src/index.ts");
const families = (option("--families") ?? rigCore.EXPRESSION_FAMILIES.join(",")).split(",").map((f) => f.trim());
for (const f of families) if (!rigCore.EXPRESSION_FAMILIES.includes(f)) throw new Error(`expressions: unknown family ${f}`);

const JOB_DIR = join(root, "assets", "replay", "forge", slug);
const MALAKOR_RIG = join(root, "assets", "characters", "malakor", "rig");
const WORK = join(root, "var", "cast-expr", slug);
const isMalakor = slug === "malakor";
if (!existsSync(join(JOB_DIR, "job.json")) && !isMalakor) throw new Error(`expressions: no recorded job ${slug}`);

function decode(path) {
  const decoded = forge.decodeImage(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) throw new Error(`expressions: ${path}: ${decoded.errors.message}`);
  return decoded.value;
}

const job = existsSync(join(JOB_DIR, "job.json")) ? readJsonFile(join(JOB_DIR, "job.json")) : undefined;
const portraitPath = job === undefined ? join(MALAKOR_RIG, "portrait.png") : join(JOB_DIR, job.value.portrait);
const portraitName = `portrait.${portraitPath.endsWith(".jpg") ? "jpg" : "png"}`;
const briefPath = join(root, "assets", "characters", "cast", slug, "brief.json");
const style = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, "utf8")).style?.name : undefined;
const name = job?.value.name ?? "Arch-Lich Malakor";

/** face-control: attempt 0 writes `<family>.png`; a re-run of a refused face (--attempt N) `<family>.aN.png`, with the stricter prompt. */
const attempt = Number(option("--attempt") ?? 0);

function request() {
  mkdirSync(WORK, { recursive: true });
  copyFileSync(portraitPath, join(WORK, portraitName));
  for (const family of families) {
    const inkBrows = args.includes("--ink-brows");
    const prompt = `${forge.expressionPrompt(name, family, style, attempt)}${inkBrows ? ` ${forge.INK_BROWS}` : ""}`;
    const out = inkBrows ? `${family}.ink` : attempt === 0 ? family : `${family}.a${attempt}`;
    const text = `Use your image generation tool to EDIT the attached input image ./${portraitName} (pass it to the tool as the input/reference image). Prompt, verbatim: "${prompt}"\nThen save the result as ${out}.png in this folder and verify the copy. Report whether the tool actually received the input image (yes/no) and the output pixel size.\n`;
    writeFileSync(join(WORK, `${out}.request.txt`), text);
    console.log(`cd ${WORK.replaceAll("\\", "/")} && codex exec --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox -i ${portraitName} -C . - < ${out}.request.txt`);
  }
}

/** The layer images `cutVariants` reads, from `dir`. */
function layersIn(dir, rig) {
  const out = new Map();
  for (const layer of rig.layers) if (existsSync(join(dir, layer.file))) out.set(layer.name, decode(join(dir, layer.file)));
  return out;
}

/** Cuts one family against `rig` (layer files in `dir`), writes the patches into `outDir`; layer -> patch, or undefined when refused. */
function cutInto(rig, dir, portrait, edited, family, outDir, prefix) {
  const cut = forge.cutVariants(rig, layersIn(dir, rig), portrait, edited, family);
  const names = Object.keys(cut.patches);
  console.log(`expressions: ${slug} ${family} (${rig.id}): drift ${cut.drift.toFixed(1)}/255${cut.flagged ? " FLAGGED" : ""}, patches ${names.join(", ") || "none"}`);
  if ((cut.flagged && !args.includes("--force")) || names.length === 0) return undefined;
  mkdirSync(outDir, { recursive: true });
  const patches = {};
  for (const layerName of names) {
    const { patch, image } = cut.patches[layerName];
    writeFileSync(join(outDir, patch.file), forge.encodePng(image));
    patches[layerName] = { ...patch, file: prefix + patch.file };
  }
  return patches;
}

function malakorRig() {
  const layers = JSON.parse(readFileSync(join(MALAKOR_RIG, "layers.json"), "utf8"));
  const spec = JSON.parse(readFileSync(join(MALAKOR_RIG, "m8.spec.json"), "utf8"));
  const imported = rigCore.importLegacyLayers(layers, spec);
  if (!imported.ok) throw new Error(`expressions: Malakor does not import: ${imported.errors.map((e) => e.message).join("; ")}`);
  return imported.value.rig;
}

function importEdits() {
  const portrait = decode(portraitPath);
  const sidecarPath = join(MALAKOR_RIG, "variants.json");
  const sidecar = isMalakor && existsSync(sidecarPath) ? readJsonFile(sidecarPath) : { value: {}, eol: "\n", trailing: true };
  const ownRig = isMalakor ? malakorRig() : undefined;
  let changed = false;
  for (const family of families) {
    const source = join(WORK, `${family}.png`);
    if (!existsSync(source)) {
      console.log(`expressions: ${slug} ${family}: no ${source}, skipped`);
      continue;
    }
    const edited = resize(decode(source), portrait.width, portrait.height);
    if (job !== undefined) {
      const patches = cutInto(job.value.rig, JOB_DIR, portrait, edited, family, JOB_DIR, "");
      for (const layer of job.value.rig.layers) {
        if (patches?.[layer.name] !== undefined) layer.variants = { ...layer.variants, [family]: patches[layer.name] };
      }
      changed ||= patches !== undefined;
    }
    if (ownRig !== undefined) {
      const patches = cutInto(ownRig, MALAKOR_RIG, portrait, edited, family, join(MALAKOR_RIG, "expressions"), "expressions/");
      for (const [layerName, patch] of Object.entries(patches ?? {})) sidecar.value[layerName] = { ...sidecar.value[layerName], [family]: patch };
    }
  }
  if (job !== undefined && changed) writeJsonFile(join(JOB_DIR, "job.json"), job.value, job);
  if (ownRig !== undefined) writeJsonFile(sidecarPath, sidecar.value, sidecar);
}

if (args.includes("--request")) request();
else if (args.includes("--import") && CAST_EYES[slug] !== undefined) await importSocketed({ forge, slug, families, work: WORK, force: args.includes("--force"), measure: args.includes("--measure") });
else if (args.includes("--import")) importEdits();
else for (const family of families) console.log(`${family}: request ${existsSync(join(WORK, `${family}.request.txt`)) ? "yes" : "no"}, edit ${existsSync(join(WORK, `${family}.png`)) ? "yes" : "no"}`);
