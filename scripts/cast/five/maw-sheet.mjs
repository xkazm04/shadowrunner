// Review aid (cast-face-pass, WP1b): a character's mouth at 2x with maw boxes drawn on the portrait:
//   node scripts/cast/five/maw-sheet.mjs <slug> <out.png> <label:left,right,upper,seam,lower> [...]
// Each box: corners (vertical lines), upper and lower (horizontal), seam (dashed). Nothing it draws ships.
import { join } from "node:path";
import sharp from "sharp";
import { readJsonFile } from "../../forge-lib.mjs";
import { jobDir } from "./lib.mjs";

const [slug, out, ...boxes] = process.argv.slice(2);
const job = readJsonFile(join(jobDir(slug), "job.json")).value;
const parsed = boxes.map((b) => {
  const [label, nums] = b.split(":");
  const [left, right, upper, seam, lower] = nums.split(",").map(Number);
  return { label, left, right, upper, seam, lower };
});
const x0 = Math.min(...parsed.map((b) => b.left)) - 40;
const x1 = Math.max(...parsed.map((b) => b.right)) + 40;
const y0 = Math.min(...parsed.map((b) => b.upper)) - 50;
const y1 = Math.max(...parsed.map((b) => b.lower)) + 50;
const w = x1 - x0;
const h = y1 - y0;
const { data } = await sharp(join(jobDir(slug), job.portrait)).extract({ left: x0, top: y0, width: w, height: h }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const RGB = [[0, 255, 0], [255, 0, 255], [255, 255, 0], [0, 255, 255]];
const dot = (x, y, c) => x >= 0 && y >= 0 && x < w && y < h && data.set([...c, 255], (y * w + x) * 4);
parsed.forEach((b, i) => {
  const c = RGB[i % RGB.length];
  const o = i; // boxes offset by a px each so they do not hide each other
  for (let y = b.upper; y <= b.lower; y++) dot(b.left - x0 - o, y - y0, c), dot(b.right - x0 + o, y - y0, c);
  for (let x = b.left; x <= b.right; x++) {
    dot(x - x0, b.upper - y0 - o, c);
    dot(x - x0, b.lower - y0 + o, c);
    if (x % 6 < 3) dot(x - x0, b.seam - y0, c);
  }
  console.log(`maw-sheet: ${b.label} = ${["green", "magenta", "yellow", "cyan"][i % 4]}`);
});
await sharp(data, { raw: { width: w, height: h, channels: 4 } }).resize(w * 3, h * 3, { kernel: "nearest" }).png().toFile(out);
console.log(`maw-sheet: ${slug}: ${out}`);
