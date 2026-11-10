// Served cast art as lossy WebP (perfection-pass task 12, requirement 12).
//
//   node scripts/art-webp.mjs [--check] [--dry] [slug ...]
// For every replay forge job under assets/replay/forge/<slug>/ except `malakor` (pre-existing house
// art, docs/provenance.md: never re-encoded), every `*.png` gets a sibling `.webp`; the PNG stays as
// the source the pack builder and the forge scripts read, and the app requests the WebP. Art is
// encoded at quality 90 with lossless alpha (`ART_WEBP`); a region map (`*.regions.png`) is an index
// map, not art (R = slot + 1), so it goes lossless and bit-exact (rig-webp.mjs `toWebp`).
// Every encode is refused unless the decoded alpha equals the PNG's byte for byte. Then the
// character's geometry check (`checkJob`) compares the decoded colour, premultiplied as the
// renderer draws it, at the measured mouth, the sockets (eyes, irises, their socket and lid art)
// and the seams (the cut edge of every layer), and fails over `TOLERANCE`.
// --check encodes nothing and only checks the committed WebPs; --dry encodes in memory.
// Deterministic: the same PNG bytes and sharp version give the same WebP bytes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { rgba, toWebp } from "./rig-webp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FORGE_DIR = join(ROOT, "assets", "replay", "forge");
/** Jobs whose art is never re-encoded: Malakor's is the pre-existing house art. */
export const KEEP_PNG = new Set(["malakor"]);
/** Colour q90, alpha lossless, colour under alpha 0 kept (`exact`), slowest and best effort. */
export const ART_WEBP = { quality: 90, alphaQuality: 100, exact: true, effort: 6, smartSubsample: true };
/**
 * Worst allowed premultiplied per-channel difference (0..255) of a drawn file and of each zone:
 * `p99` over the visible pixels and `max` for any single one. A q90 encode moves a few levels on
 * flat paint and more on a hard one-pixel edge, so the single-pixel bound is wider. The portrait
 * (shown while the forge plays, never drawn by the rig) is held to `p99` only.
 */
export const TOLERANCE = { p99: 10, max: 64 };
export const ZONES = ["mouth", "sockets", "seams"];

export const isRegionMap = (file) => file.endsWith(".regions.png");
export const webpName = (file) => file.replace(/\.png$/, ".webp");

/**
 * True for a replay file the deploy leaves out (scripts/vercel-output.mjs): a recorded WAV (the
 * voices ship as .m4a; a WAV kept beside one is a test's PCM source) and a PNG with a `.webp` beside
 * it (the WebP's source; the app requests the WebP).
 */
export const servedElsewhere = (path, exists = existsSync) => path.endsWith(".wav") || (path.endsWith(".png") && exists(webpName(path)));

/** p99 and max of the premultiplied per-channel differences (0..255) over the visible pixels. */
export function diffStats(a, b) {
  const hist = newHist();
  for (let i = 0; i < a.data.length; i += 4) {
    const al = a.data[i + 3] ?? 0;
    if (al === 0) continue;
    for (let c = 0; c < 3; c++) hist[Math.round(Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0)) * (al / 255))] += 1;
  }
  return summary(hist);
}

/**
 * PNG bytes -> WebP bytes and how they were made. A region map: lossless, bit-exact. Art: q90 with
 * its alpha unchanged (refused otherwise), unless the lossless encode is no larger, or the q90 one
 * misses TOLERANCE in the file (a small saturated part, a neon ring or an iris, loses its colour to
 * 4:2:0 chroma): then lossless, bit-exact.
 */
export async function toArtWebp(png, label = "image", { portrait = false } = {}) {
  if (isRegionMap(label)) return { webp: await toWebp(png, label), mode: "lossless" };
  const lossy = await sharp(png).webp(ART_WEBP).toBuffer();
  const [a, b] = await Promise.all([rgba(png), rgba(lossy)]);
  if (a.width !== b.width || a.height !== b.height) throw new Error(`${label}: size changed after WebP`);
  for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) throw new Error(`${label}: alpha differs after WebP`);
  const lossless = await toWebp(png, label);
  const stats = diffStats(a, b);
  if (lossless.length <= lossy.length) return { webp: lossless, mode: "lossless" };
  if (stats.p99 > TOLERANCE.p99 || (!portrait && stats.max > TOLERANCE.max)) return { webp: lossless, mode: "fallback" };
  return { webp: lossy, mode: "lossy" };
}

/** Every file a recorded job names, with the canvas box its image covers and its role. */
export function jobFiles(job) {
  const out = new Map([[job.portrait, { box: [0, 0, job.rig.width, job.rig.height], role: "portrait" }]]);
  for (const layer of job.rig.layers) {
    const eye = layer.kind === "eye" || layer.kind === "iris";
    const role = eye ? "sockets" : layer.kind === "jaw" ? "jaw" : "layer";
    out.set(layer.file, { box: layer.bbox, role });
    if (layer.regions !== undefined) out.set(layer.regions.map, { box: layer.bbox, role: "regions" });
    for (const file of [layer.socket, layer.closed]) if (file !== undefined) out.set(file, { box: layer.bbox, role: "sockets" });
    for (const patch of Object.values(layer.variants ?? {})) {
      out.set(patch.file, { box: patch.bbox, role: eye ? "sockets" : "patch" });
      if (patch.socket !== undefined) out.set(patch.socket, { box: layer.bbox, role: "sockets" });
    }
  }
  return out;
}

/** The measured mouth as a canvas box: its lips, else the rest mouth, else every jaw layer's box. */
export function mouthBox(rig, pad = 12) {
  const lips = rig.mouth?.lips;
  if (lips !== undefined) return [lips.left - pad, lips.upper - pad, lips.right + pad, lips.lower + pad];
  if (rig.mouth !== undefined) {
    const half = rig.mouth.width / 2;
    return [rig.mouth.cx - half - pad, rig.mouth.lineY - half / 2 - pad, rig.mouth.cx + half + pad, rig.mouth.lineY + half / 2 + pad];
  }
  const jaws = rig.layers.filter((l) => l.kind === "jaw").map((l) => l.bbox);
  if (jaws.length === 0) return undefined;
  return [Math.min(...jaws.map((b) => b[0])), Math.min(...jaws.map((b) => b[1])), Math.max(...jaws.map((b) => b[0] + b[2])), Math.max(...jaws.map((b) => b[1] + b[3]))];
}

const SEAM_PX = 2;

/** True where a visible pixel lies within SEAM_PX of a transparent one or of the image edge. */
function seamMask(alpha, w, h) {
  const seam = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] === 0) continue;
      search: for (let dy = -SEAM_PX; dy <= SEAM_PX; dy++) {
        for (let dx = -SEAM_PX; dx <= SEAM_PX; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || alpha[yy * w + xx] === 0) {
            seam[y * w + x] = 1;
            break search;
          }
        }
      }
    }
  }
  return seam;
}

/** A per-zone histogram of premultiplied per-channel differences (0..255). */
const newHist = () => new Float64Array(256);

function summary(hist) {
  let n = 0;
  for (const c of hist) n += c;
  if (n === 0) return { pixels: 0, p99: 0, max: 0 };
  let max = 0;
  for (let v = 255; v >= 0; v--) if ((hist[v] ?? 0) > 0) { max = v; break; }
  let seen = 0;
  let p99 = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v] ?? 0;
    if (seen >= n * 0.99) { p99 = v; break; }
  }
  return { pixels: n / 3, p99, max };
}

/**
 * Compares one PNG with its WebP: alpha byte-equal, and the premultiplied colour differences
 * binned per zone (`mouth`: pixels whose canvas position falls in `mouth`; `sockets`: every pixel
 * of an eye-role file; `seams`: the cut edge; `all`: everything visible).
 */
export function compareImages(png, webp, { box, role }, mouth, hists) {
  const { width: w, height: h } = png;
  if (webp.width !== w || webp.height !== h) return { alphaEqual: false };
  const alpha = new Uint8Array(w * h);
  let alphaEqual = true;
  for (let i = 0; i < w * h; i++) {
    alpha[i] = png.data[i * 4 + 3] ?? 0;
    if (alpha[i] !== webp.data[i * 4 + 3]) alphaEqual = false;
  }
  const seam = seamMask(alpha, w, h);
  const sx = box[2] / w;
  const sy = box[3] / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i] ?? 0;
      if (a === 0) continue;
      const cx = box[0] + (x + 0.5) * sx;
      const cy = box[1] + (y + 0.5) * sy;
      const zones = ["all"];
      if (role === "sockets") zones.push("sockets");
      if (seam[i] === 1 && role !== "portrait") zones.push("seams");
      if (mouth !== undefined && role !== "portrait" && cx >= mouth[0] && cx <= mouth[2] && cy >= mouth[1] && cy <= mouth[3]) zones.push("mouth");
      for (let c = 0; c < 3; c++) {
        const d = Math.round(Math.abs((png.data[i * 4 + c] ?? 0) - (webp.data[i * 4 + c] ?? 0)) * (a / 255));
        for (const z of zones) hists[z][d] += 1;
      }
    }
  }
  return { alphaEqual };
}

/**
 * The geometry check of one job folder against its committed (or given) WebPs: every PNG has one,
 * every alpha is equal, every region map is bit-exact, and each zone is within TOLERANCE.
 */
export async function checkJob(dir, webps = new Map()) {
  const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
  const files = jobFiles(job);
  const mouth = mouthBox(job.rig);
  const hists = Object.fromEntries([...ZONES, "all"].map((z) => [z, newHist()]));
  const faults = [];
  let pngBytes = 0;
  let webpBytes = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
    const pngBuf = readFileSync(join(dir, file));
    const webpBuf = webps.get(file) ?? (existsSync(join(dir, webpName(file))) ? readFileSync(join(dir, webpName(file))) : undefined);
    if (webpBuf === undefined) {
      faults.push(`${file}: no WebP`);
      continue;
    }
    pngBytes += pngBuf.length;
    webpBytes += webpBuf.length;
    const [png, webp] = await Promise.all([rgba(pngBuf), rgba(webpBuf)]);
    if (isRegionMap(file)) {
      if (!png.data.equals(webp.data)) faults.push(`${file}: region map not bit-exact`);
      continue;
    }
    const at = files.get(file) ?? { box: [0, 0, png.width, png.height], role: "layer" };
    if (!compareImages(png, webp, at, mouth, hists).alphaEqual) faults.push(`${file}: alpha differs`);
  }
  const zones = Object.fromEntries(Object.entries(hists).map(([z, hist]) => [z, summary(hist)]));
  for (const z of ZONES) {
    const s = zones[z];
    if (s.p99 > TOLERANCE.p99 || s.max > TOLERANCE.max) faults.push(`${z}: p99 ${s.p99}, max ${s.max} over ${TOLERANCE.p99}/${TOLERANCE.max}`);
  }
  return { slug: job.slug, pngBytes, webpBytes, zones, faults, mouthFrom: job.rig.mouth?.lips !== undefined ? "lips" : job.rig.mouth !== undefined ? "mouth" : "jaw" };
}

/** The job folders converted by this script. */
export const artSlugs = (forgeDir = FORGE_DIR) =>
  readdirSync(forgeDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !KEEP_PNG.has(e.name) && existsSync(join(forgeDir, e.name, "job.json")))
    .map((e) => e.name)
    .sort();

async function main(argv) {
  const check = argv.includes("--check");
  const dry = argv.includes("--dry");
  const asked = argv.filter((a) => !a.startsWith("--"));
  const slugs = asked.length > 0 ? asked : artSlugs();
  for (const slug of slugs) if (KEEP_PNG.has(slug)) throw new Error(`${slug}: house art, never re-encoded`);
  let failed = false;
  for (const slug of slugs) {
    const dir = join(FORGE_DIR, slug);
    const webps = new Map();
    const modes = { lossy: 0, lossless: 0, fallback: 0 };
    if (!check) {
      const portrait = JSON.parse(readFileSync(join(dir, "job.json"), "utf8")).portrait;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
        const { webp, mode } = await toArtWebp(readFileSync(join(dir, file)), file, { portrait: file === portrait });
        webps.set(file, webp);
        modes[mode] += 1;
      }
    }
    const result = await checkJob(dir, webps);
    if (result.faults.length === 0 && !check && !dry) for (const [file, webp] of webps) writeFileSync(join(dir, webpName(file)), webp);
    const z = result.zones;
    const zone = (name) => `${name} p99 ${z[name].p99} max ${z[name].max}`;
    const made = check ? "" : ` (${modes.lossy} q90, ${modes.lossless} lossless, ${modes.fallback} lossless over tolerance)`;
    console.log(`${slug}: ${result.pngBytes} -> ${result.webpBytes} bytes (${((result.webpBytes / result.pngBytes) * 100).toFixed(1)}%)${made}; alpha equal; ${zone("mouth")} (${result.mouthFrom}); ${zone("sockets")}; ${zone("seams")}; ${zone("all")}`);
    for (const fault of result.faults) console.error(`  FAIL ${fault}`);
    failed ||= result.faults.length > 0;
  }
  if (failed) process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
