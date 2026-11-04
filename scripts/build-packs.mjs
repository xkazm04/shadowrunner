// Cast packs (avatar-pack design "Cast packs", requirement 5): one .srpack per recorded cast
// character, written at build time, never committed.
//   node scripts/build-packs.mjs
// For each assets/replay/forge/<slug>/job.json except `malakor` (pre-existing art, never packed):
// the rig (must validate and be fictional), every image it references that exists in the folder (a
// missing layer image fails the build; missing region maps and expression faces are fine), look
// `defaultLook(rig)`, voice `castVoice(rig.id) ?? "crypt"`. Writes apps/web/public/packs/<slug>.srpack
// and apps/web/public/packs/index.json. Fixed dates, so two runs write the same bytes.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runnerImport } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["malakor"]);
const STAMP = "2026-11-04T00:00:00.000Z";

async function modules() {
  const config = { configFile: false, root: ROOT, logLevel: "warn" };
  const [{ module: pack }, { module: rig }, { module: engine }] = await Promise.all([
    runnerImport("/packages/pack/src/index.ts", config),
    runnerImport("/packages/rig/src/index.ts", config),
    runnerImport("/packages/engine/src/index.ts", config),
  ]);
  return { pack, rig, engine };
}

/**
 * Writes `<outDir>/<slug>.srpack` for every cast job in `forgeDir` and `<outDir>/index.json`
 * (`[{ id, name, file, bytes }]` sorted by id). `outDir` is emptied first. Returns the index.
 */
export async function buildPacks(forgeDir, outDir) {
  const { pack, rig: rigCore, engine } = await modules();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const slugs = readdirSync(forgeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIP.has(entry.name) && existsSync(join(forgeDir, entry.name, "job.json")))
    .map((entry) => entry.name)
    .sort();

  const index = [];
  for (const slug of slugs) {
    const dir = join(forgeDir, slug);
    const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
    const checked = rigCore.validateRig(job.rig);
    if (!checked.ok) throw new Error(`build-packs: ${slug}: the rig does not validate: ${checked.errors[0]?.message ?? "unknown"}`);
    const rig = checked.value;
    if (rig.fictional !== true) throw new Error(`build-packs: ${slug}: the rig is not fictional`);
    const layerFiles = new Set(rig.layers.map((layer) => layer.file));
    const files = {};
    for (const name of pack.rigFiles(rig)) {
      const path = join(dir, name);
      if (existsSync(path)) files[name] = new Uint8Array(readFileSync(path));
      else if (layerFiles.has(name)) throw new Error(`build-packs: ${slug}: missing the layer image ${name}`);
    }
    const bytes = await pack.writePack({
      rig,
      look: rigCore.defaultLook(rig),
      voice: engine.castVoice(rig.id) ?? "crypt",
      files,
      licence: "all-rights-reserved",
      author: "Shadowrunner cast",
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
  const index = await buildPacks(join(ROOT, "assets", "replay", "forge"), join(ROOT, "apps", "web", "public", "packs"));
  const total = index.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`build-packs: ${index.length} packs, ${(total / 1024 / 1024).toFixed(1)} MB -> apps/web/public/packs/`);
}
