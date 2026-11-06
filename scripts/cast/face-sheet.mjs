// Review sheet of a socketed character's eyes and faces (face-control, WP-B):
//   node scripts/cast/face-sheet.mjs <slug> <out.png> [--scale N]
// Top: per eye, the eye as painted with the iris disc (green), the iris layer's box (yellow) and the
// socket's outline (magenta); the iris-free eye; the closed-lid art; the iris layer; the eye at rest
// as drawn (iris clipped by the socket). Below: the eye band of the rig at rest, neutral then each
// expression face (iris layers clipped by the face's socket; "narrowed" faces marked), before (the
// backup's faces, var/cast-eyes/<slug>/orig/) over after. A review aid; nothing it draws ships.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { readJsonFile } from "../forge-lib.mjs";
import { jobDir, load, origDir, restComposite } from "./face-lib.mjs";
import { text } from "./overlay.mjs";

const [slug, out] = process.argv.slice(2);
if (slug === undefined || out === undefined) throw new Error("usage: node scripts/cast/face-sheet.mjs <slug> <out.png> [--scale N]");
const scaleAt = process.argv.indexOf("--scale");
const S = scaleAt > 0 ? Number(process.argv[scaleAt + 1]) : 4;
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const { module: rigCore } = await runnerImport("/packages/rig/src/index.ts");
const job = readJsonFile(join(jobDir(slug), "job.json")).value;
const rig = job.rig;
const BG = [70, 0, 70];

const blank = (w, h, rgb = [24, 24, 28]) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])) });
function up(img, s = S) {
  const o = blank(img.width * s, img.height * s);
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      const si = (Math.floor(y / s) * img.width + Math.floor(x / s)) * 4;
      const a = img.data[si + 3] / 255;
      for (let c = 0; c < 3; c++) o.data[(y * o.width + x) * 4 + c] = img.data[si + c] * a + BG[c] * (1 - a);
    }
  }
  return o;
}
function place(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) {
    if (y0 + y < 0 || y0 + y >= dst.height) continue;
    const w = Math.min(src.width, dst.width - x0);
    if (w > 0) dst.data.set(src.data.subarray(y * src.width * 4, (y * src.width + w) * 4), ((y0 + y) * dst.width + x0) * 4);
  }
}
function dot(img, x, y, rgb) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set(rgb, (Math.floor(y) * img.width + Math.floor(x)) * 4);
}
const circle = (img, cx, cy, r, rgb) => {
  for (let t = 0; t < 720; t++) dot(img, (cx + r * Math.cos((t * Math.PI) / 360)) * S, (cy + r * Math.sin((t * Math.PI) / 360)) * S, rgb);
};
function rect(img, [x, y, w, h], rgb) {
  for (let i = 0; i <= w * S; i++) dot(img, x * S + i, y * S, rgb), dot(img, x * S + i, (y + h) * S - 1, rgb);
  for (let j = 0; j <= h * S; j++) dot(img, x * S, y * S + j, rgb), dot(img, (x + w) * S - 1, y * S + j, rgb);
}
function outline(img, mask, rgb) {
  const at = (x, y) => x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.data[(y * mask.width + x) * 4 + 3] >= 128;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!at(x, y)) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of edge) {
        if (at(x + dx, y + dy)) continue;
        for (let k = 0; k < S; k++) dot(img, dx === 0 ? x * S + k : (x + (dx > 0 ? 1 : 0)) * S - (dx > 0 ? 1 : 0), dy === 0 ? y * S + k : (y + (dy > 0 ? 1 : 0)) * S - (dy > 0 ? 1 : 0), rgb);
      }
    }
  }
}
const label = (img, words) => (text(img, words, 4, 4, [255, 255, 255], 2), img);
const crop = (img, [x, y, w, h]) => forge.cropImage(img, [Math.round(x), Math.round(y), Math.round(w), Math.round(h)]);

const dir = jobDir(slug);
const images = {};
const eyes = rig.layers.filter((l) => l.kind === "eye");
const rest = await restComposite(forge, rig, dir, undefined, images);
const rows = [];
for (const eye of eyes) {
  const iris = rig.layers.find((l) => l.kind === "iris" && l.follow === eye.name);
  const origPath = join(origDir(slug), eye.file);
  const painted = await load(existsSync(origPath) ? origPath : join(dir, eye.file));
  const a = up(painted);
  if (eye.socket !== undefined) outline(a, await load(join(dir, eye.socket)), [255, 0, 255, 255]);
  if (iris !== undefined) {
    const [bx, by] = eye.bbox;
    const r = (iris.bbox[2] - 3) / 2;
    circle(a, iris.anchor[0] - bx, iris.anchor[1] - by, r, [0, 255, 0, 255]);
    rect(a, [iris.bbox[0] - bx, iris.bbox[1] - by, iris.bbox[2], iris.bbox[3]], [255, 220, 0, 255]);
  }
  const panels = [label(a, `${eye.name} painted`), label(up(await load(join(dir, eye.file))), "iris-free")];
  if (eye.closed !== undefined) panels.push(label(up(await load(join(dir, eye.closed))), "closed"));
  if (iris !== undefined) panels.push(label(up(await load(join(dir, iris.file))), `iris${iris.emissive ? " glow" : ""}`));
  panels.push(label(up(crop(rest, eye.bbox)), "at rest"));
  const w = panels.reduce((s, p) => s + p.width + 6, 0);
  const row = blank(w, Math.max(...panels.map((p) => p.height)));
  let x = 0;
  for (const p of panels) place(row, p, x, 0), (x += p.width + 6);
  rows.push(row);
}
// The eye band: both eyes and the brows, from the brow+lid band's box.
const ew = Math.max(...eyes.map((e) => e.bbox[2]));
const bx0 = Math.min(...eyes.map((e) => e.bbox[0])) - 0.4 * ew;
const bx1 = Math.max(...eyes.map((e) => e.bbox[0] + e.bbox[2])) + 0.4 * ew;
const by0 = Math.min(...eyes.map((e) => e.bbox[1])) - 0.9 * ew;
const by1 = Math.max(...eyes.map((e) => e.bbox[1] + e.bbox[3])) + 0.3 * ew;
const band = [bx0, by0, bx1 - bx0, by1 - by0];
const BS = Math.max(1, Math.floor(320 / band[2]));
const before = existsSync(join(origDir(slug), "job.json")) ? readJsonFile(join(origDir(slug), "job.json")).value.rig : undefined;
const beforeImages = {};
for (const [name, r, d, imgs] of [["before", before, origDir(slug), beforeImages], ["after", rig, dir, images]]) {
  if (r === undefined) continue;
  for (const l of r.layers) if (!existsSync(join(d, l.file)) && existsSync(join(dir, l.file))) imgs[l.file] = await load(join(dir, l.file));
  const tiles = [];
  for (const family of [undefined, ...rigCore.EXPRESSION_FAMILIES]) {
    const has = family === undefined || r.layers.some((l) => l.variants?.[family] !== undefined);
    const img = has ? await restComposite(forge, r, d, family, imgs) : blank(r.width, r.height, [0, 0, 0]);
    const narrowed = family !== undefined && r.layers.some((l) => l.variants?.[family]?.narrowed === true);
    tiles.push(label(up(crop(img, band), BS), `${name} ${family ?? "neutral"}${has ? "" : " none"}${narrowed ? " narrowed" : ""}`));
  }
  const w = tiles.reduce((s, p) => s + p.width + 6, 0);
  const row = blank(w, tiles[0].height);
  let x = 0;
  for (const p of tiles) place(row, p, x, 0), (x += p.width + 6);
  rows.push(row);
}
const W = Math.max(...rows.map((r) => r.width));
const sheet = blank(W, rows.reduce((s, r) => s + r.height + 10, 0));
let y = 0;
for (const r of rows) place(sheet, r, 0, y), (y += r.height + 10);
writeFileSync(out, forge.encodePng(sheet));
console.log(`face-sheet: ${slug}: ${out} (${sheet.width}x${sheet.height})`);
