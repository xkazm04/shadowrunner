// Cast packs (avatar-pack design "Cast packs", requirement 5): one .srpack per recorded cast
// character, written at build time, never committed.
//   node scripts/build-packs.mjs
// For each assets/replay/forge/<slug>/job.json except `malakor` (pre-existing art, never packed):
// the rig (must validate and be fictional), every image it references that exists in the folder (a
// missing layer image fails the build; missing region maps and expression faces are fine), look
// `defaultLook(rig)`, voice `castVoice(rig.id) ?? "crypt"`. Writes apps/web/public/packs/<slug>.srpack
// and apps/web/public/packs/index.json. Fixed dates, so two runs write the same bytes.
// companion-lanes (requirement 5.2): also every assets/replay/companions/<slug>/job.json (Iris, Bun),
// by the same rules, into the same folder and index. A rig with `morph` must also carry the files it
// names (`pack.rigFiles` lists morph.atlas, morph.flow and morph.sway.map). The companions are not
// in the Halloween cast: their voices come from COMPANION_VOICES below, never from CAST_VOICES.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runnerImport } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["malakor"]);
const STAMP = "2026-11-04T00:00:00.000Z";

/**
 * Companion voices, from the fixed list (packages/engine/src/voices.ts): Iris, a calm realistic
 * companion, speaks in `velvet` ("warm and close"); Bun, a lively anime streamer, in `choir`
 * ("airy and distant", the brightest of the five).
 */
export const COMPANION_VOICES = { iris: "velvet", bun: "choir" };

async function modules() {
  const config = { configFile: false, root: ROOT, logLevel: "warn" };
  const [{ module: pack }, { module: rig }, { module: engine }] = await Promise.all([
    runnerImport("/packages/pack/src/index.ts", config),
    runnerImport("/packages/rig/src/index.ts", config),
    runnerImport("/packages/engine/src/index.ts", config),
  ]);
  return { pack, rig, engine };
}

/** The job folders under `root` (each with a job.json), by slug, `SKIP` left out. */
function jobDirs(root) {
  if (root === undefined || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIP.has(entry.name) && existsSync(join(root, entry.name, "job.json")))
    .map((entry) => ({ slug: entry.name, dir: join(root, entry.name) }));
}

/**
 * Writes `<outDir>/<slug>.srpack` for every cast job in `forgeDir` and every companion job in
 * `companionsDir` (optional), and `<outDir>/index.json` (`[{ id, name, file, bytes }]` sorted by id).
 * `outDir` is emptied first. Returns the index.
 */
export async function buildPacks(forgeDir, outDir, companionsDir) {
  const { pack, rig: rigCore, engine } = await modules();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const cast = jobDirs(forgeDir).map((job) => ({ ...job, companion: false }));
  const companions = jobDirs(companionsDir).map((job) => ({ ...job, companion: true }));
  const jobs = [...cast, ...companions].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (let i = 1; i < jobs.length; i += 1) {
    if (jobs[i].slug === jobs[i - 1].slug) throw new Error(`build-packs: ${jobs[i].slug}: a cast job and a companion job share the slug`);
  }

  const index = [];
  for (const { slug, dir, companion } of jobs) {
    const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
    const checked = rigCore.validateRig(job.rig);
    if (!checked.ok) throw new Error(`build-packs: ${slug}: the rig does not validate: ${checked.errors[0]?.message ?? "unknown"}`);
    const rig = checked.value;
    if (rig.fictional !== true) throw new Error(`build-packs: ${slug}: the rig is not fictional`);
    const layerFiles = new Set(rig.layers.map((layer) => layer.file));
    const morphFiles = new Set([rig.morph?.atlas, rig.morph?.flow, rig.morph?.sway?.map].filter((file) => file !== undefined));
    const files = {};
    for (const name of pack.rigFiles(rig)) {
      const path = join(dir, name);
      if (existsSync(path)) files[name] = new Uint8Array(readFileSync(path));
      else if (layerFiles.has(name)) throw new Error(`build-packs: ${slug}: missing the layer image ${name}`);
      else if (morphFiles.has(name)) throw new Error(`build-packs: ${slug}: missing the morph image ${name}`);
    }
    for (const name of morphFiles) if (files[name] === undefined) throw new Error(`build-packs: ${slug}: the pack's file list leaves out the morph image ${name}`);
    const bytes = await pack.writePack({
      rig,
      look: rigCore.defaultLook(rig),
      voice: (companion ? COMPANION_VOICES[slug] : engine.castVoice(rig.id)) ?? "crypt",
      files,
      licence: "all-rights-reserved",
      author: companion ? "Shadowrunner companions" : "Shadowrunner cast",
      createdAt: STAMP,
      exportedAt: STAMP,
    });
    const file = `${slug}${pack.PACK_EXTENSION}`;
    writeFileSync(join(outDir, file), bytes);
    index.push({ id: rig.id, name: rig.name, file, bytes: bytes.length });
  }
  index.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  writeFileSync(join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = await buildPacks(join(ROOT, "assets", "replay", "forge"), join(ROOT, "apps", "web", "public", "packs"), join(ROOT, "assets", "replay", "companions"));
  const total = index.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`build-packs: ${index.length} packs, ${(total / 1024 / 1024).toFixed(1)} MB -> apps/web/public/packs/`);
}
