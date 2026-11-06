// Socketed (or closed-only) eyes for the non-human five (cast-face-pass, WP1b):
//   node scripts/cast/five/eyes.mjs <slug> [--dry]
// Backs up the recorded job on its first run (lib.mjs `backup`), then from the backup: `socketFive`
// (recipes.mjs) writes the eye files, sockets, closed art and iris layers, and every old expression
// face is retired (variants dropped, files kept in the backup): faces.mjs regenerates or re-cuts them.
// Then: faces.mjs <slug>, mouth-backfill (maw characters), node scripts/build-packs.mjs. No network.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { writeJsonFile } from "../../forge-lib.mjs";
import { FIVE_SLUGS, jobDir } from "./lib.mjs";
import { socketed } from "./recipes.mjs";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
if (!FIVE_SLUGS.includes(slug)) throw new Error(`usage: node scripts/cast/five/eyes.mjs <${FIVE_SLUGS.join("|")}> [--dry]`);

const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const { module: orbs } = await runnerImport("/packages/forge/src/eyeOrb.ts");

const { orig, rig, files, notes } = await socketed(forge, orbs, slug);
for (const note of notes) console.log(`five/eyes: ${slug}: ${note}`);
const retired = [];
const layers = rig.layers.map((layer) => {
  if (layer.variants === undefined) return layer;
  for (const p of Object.values(layer.variants)) retired.push(p.file, ...(p.socket === undefined ? [] : [p.socket]));
  const rest = { ...layer };
  delete rest.variants;
  return rest;
});
if (args.includes("--dry")) {
  console.log(`five/eyes: ${slug}: --dry (${Object.keys(files).length} files, ${retired.length} faces would retire)`);
} else {
  for (const [file, image] of Object.entries(files)) writeFileSync(join(jobDir(slug), file), forge.encodePng(image));
  for (const file of retired) if (existsSync(join(jobDir(slug), file))) rmSync(join(jobDir(slug), file));
  writeJsonFile(join(jobDir(slug), "job.json"), { ...orig.value, rig: { ...rig, layers } }, orig);
  console.log(`five/eyes: ${slug}: wrote ${Object.keys(files).join(", ")}; retired ${retired.length} faces; job.json`);
}
