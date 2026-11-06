// The rig owns the mouth (llm-avatar-lab): backfills `rig.mouth` into recorded cast jobs and, on
// request, resets the mouth of their expression faces to the neutral art.
//   node scripts/cast/mouth-backfill.mjs (--slug <id> [--slug <id> ...] | --all) [--reset-expressions | --lips] [--dry-run]
// For each assets/replay/forge/<slug>/job.json (`--all`: every folder but `malakor`, as build-packs):
// measures the mouth (`measureMouth`) from the rig's first jaw layer image, capped by its first head
// layer's width, and writes it as job.json's `rig.mouth` (the file's own line ending and trailing
// newline; key order kept, `mouth` appended after `layers`, or replaced in place when present).
// --reset-expressions: every head and jaw variant image the rig names (`variants[family].file`) is
// rewritten through `resetMouth` against its layer's base image, in its own format (a lossy WebP as
// the faces were committed, q88 with lossless alpha; a lossless one with rig-webp's options, checked
// bit-exact; PNG via `encodePng`). Not idempotent inside the feather, and a lossy face loses a
// generation: run it once per recorded edit.
// A re-measured mouth keeps the `lips` job.json already carries (`--lips` re-measures them).
// --lips (art-mouth): only the painted lips. For every rig that already has `rig.mouth` (the art
// mouths have none; the Tallyman's drawn one is measured too, harmlessly), `measureLips` on the rest
// head + jaw (the first head and first jaw layer, bottom first) about that mouth, written as
// `rig.mouth.lips` (with its `seam`, the parting at cx, when found; appended to the mouth's keys, or
// replaced in place). When it is unsure, or the
// character's CAST call `lips` says why not, a stale `lips` is removed and none is written. The
// mouth's other keys are untouched.
// --dry-run measures and prints, writes nothing. No network, no model, no new dependency.
// Per character (CAST, round 3, chosen on contact sheets of all seven faces): a mouth drawn as art
// (a visor slit, a neon gap, a maw, a skull's teeth, a carved grin) keeps its art: no `mouth`, no
// reset, as the forge's `drawnMouth` rules for cavity "gap"/"fill"; a lip mouth may widen the reset
// region (`region`, shares of the mouth's width overriding expressions.ts RESET_RX / RESET_RY_ABOVE /
// RESET_RY_BELOW) where a face's grin, open jaw or nose reaches past the default one.
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
/**
 * Round 3's per-character calls: `art` (why the art keeps its mouth) or a reset `region`; `render:
 * "drawn"` where the player's procedural mouth suits the style (flat, low-poly: the Tallyman). The
 * rest (painterly, dithered pixel art) keep their reset neutral lips and the jaw until an art-preserving mouth exists.
 */
const CAST = {
  "announcer-of-dead-air": { art: "a skull's open grin of teeth: the expressions redraw the teeth above any lip region" },
  "lantern-warden": { art: "a carved jack-o'-lantern grin, wider than the measured mouth" },
  reveille: { art: "a neon zigzag over a dark gap (recipe cavity gap/fill); the region reaches the eyes" },
  "sir-vacant": { art: "a lit visor slit (recipe cavity gap)" },
  "vicar-of-the-lure": { art: "a maw of teeth over a lit throat (recipe cavity fill); the region reaches the eyes" },
  "auntie-asp": { region: { rx: 1.2, above: 1.35, below: 0.85 } },
  "lot-ninety": { region: { rx: 1.15, below: 0.8 } },
  "moth-widow": { region: { above: 1.0, below: 0.8 } },
  "saint-cardia": { region: { above: 1.25, below: 0.9 } },
  "sister-vesper": { region: { rx: 1.25, below: 0.8 } },
  "the-redactor": { region: { rx: 1.3, above: 1.4, below: 1.0 }, cell: 7.1 },
  "the-tallyman": { render: "drawn" },
  // art-mouth: measureLips finds only the lower lip (the upper lip is shadowed, not red, over the black
  // gap above lineY), so no box rather than a wrong one; without lips the warp does not run and the dummy keeps its sliding jaw.
  understudy: { region: { above: 1.1, below: 1.0 }, lips: "measureLips sees only the lower lip under the dummy's black gap" },
};
const USAGE = "usage: node scripts/cast/mouth-backfill.mjs (--slug <id> ... | --all) [--reset-expressions | --lips] [--dry-run]";

const args = process.argv.slice(2);
const slugsAsked = args.flatMap((a, i) => (args[i - 1] === "--slug" ? [a] : []));
const all = args.includes("--all");
const reset = args.includes("--reset-expressions");
const dry = args.includes("--dry-run");
const lipsOnly = args.includes("--lips");
const known = new Set(["--slug", "--all", "--reset-expressions", "--lips", "--dry-run"]);
for (const [i, a] of args.entries()) if (a.startsWith("--") ? !known.has(a) : args[i - 1] !== "--slug") throw new Error(`mouth-backfill: unknown argument ${a}\n${USAGE}`);
if (all === slugsAsked.length > 0) throw new Error(`mouth-backfill: give --slug or --all\n${USAGE}`);
if (lipsOnly && reset) throw new Error(`mouth-backfill: --lips measures only the lips; run --reset-expressions on its own\n${USAGE}`);

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

/** forge.resetMouth, with this character's region override when it has one. */
function resetWith(region, patch, patchBbox, base, baseBbox, mouth) {
  return forge.resetMouth(patch, patchBbox, base, baseBbox, mouth, region);
}

/** The recorded job, refused unless in the 2-space form this script writes, with its validated rig. */
function readJob(slug) {
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
  return { dir, jobPath, job, rig: checked.value };
}

/** --lips: `rig.mouth.lips` from measureLips on the rest head + jaw about the recorded mouth. */
async function backfillLips(slug) {
  const call = CAST[slug] ?? {};
  const { dir, jobPath, job, rig } = readJob(slug);
  if (rig.mouth === undefined) {
    console.log(`mouth-backfill: ${slug}: no rig.mouth${call.art === undefined ? "" : ` (${call.art})`}, no lips`);
    return;
  }
  const head = rig.layers.find((l) => l.kind === "head");
  const jaw = rig.layers.find((l) => l.kind === "jaw");
  const rest = [head, jaw].filter((l) => l !== undefined).sort((a, b) => a.z - b.z);
  const layers = await Promise.all(rest.map(async (l) => ({ bbox: l.bbox, image: await load(join(dir, l.file)) })));
  const measured = forge.measureLips(layers, rig.mouth);
  const lips = call.lips === undefined ? measured : undefined;
  const { cx, lineY, width } = rig.mouth;
  const why = call.lips === undefined ? "measureLips is unsure" : `${call.lips}; measured ${JSON.stringify(measured)}`;
  const box = lips === undefined ? `none (${why})` : `left ${lips.left} right ${lips.right} upper ${lips.upper} lower ${lips.lower} seam ${lips.seam ?? `none (lineY ${lineY})`} (span ${((lips.right - lips.left) / width).toFixed(2)} x width)`;
  console.log(`mouth-backfill: ${slug}: mouth cx ${cx} lineY ${lineY} width ${width} -> lips ${box}`);
  const mouth = job.value.rig.mouth;
  if (lips === undefined) delete mouth.lips;
  else mouth.lips = lips;
  const again = rigCore.validateRig(job.value.rig);
  if (!again.ok) throw new Error(`mouth-backfill: ${slug}: the rig with its lips does not validate: ${again.errors[0]?.message}`);
  if (!dry) writeJsonFile(jobPath, job.value, job);
  console.log(`mouth-backfill: ${slug}: ${dry ? "would write" : "wrote"} job.json rig.mouth${lips === undefined ? " without lips" : ".lips"}`);
}

async function backfill(slug) {
  const call = CAST[slug] ?? {};
  if (call.art !== undefined) {
    console.log(`mouth-backfill: ${slug}: the art keeps its mouth (${call.art}): no rig.mouth, faces untouched`);
    return;
  }
  const { dir, jobPath, job, rig } = readJob(slug);
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
  console.log(`mouth-backfill: ${slug}: mouth cx ${mouth.cx} lineY ${mouth.lineY} width ${mouth.width} (jaw ${jaw.bbox.join(",")}${was === undefined ? "" : `; was ${JSON.stringify(was)}`}${call.region === undefined ? "" : `; region ${JSON.stringify(call.region)}`})`);
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
        const image = resetWith(call.region, await load(path), patch.bbox, base, layer.bbox, mouth);
        const bytes = await encodeAs(path, was, image);
        if (!dry) writeFileSync(path, bytes);
        rewritten.push(patch.file);
      }
    }
  }
  if (!dry) {
    const lips = was?.lips;
    job.value.rig.mouth = { ...mouth, ...(call.render === undefined ? {} : { render: call.render }), ...(call.cell === undefined ? {} : { cell: call.cell }), ...(lips === undefined ? {} : { lips }) };
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
for (const slug of slugs) await (lipsOnly ? backfillLips(slug) : backfill(slug));
