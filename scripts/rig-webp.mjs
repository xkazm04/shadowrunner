// Lossless WebP for rig layer images (asset-webp task; docs/rig-format.md "Layer files").
//
//   node scripts/rig-webp.mjs <dir> [--json a.json,b.json] [--keep x.png] [--skip p.png] [--dry]
// --keep converts but leaves the PNG (a test pins it); --skip leaves the file alone entirely.
//
// Every `*.png` directly in <dir> (not recursive) becomes a sibling `.webp` encoded lossless with
// `exact` (so even the colour under alpha 0 survives), then the script decodes both and refuses
// to go on unless every RGBA byte is equal. Then the PNG is deleted, except the `--keep` names,
// and each `--json` file (relative to <dir>) has its quoted `"name.png"` strings for the
// converted files rewritten in place (text replace: formatting and key order untouched).
// Deterministic: the same input bytes and sharp version give the same output bytes.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

export const WEBP_OPTIONS = { lossless: true, exact: true, effort: 6 };

/** Raw RGBA of an encoded image (no premultiply, no colour management). */
export async function rgba(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** PNG bytes -> lossless WebP bytes; throws unless the decoded pixels are bit-identical. */
export async function toWebp(png, label = "image") {
  const webp = await sharp(png).webp(WEBP_OPTIONS).toBuffer();
  const [a, b] = await Promise.all([rgba(png), rgba(webp)]);
  if (a.width !== b.width || a.height !== b.height || !a.data.equals(b.data)) throw new Error(`${label}: decoded pixels differ after WebP`);
  return webp;
}

async function main(argv) {
  const [dir, ...rest] = argv;
  if (dir === undefined) throw new Error("usage: rig-webp.mjs <dir> [--json a,b] [--keep x,y] [--skip p,q] [--dry]");
  const opt = (name) => (rest.includes(name) ? (rest[rest.indexOf(name) + 1] ?? "").split(",").filter(Boolean) : []);
  const keep = new Set(opt("--keep"));
  const skip = new Set(opt("--skip"));
  const dry = rest.includes("--dry");
  const pngs = readdirSync(dir).filter((f) => f.endsWith(".png") && !skip.has(f)).sort();
  let before = 0;
  let after = 0;
  for (const file of pngs) {
    const png = readFileSync(join(dir, file));
    const webp = await toWebp(png, file);
    before += png.length;
    after += webp.length;
    if (dry) continue;
    writeFileSync(join(dir, file.replace(/\.png$/, ".webp")), webp);
    if (!keep.has(file)) rmSync(join(dir, file));
    console.log(`${file}: ${png.length} -> ${webp.length}`);
  }
  if (!dry) {
    for (const json of opt("--json")) {
      const path = join(dir, json);
      if (!existsSync(path)) continue;
      let text = readFileSync(path, "utf8");
      for (const file of pngs) text = text.split(`"${file}"`).join(`"${file.replace(/\.png$/, ".webp")}"`);
      writeFileSync(path, text);
    }
  }
  console.log(`${pngs.length} files, ${before} -> ${after} bytes (${((after / before) * 100).toFixed(1)}%)`);
}

if (process.argv[1]?.endsWith("rig-webp.mjs")) await main(process.argv.slice(2));
