// Bakes a tuned face into the cast (face-control): the owner tunes a cast character in the creator's
// Face tab, exports a pack, and this writes the pack's Look.face into the recorded job as rig.face.
//   node scripts/cast/face-from-pack.mjs <pack.srpack> [--slug <slug>] [--dry-run]
// The slug defaults to the pack's rig id without its "replay-" prefix (the cast's rig ids are
// `replay-<folder>`). The new rig.face is the job's own rig.face with every field Look.face sets laid
// over it (Look.face holds only the fields the owner moved off the character's own value); a field
// equal to FACE_DEFAULTS is left out, and an empty profile removes rig.face. The rig must still
// validate. job.json keeps its form: 2-space JSON with its own line ending and trailing newline
// (refused when it is not in that form, as mouth-backfill), key order kept, `face` replaced in place
// or appended after the rig's last key. Prints each changed field (was -> now); --dry-run prints
// only. A pack whose rig.face differs from the job's is baked over the job's, with a warning.
// No network, no model, no new dependency.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runnerImport } from "vite";
import { readJsonFile, writeJsonFile } from "../forge-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FORGE = join(ROOT, "assets", "replay", "forge");
const USAGE = "usage: node scripts/cast/face-from-pack.mjs <pack.srpack> [--slug <slug>] [--dry-run]";

async function modules() {
  const config = { configFile: false, root: ROOT, logLevel: "warn" };
  const [{ module: pack }, { module: rig }] = await Promise.all([runnerImport("/packages/pack/src/index.ts", config), runnerImport("/packages/rig/src/index.ts", config)]);
  return { pack, rig };
}

const show = (v) => (v === undefined ? "-" : String(v));

/**
 * The baked profile: `own` (the job's rig.face) with every field `tuned` (Look.face) sets laid over
 * it, fields equal to FACE_DEFAULTS left out. `rigCore` is @sr/rig. Returns the profile (undefined
 * when empty) and one `{ field, was, now }` per field whose stored value changes.
 */
export function bakeFace(own, tuned, rigCore) {
  let face;
  const changes = [];
  for (const field of rigCore.FACE_FIELDS) {
    const was = rigCore.faceValue(own, field);
    const set = rigCore.faceValue(tuned, field) ?? was;
    const now = set === rigCore.faceValue(rigCore.FACE_DEFAULTS, field) ? undefined : set;
    if (now !== undefined) face = rigCore.withFaceValue(face, field, now);
    if (now !== was) changes.push({ field, was, now });
  }
  return { face, changes };
}

/** Bakes `packPath`'s Look.face into `<forgeDir>/<slug>/job.json`; returns what it did (and logs it through `log`). */
export async function faceFromPack(packPath, { slug: slugAsked, dryRun = false, forgeDir = FORGE, log = console.log } = {}) {
  const { pack, rig: rigCore } = await modules();
  const read = await pack.readPack(new Uint8Array(readFileSync(packPath)));
  if (!read.ok) throw new Error(`face-from-pack: ${packPath}: ${pack.packErrorSentence(read.error)} (${read.error.detail})`);
  const slug = slugAsked ?? read.pack.rig.id.replace(/^replay-/, "");
  const jobPath = join(forgeDir, slug, "job.json");
  if (!existsSync(jobPath)) throw new Error(`face-from-pack: no recorded job ${slug} (give --slug)\n${USAGE}`);
  const text = readFileSync(jobPath, "utf8");
  const job = readJsonFile(jobPath);
  if (JSON.stringify(job.value, null, 2).replace(/\n/g, job.eol) + (job.trailing ? job.eol : "") !== text) {
    throw new Error(`face-from-pack: ${slug}: job.json is not in the 2-space form this script writes; refusing to reformat it`);
  }
  const tuned = read.pack.look.face;
  if (tuned === undefined) {
    log(`face-from-pack: ${slug}: the pack's look has no face (nothing was tuned); job.json untouched`);
    return { slug, changes: [], written: false };
  }
  const own = job.value.rig.face;
  if (JSON.stringify(read.pack.rig.face ?? null) !== JSON.stringify(own ?? null)) {
    log(`face-from-pack: ${slug}: warning: the pack's rig.face ${JSON.stringify(read.pack.rig.face ?? null)} is not the job's ${JSON.stringify(own ?? null)}; baking over the job's`);
  }
  const { face, changes } = bakeFace(own, tuned, rigCore);
  for (const c of changes) log(`  ${c.field}: ${show(c.was)} -> ${show(c.now)}${c.now === undefined ? " (default)" : ""}`);
  if (changes.length === 0) {
    log(`face-from-pack: ${slug}: rig.face already says this; job.json untouched`);
    return { slug, changes, written: false };
  }
  if (face === undefined) delete job.value.rig.face;
  else job.value.rig.face = face;
  const checked = rigCore.validateRig(job.value.rig);
  if (!checked.ok) throw new Error(`face-from-pack: ${slug}: the rig with its face does not validate: ${checked.errors[0]?.message}`);
  if (!dryRun) writeJsonFile(jobPath, job.value, job);
  log(`face-from-pack: ${slug}: ${dryRun ? "would write" : "wrote"} job.json rig.face ${JSON.stringify(face ?? null)} (${changes.length} ${changes.length === 1 ? "field" : "fields"})`);
  return { slug, changes, face, written: !dryRun };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const slug = args.flatMap((a, i) => (args[i - 1] === "--slug" ? [a] : []));
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--slug");
  for (const a of args) if (a.startsWith("--") && a !== "--slug" && a !== "--dry-run") throw new Error(`face-from-pack: unknown argument ${a}\n${USAGE}`);
  if (files.length !== 1 || slug.length > 1) throw new Error(`face-from-pack: give one pack and at most one --slug\n${USAGE}`);
  await faceFromPack(resolve(files[0]), { ...(slug[0] === undefined ? {} : { slug: slug[0] }), dryRun: args.includes("--dry-run") });
}
