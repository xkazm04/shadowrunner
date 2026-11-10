// The recorded cast keeps every piece (perfection-pass task 16, requirement 16.3):
//   node scripts/cover-recut.mjs [--check] [slug ...]
// For every replay forge job under assets/replay/forge/<slug>/ except `malakor` (pre-existing house
// art, docs/provenance.md: never changed), runs the forge's own deterministic stage `keepEveryPiece`
// (packages/forge/src/coverFix.ts, the one assembleRig runs on a new rig) on the committed layers,
// with the job's portrait, its recorded parts (assets/characters/presets/<slug>/parts.json, else
// assets/characters/cast/<slug>/parts.json) and its painted background. The forge's model and image
// steps are not re-run: the committed layers carry every later edit (faces, eyes, mouths), so only
// the head and body layers the stage changes, the background and those layers' bboxes in job.json
// are written. Then the coverage check (coverCheck.ts) must pass. Afterwards regenerate the region
// maps and WebP copies of the changed jobs: node scripts/cast/regions.mjs <slug>; node scripts/art-webp.mjs <slug>.
// --check writes nothing and reports the check for every job (Malakor included, as information).
// No network, no key, no model.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_FILE_BYTES, OUT, readJsonFile, writeJsonFile } from "./forge-lib.mjs";
import { runnerImport } from "vite";

const HOUSE = new Set(["malakor"]);
const args = process.argv.slice(2);
const check = args.includes("--check");
const named = args.filter((a) => !a.startsWith("--"));
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");

function decode(path) {
  const decoded = forge.decodeImage(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) throw new Error(`cover-recut: ${path}: ${decoded.errors.message}`);
  return decoded.value;
}

/** The job's recorded parts (Malakor's are the recorded m8 parts of his replay job). */
function partsOf(slug) {
  const candidates = slug === "malakor" ? [join("packages", "forge", "test", "fixtures", "m8-parts.json")] : [join("assets", "characters", "presets", slug, "parts.json"), join("assets", "characters", "cast", slug, "parts.json")];
  const path = candidates.find((p) => existsSync(p));
  if (path === undefined) throw new Error(`cover-recut: no recorded parts for ${slug}`);
  const parsed = forge.parseParts(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok) throw new Error(`cover-recut: ${path} does not parse`);
  return parsed.value.named ?? parsed.value.parts;
}

const line = (r) => `uncovered ${r.uncovered} of ${r.foreground}, neck ${r.neck} px (reach ${r.reach}) with ${r.neckGaps} uncovered${r.worstPose === undefined ? "" : ` at ${r.worstPose}`}`;

const slugs = named.length > 0 ? named : readdirSync(OUT).filter((d) => existsSync(join(OUT, d, "job.json"))).sort();
let failed = 0;
for (const slug of slugs) {
  const dir = join(OUT, slug);
  const path = join(dir, "job.json");
  const { value: job, eol, trailing } = readJsonFile(path);
  const images = {};
  for (const layer of job.rig.layers) if (existsSync(join(dir, layer.file))) images[layer.file] = decode(join(dir, layer.file));
  const portrait = decode(join(dir, job.portrait));
  const parts = partsOf(slug);
  const before = forge.coverReport(job.rig, images, portrait, parts);
  if (check || HOUSE.has(slug)) {
    const ok = forge.covers(before);
    if (!ok && !HOUSE.has(slug)) failed++;
    console.log(`cover-recut: ${slug}${HOUSE.has(slug) ? " (house art, unchanged)" : ""}: ${ok ? "covers" : "FAILS"}: ${line(before)}`);
    continue;
  }
  const background = images["background.png"];
  if (background === undefined) throw new Error(`cover-recut: ${slug} has no background.png`);
  const kept = forge.keepEveryPiece({ rig: job.rig, images, portrait, background, parts });
  const after = forge.coverReport(kept.rig, { ...kept.images, "background.png": kept.background }, portrait, parts);
  if (!forge.covers(after)) failed++;
  if (kept.changed.length > 0) {
    const write = (file, image) => {
      const png = forge.encodePng(image);
      if (png.length > MAX_FILE_BYTES) throw new Error(`cover-recut: ${slug}/${file} is over ${MAX_FILE_BYTES} bytes`);
      writeFileSync(join(dir, file), png);
    };
    write("background.png", kept.background);
    for (const name of kept.changed) {
      const layer = job.rig.layers.find((l) => l.name === name);
      const now = kept.rig.layers.find((l) => l.name === name);
      write(layer.file, kept.images[layer.file]);
      layer.bbox = now.bbox;
    }
    writeJsonFile(path, job, { eol, trailing });
  }
  console.log(`cover-recut: ${slug}: [${kept.changed.join(", ")}] head +${kept.head}, body +${kept.body}, neck +${kept.neck} (reach ${kept.reach}); before: ${line(before)}; after: ${line(after)}`);
}
if (failed > 0) {
  console.error(`cover-recut: ${failed} job(s) fail the coverage check`);
  process.exit(1);
}
