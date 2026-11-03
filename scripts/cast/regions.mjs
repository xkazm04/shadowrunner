// Colour regions for recorded characters (character-control design.md "Regions", task 3):
//   node scripts/cast/regions.mjs <slug|--all> [--root <dir>]
// For a replay job (assets/replay/forge/<slug>/): every layer's `<layer>.regions.png` beside its
// layer file and `regions` on the layer in job.json (its own line ending, key order kept, the new key
// appended). For `malakor` also his imported rig (assets/characters/malakor/rig/): the maps there and
// a `regions.json` sidecar ({ <layer>: LayerRegions }) that the seed merges into the rig.
// `--all`: every replay job, then Malakor's rig. `--root` points at a copy of the repo's assets/
// (tests and dry runs); the default is the repo. No network, no model: `regionsForRig` only. A jaw's
// cavity slot is inferred from its pixels (the painted mask is not recoverable from a committed rig).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { readJsonFile, writeJsonFile } from "../forge-lib.mjs";

const args = process.argv.slice(2);
const rootAt = args.indexOf("--root");
const root = rootAt >= 0 ? args[rootAt + 1] : ".";
const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root") ?? (args.includes("--all") ? "--all" : undefined);
if (target === undefined || root === undefined) throw new Error("usage: node scripts/cast/regions.mjs <slug|--all> [--root <dir>]");

const REPLAY = join(root, "assets", "replay", "forge");
const MALAKOR_RIG = join(root, "assets", "characters", "malakor", "rig");
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const { module: rigCore } = await runnerImport("/packages/rig/src/index.ts");

function decode(path) {
  const decoded = forge.decodeImage(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) throw new Error(`regions: ${path}: ${decoded.errors.message}`);
  return decoded.value;
}

/** Regions for `rig` with layer files in `dir`: writes the maps, returns layer -> LayerRegions and the bytes written. */
function regionsIn(dir, rig) {
  const images = new Map();
  for (const layer of rig.layers) if (existsSync(join(dir, layer.file))) images.set(layer.name, decode(join(dir, layer.file)));
  const found = forge.regionsForRig(rig, images);
  let bytes = 0;
  for (const [file, png] of Object.entries(found.files)) {
    writeFileSync(join(dir, file), png);
    bytes += png.length;
  }
  const byLayer = Object.fromEntries(found.rig.layers.flatMap((l) => (l.regions === undefined ? [] : [[l.name, l.regions]])));
  return { byLayer, bytes, files: Object.keys(found.files).length };
}

function replayJob(slug) {
  const dir = join(REPLAY, slug);
  const path = join(dir, "job.json");
  const { value: job, eol, trailing } = readJsonFile(path);
  const { byLayer, bytes, files } = regionsIn(dir, job.rig);
  for (const layer of job.rig.layers) {
    if (byLayer[layer.name] !== undefined) layer.regions = byLayer[layer.name];
    else delete layer.regions;
  }
  writeJsonFile(path, job, { eol, trailing });
  console.log(`regions: ${slug}: ${files} maps, ${(bytes / 1024).toFixed(0)} KB (${Object.entries(byLayer).map(([l, r]) => `${l}:${r.slots.map((s) => s.id).join("/")}`).join(" ")})`);
}

function malakorRig() {
  const layers = JSON.parse(readFileSync(join(MALAKOR_RIG, "layers.json"), "utf8"));
  const spec = JSON.parse(readFileSync(join(MALAKOR_RIG, "m8.spec.json"), "utf8"));
  const imported = rigCore.importLegacyLayers(layers, spec);
  if (!imported.ok) throw new Error(`regions: Malakor does not import: ${imported.errors.map((e) => e.message).join("; ")}`);
  const { byLayer, bytes, files } = regionsIn(MALAKOR_RIG, imported.value.rig);
  const sidecar = join(MALAKOR_RIG, "regions.json");
  writeJsonFile(sidecar, byLayer, existsSync(sidecar) ? readJsonFile(sidecar) : {});
  console.log(`regions: malakor rig: ${files} maps, ${(bytes / 1024).toFixed(0)} KB, regions.json`);
}

const slugs = target === "--all" ? readdirSync(REPLAY).filter((d) => existsSync(join(REPLAY, d, "job.json"))).sort() : [target];
for (const slug of slugs) {
  if (existsSync(join(REPLAY, slug, "job.json"))) replayJob(slug);
  else if (slug !== "malakor") throw new Error(`regions: no recorded job ${slug}`);
}
if (target === "--all" || target === "malakor") malakorRig();
