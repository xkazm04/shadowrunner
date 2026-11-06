// Review aid (cast-face-pass, WP1b): the rig at rest, neutral and each face, cropped to a box, scaled:
//   node scripts/cast/five/zoom.mjs <slug> <out.png> <x,y,w,h> [scale]
// Iris layers clipped by the active socket (lib.mjs restComposite). Nothing it draws ships.
import { join } from "node:path";
import sharp from "sharp";
import { runnerImport } from "vite";
import { readJsonFile } from "../../forge-lib.mjs";
import { text } from "../overlay.mjs";
import { resize } from "../measure.mjs";
import { FAMILIES, jobDir, restComposite } from "./lib.mjs";

const [slug, out, boxArg, scaleArg] = process.argv.slice(2);
const box = boxArg.split(",").map(Number);
const k = Number(scaleArg ?? 4);
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const rig = readJsonFile(join(jobDir(slug), "job.json")).value.rig;
const images = {};
const tiles = [];
for (const family of [undefined, ...FAMILIES]) {
  if (family !== undefined && !rig.layers.some((l) => l.variants?.[family] !== undefined)) continue;
  const img = resize(forge.cropImage(await restComposite(forge, rig, jobDir(slug), family, images), box), box[2] * k, box[3] * k);
  text(img, (family ?? "neutral").toUpperCase(), 3, 3, [255, 255, 0], 2);
  tiles.push(img);
}
const W = tiles[0].width;
const H = tiles[0].height;
const cols = Math.min(4, tiles.length);
const sheet = Buffer.alloc(cols * W * Math.ceil(tiles.length / cols) * H * 4);
tiles.forEach((t, i) => {
  const ox = (i % cols) * W;
  const oy = Math.floor(i / cols) * H;
  for (let y = 0; y < H; y++) Buffer.from(t.data.buffer, t.data.byteOffset + y * W * 4, W * 4).copy(sheet, ((oy + y) * cols * W + ox) * 4);
});
for (let i = 3; i < sheet.length; i += 4) sheet[i] = 255;
await sharp(sheet, { raw: { width: cols * W, height: Math.ceil(tiles.length / cols) * H, channels: 4 } }).png().toFile(out);
console.log(`zoom: ${slug}: ${out}`);
