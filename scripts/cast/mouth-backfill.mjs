// The rig owns the mouth (llm-avatar-lab): backfills `rig.mouth` into recorded cast jobs and, on
// request, resets the mouth of their expression faces to the neutral art.
//   node scripts/cast/mouth-backfill.mjs (--slug <id> [--slug <id> ...] | --all) [--reset-expressions] [--dry-run]
// For each assets/replay/forge/<slug>/job.json (`--all`: every folder but `malakor`, as build-packs):
// measures the mouth (`measureMouth`) from the rig's first jaw layer image, capped by its first head
// layer's width, and writes it as job.json's `rig.mouth` (the file's own line ending and trailing
// newline; key order kept, `mouth` appended after `layers`, or replaced in place when present).
// --reset-expressions: every head and jaw variant image the rig names (`variants[family].file`) is
// rewritten through `resetMouth` against its layer's base image, in its own format (a lossy WebP as
// the faces were committed, q88 with lossless alpha; a lossless one with rig-webp's options, checked
// bit-exact; PNG via `encodePng`). Not idempotent inside the feather, and a lossy face loses a
// generation: run it once per recorded edit.
// --dry-run measures and prints, writes nothing. No network, no model, no new dependency.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { runnerImport } from "vite";
import { readJsonFile, writeJsonFile } from "../forge-lib.mjs";
import { WEBP_OPTIONS, rgba } from "../rig-webp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FORGE = join(ROOT, "assets", "replay", "forge");
const SKIP = new Set(["malakor"]);
const USAGE = "usage: node scripts/cast/mouth-backfill.mjs (--slug <id> ... | --all) [--reset-expressions] [--dry-run]";

const args = process.argv.slice(2);
const slugsAsked = args.flatMap((a, i) => (args[i - 1] === "--slug" ? [a] : []));
const all = args.includes("--all");
const reset = args.includes("--reset-expressions");
const dry = args.includes("--dry-run");
const known = new Set(["--slug", "--all", "--reset-expressions", "--dry-run"]);
for (const [i, a] of args.entries()) if (a.startsWith("--") ? !known.has(a) : args[i - 1] !== "--slug") throw new Error(`mouth-backfill: unknown argument ${a}\n${USAGE}`);
if (all === slugsAsked.length > 0) throw new Error(`mouth-backfill: give --slug or --all\n${USAGE}`);

const config = { configFile: false, root: ROOT, logLevel: "warn" };
const [{ module: forge }, { module: rigCore }] = await Promise.all([runnerImport("/packages/forge/src/index.ts", config), runnerImport("/packages/rig/src/index.ts", config)]);

/** Raw RGBA of an image file (PNG or WebP) as the forge's Rgba. */
async function load(path) {
  const { data, width, height } = await rgba(readFileSync(path));
  return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/**
 * The committed expression faces are lossy WebP, q88 with lossless alpha (character-control task 5,
 * docs/kiro-log.md); a lossless one (a `VP8L` chunk, rig-webp's WEBP_OPTIONS) stays lossless.
 */
const FACE_WEBP = { quality: 88, alphaQuality: 100, effort: 6 };

/** `image` encoded as `was` (the file's bytes) is: PNG, lossless WebP (checked bit-exact) or lossy WebP (alpha checked exact). */
async function encodeAs(path, was, image) {
  if (path.endsWith(".png")) return forge.encodePng(image);
  if (!path.endsWith(".webp")) throw new Error(`mouth-backfill: ${path}: neither .png nor .webp`);
  const lossless = was.includes("VP8L");
  const raw = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  const webp = await sharp(raw, { raw: { width: image.width, height: image.height, channels: 4 } }).webp(lossless ? WEBP_OPTIONS : FACE_WEBP).toBuffer();
  const back = await rgba(webp);
  if (back.width !== image.width || back.height !== image.height) throw new Error(`mouth-backfill: ${path}: WebP changed size`);
  for (let i = 0; i < raw.length; i += lossless ? 1 : 4) {
    const k = lossless ? i : i + 3;
    if (back.data[k] !== raw[k]) throw new Error(`mouth-backfill: ${path}: WebP did not decode back ${lossless ? "bit-exact" : "with its alpha exact"}`);
  }
  return webp;
}

async function backfill(slug) {
  const dir = join(FORGE, slug);
  const jobPath = join(dir, "job.json");
  if (!existsSync(jobPath)) throw new Error(`mouth-backfill: no recorded job ${slug}`);
  const text = readFileSync(jobPath, "utf8");
  const job = readJsonFile(jobPath);
  if (JSON.stringify(job.value, null, 2).replace(/\n/g, job.eol) + (job.trailing ? job.eol : "") !== text) {
    throw new Error(`mouth-backfill: ${slug}: job.json is not in the 2-space form this script writes; refusing to reformat it`);
  }
  const checked = rigCore.validateRig(job.value.rig);
  if (!checked.ok) throw new Error(`mouth-backfill: ${slug}: the rig does not validate: ${checked.errors[0]?.message}`);
  const rig = checked.value;
  const jaw = rig.layers.find((l) => l.kind === "jaw");
  const head = rig.layers.find((l) => l.kind === "head");
  if (jaw === undefined) {
    console.log(`mouth-backfill: ${slug}: no jaw layer, skipped`);
    return;
  }
  const mouth = forge.measureMouth({ bbox: jaw.bbox, image: await load(join(dir, jaw.file)) }, head);
  if (mouth === undefined) {
    console.log(`mouth-backfill: ${slug}: the jaw ${jaw.file} has no opaque pixel, skipped`);
    return;
  }
  const was = job.value.rig.mouth;
  console.log(`mouth-backfill: ${slug}: mouth cx ${mouth.cx} lineY ${mouth.lineY} width ${mouth.width} (jaw ${jaw.bbox.join(",")}${was === undefined ? "" : `; was ${JSON.stringify(was)}`})`);
  const rewritten = [];
  if (reset) {
    for (const layer of rig.layers) {
      if ((layer.kind !== "head" && layer.kind !== "jaw") || layer.variants === undefined) continue;
      const base = await load(join(dir, layer.file));
      for (const patch of Object.values(layer.variants)) {
        const path = join(dir, patch.file);
        if (!existsSync(path)) {
          console.log(`mouth-backfill: ${slug}: ${patch.file} missing, skipped`);
          continue;
        }
        const was = readFileSync(path);
        const image = forge.resetMouth(await load(path), patch.bbox, base, layer.bbox, mouth);
        const bytes = await encodeAs(path, was, image);
        if (!dry) writeFileSync(path, bytes);
        rewritten.push(patch.file);
      }
    }
  }
  if (!dry) {
    job.value.rig.mouth = mouth;
    const again = rigCore.validateRig(job.value.rig);
    if (!again.ok) throw new Error(`mouth-backfill: ${slug}: the rig with its mouth does not validate: ${again.errors[0]?.message}`);
    writeJsonFile(jobPath, job.value, job);
  }
  console.log(`mouth-backfill: ${slug}: ${dry ? "would write" : "wrote"} job.json rig.mouth; ${reset ? `${rewritten.length} faces ${dry ? "would be " : ""}reset: ${rewritten.join(", ") || "none"}` : "faces untouched"}`);
}

const slugs = all
  ? readdirSync(FORGE, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP.has(e.name) && existsSync(join(FORGE, e.name, "job.json")))
      .map((e) => e.name)
      .sort()
  : slugsAsked.filter((s) => !SKIP.has(s));
for (const slug of slugs) await backfill(slug);
