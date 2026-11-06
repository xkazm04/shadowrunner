// The mouth belongs to the head and jaw (cast-face-pass): a layer in front of them (a hood, a hat) that
// the cut gave part of a painted maw would keep those teeth still while the maw warp moves the head's
// and jaw's. This moves its pixels inside the rig's maw box (Rig.mouth.lips, grown by MARGIN px) to the
// jaw where the jaw's bbox holds them, else to the head (both hold the portrait's colour there with alpha
// 0, as the cut leaves what lies under a layer in front), and leaves them transparent in the layer.
//   node scripts/cast/move-mouth.mjs <slug> <layer> [--margin px] [--dry]
// (a wide margin puts the box's edge where the warp's window no longer reaches: the Announcer, 40)
// `--grow-jaw` instead (a grin wider than its jaw: Lot Ninety): the jaw takes the lower teeth row
// and its ink, per column from the gap's dark line (followed outward from the seam, as measureMaw
// does) down to where the skin starts (SKIN_ROWS rows within SKIN_LUMA of the skin under the grin),
// across the maw's corners; the head keeps the mouth's dark ink there (what an open jaw shows).
//   node scripts/cast/move-mouth.mjs <slug> --grow-jaw [--dry]
// Rewrites the three PNGs (encodePng) in assets/replay/forge/<slug>/; re-run regions.mjs <slug> after.
// No network, no model.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { readJsonFile, writeJsonFile } from "../forge-lib.mjs";
import { decode, jobDir } from "./face-lib.mjs";

export const MARGIN = 6;
/** --grow-jaw: the skin starts where SKIN_ROWS rows in a row lie within SKIN_LUMA of the skin under the grin. */
export const SKIN_ROWS = 3;
export const SKIN_LUMA = 18;

const args = process.argv.slice(2);
const slug = args[0];
const name = args[1];
const grow = args.includes("--grow-jaw");
const dry = args.includes("--dry");
const margin = args.includes("--margin") ? Number(args[args.indexOf("--margin") + 1]) : MARGIN;
if (slug === undefined || name === undefined) throw new Error("usage: node scripts/cast/move-mouth.mjs <slug> (<layer> | --grow-jaw) [--dry]");
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const dir = jobDir(slug);
const job = readJsonFile(join(dir, "job.json"));
const rig = job.value.rig;
const lips = rig.mouth?.lips;
if (lips === undefined) throw new Error(`move-mouth: ${slug} has no rig.mouth.lips`);
const head = rig.layers.find((l) => l.kind === "head");
const jaw = rig.layers.find((l) => l.kind === "jaw");
const from = grow ? head : rig.layers.find((l) => l.name === name);
const img = new Map([from, head, jaw].map((l) => [l.name, decode(forge, join(dir, l.file))]));
const at = (layer, x, y) => {
  const im = img.get(layer.name);
  const lx = x - layer.bbox[0];
  const ly = y - layer.bbox[1];
  return lx < 0 || ly < 0 || lx >= im.width || ly >= im.height ? -1 : (ly * im.width + lx) * 4;
};
const save = () => {
  if (dry) return;
  for (const layer of new Set([from, head, jaw])) writeFileSync(join(dir, layer.file), forge.encodePng(img.get(layer.name)));
  writeJsonFile(join(dir, "job.json"), job.value, job);
};

if (grow) {
  // The rest art (head, then the jaw over it) and its luma.
  const rgb = (x, y) => {
    const j = at(jaw, x, y);
    if (j >= 0 && img.get(jaw.name).data[j + 3] >= 128) return [...img.get(jaw.name).data.subarray(j, j + 3)];
    const h = at(head, x, y);
    return h < 0 ? [0, 0, 0] : [...img.get(head.name).data.subarray(h, h + 3)];
  };
  const luma = (x, y) => {
    const [r, g, b] = rgb(x, y);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const below = [];
  for (let y = Math.round(lips.lower) + 8; y < Math.round(lips.lower) + 24; y++) for (let x = Math.round(lips.left) + 20; x < Math.round(lips.right) - 20; x++) below.push(luma(x, y));
  const skin = below.sort((p, q) => p - q)[below.length >> 1];
  const cx = Math.round((lips.left + lips.right) / 2);
  const cols = new Map();
  for (const dirX of [-1, 1]) {
    let y = Math.round(lips.seam ?? rig.mouth.lineY);
    for (let x = dirX < 0 ? cx : cx + 1; x >= Math.floor(lips.left) && x <= Math.ceil(lips.right); x += dirX) {
      let best = y;
      for (const k of [0, -1, 1, -2, 2, -3, 3]) if (luma(x, y + k) < luma(x, best)) best = y + k;
      y = best;
      let bottom = y;
      for (let yy = y + 1, run = 0; yy <= lips.lower + 12 && run < SKIN_ROWS; yy++) {
        if (Math.abs(luma(x, yy) - skin) < SKIN_LUMA) run++;
        else {
          run = 0;
          bottom = yy;
        }
      }
      cols.set(x, [y + 1, bottom]);
    }
  }
  const ink = [];
  for (const [x, [y0, y1]] of cols) for (let y = y0; y <= y1; y++) if (luma(x, y) < 60) ink.push(rgb(x, y));
  const dark = [0, 1, 2].map((c) => ink.map((v) => v[c]).sort((p, q) => p - q)[ink.length >> 1] ?? 10);
  const xs = [...cols.keys()];
  const nx0 = Math.min(jaw.bbox[0], ...xs);
  const ny0 = Math.min(jaw.bbox[1], ...[...cols.values()].map((v) => v[0]));
  const nx1 = Math.max(jaw.bbox[0] + jaw.bbox[2], Math.max(...xs) + 1);
  const ny1 = Math.max(jaw.bbox[1] + jaw.bbox[3], ...[...cols.values()].map((v) => v[1] + 1));
  const nw = nx1 - nx0;
  const nh = ny1 - ny0;
  const old = img.get(jaw.name);
  const next = { width: nw, height: nh, data: new Uint8ClampedArray(nw * nh * 4) };
  for (let y = 0; y < old.height; y++) for (let x = 0; x < old.width; x++) next.data.set(old.data.subarray((y * old.width + x) * 4, (y * old.width + x) * 4 + 4), ((y + jaw.bbox[1] - ny0) * nw + x + jaw.bbox[0] - nx0) * 4);
  let moved = 0;
  const hd = img.get(head.name);
  for (const [x, [y0, y1]] of cols) {
    for (let y = y0; y <= y1; y++) {
      const o = ((y - ny0) * nw + (x - nx0)) * 4;
      // Under the whole lower row the head shows the mouth's ink (the plate there was the fill's skin).
      const h = at(head, x, y);
      if (h >= 0) hd.data.set([...dark, 255], h);
      if (next.data[o + 3] >= 128) continue;
      next.data.set([...rgb(x, y), 255], o);
      moved++;
    }
  }
  // What the jaw held above the gap's line (the upper teeth's lower edge) goes back to the head.
  let back = 0;
  for (const [x, [y0]] of cols) {
    for (let y = ny0; y < y0; y++) {
      const o = ((y - ny0) * nw + (x - nx0)) * 4;
      const h = at(head, x, y);
      if (next.data[o + 3] === 0 || h < 0) continue;
      hd.data.set(next.data.subarray(o, o + 4), h);
      next.data[o + 3] = 0;
      back++;
    }
  }
  if (back > 0) console.log(`move-mouth: ${slug}: --grow-jaw: ${back} px above the gap's line back to the head`);
  img.set(jaw.name, next);
  const layer = job.value.rig.layers.find((l) => l.name === jaw.name);
  layer.bbox = [nx0, ny0, nw, nh];
  console.log(`move-mouth: ${slug}: --grow-jaw: skin luma ${skin.toFixed(0)}, ${moved} px of the lower row moved into the jaw, now ${layer.bbox.join(",")}${dry ? " (dry)" : ""}`);
  save();
} else {
  let moved = 0;
  const src = img.get(from.name);
  for (let y = Math.floor(lips.upper - margin); y <= Math.ceil(lips.lower + margin); y++) {
    for (let x = Math.floor(lips.left - margin); x <= Math.ceil(lips.right + margin); x++) {
      const i = at(from, x, y);
      if (i < 0 || src.data[i + 3] === 0) continue;
      const to = at(jaw, x, y) >= 0 && y >= jaw.bbox[1] ? jaw : head;
      const j = at(to, x, y);
      if (j < 0) continue;
      const dst = img.get(to.name);
      // Over what the layer already holds there (the cut left it transparent, its colour the portrait's).
      const a = src.data[i + 3] / 255;
      const b = dst.data[j + 3] / 255;
      const out = a + b * (1 - a);
      for (let c = 0; c < 3; c++) dst.data[j + c] = Math.round(out === 0 ? src.data[i + c] : (src.data[i + c] * a + dst.data[j + c] * b * (1 - a)) / out);
      dst.data[j + 3] = Math.round(out * 255);
      src.data[i + 3] = 0;
      moved++;
    }
  }
  console.log(`move-mouth: ${slug}: ${moved} px of ${name} inside the maw box moved to ${head.name}/${jaw.name}${dry ? " (dry)" : ""}`);
  save();
}
