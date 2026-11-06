// Review aid for the five's raw edits (cast-face-pass, WP1b): the eye band of the portrait and of
// every edit in var/cast-expr/<slug>/ and var/cast-eyes/<slug>/ (registered as faces.mjs does), tiled:
//   node scripts/cast/five/contact.mjs <slug> <out.png> [--y0 N --y1 N]
// Nothing it draws ships.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { runnerImport } from "vite";
import { readJsonFile } from "../../forge-lib.mjs";
import { resize } from "../measure.mjs";
import { text } from "../overlay.mjs";
import { exprWork, eyesWork, jobDir, load } from "./lib.mjs";
import { RECIPES } from "./recipes.mjs";

const args = process.argv.slice(2);
const [slug, out] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const opt = (n) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : undefined);
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const job = readJsonFile(join(jobDir(slug), "job.json")).value;
const rig = job.rig;
const portrait = await load(join(jobDir(slug), job.portrait));
const layers = new Map();
for (const l of rig.layers) if (existsSync(join(jobDir(slug), l.file))) layers.set(l.name, await load(join(jobDir(slug), l.file)));
const face = forge.faceShape(rig, layers);
const eyes = rig.layers.filter((l) => l.kind === "eye");
const ew = Math.max(...eyes.map((e) => e.bbox[2]));
const x0 = Math.max(0, Math.min(...eyes.map((e) => e.bbox[0])) - ew);
const x1 = Math.min(rig.width, Math.max(...eyes.map((e) => e.bbox[0] + e.bbox[2])) + ew);
const y0 = opt("--y0") ?? Math.max(0, Math.min(...eyes.map((e) => e.bbox[1])) - 1.5 * ew);
const y1 = opt("--y1") ?? Math.min(rig.height, Math.max(...eyes.map((e) => e.bbox[1] + e.bbox[3])) + ew);
const box = [x0, y0, x1 - x0, y1 - y0].map(Math.round);
const tiles = [["portrait", portrait]];
for (const d of [exprWork(slug), eyesWork(slug)]) {
  for (const f of existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".png") && !f.startsWith("portrait")).sort() : []) {
    const img = forge.registerEdit(resize(await load(join(d, f)), portrait.width, portrait.height), portrait, rig, face, RECIPES[slug].reach).image;
    tiles.push([f.replace(".png", ""), img]);
  }
}
const scale = Math.min(2, 300 / box[2]);
const tw = Math.round(box[2] * scale);
const th = Math.round(box[3] * scale);
const cols = 4;
const rows = Math.ceil(tiles.length / cols);
const sheet = { width: cols * (tw + 4), height: rows * (th + 4), data: new Uint8ClampedArray(cols * (tw + 4) * rows * (th + 4) * 4).fill(30) };
for (let k = 0; k < tiles.length; k++) {
  const crop = resize(forge.cropImage(tiles[k][1], box), tw, th);
  text(crop, tiles[k][0].toUpperCase(), 3, 3, [255, 255, 0], 2);
  const ox = (k % cols) * (tw + 4);
  const oy = Math.floor(k / cols) * (th + 4);
  for (let y = 0; y < th; y++) sheet.data.set(crop.data.subarray(y * tw * 4, (y + 1) * tw * 4), ((oy + y) * sheet.width + ox) * 4);
}
for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
writeFileSync(out, await sharp(Buffer.from(sheet.data.buffer), { raw: { width: sheet.width, height: sheet.height, channels: 4 } }).png().toBuffer());
console.log(`contact: ${slug}: ${out} (${tiles.length} tiles)`);
