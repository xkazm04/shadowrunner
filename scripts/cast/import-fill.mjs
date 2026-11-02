// Imports a fill edit for a cast character (cast-forge design.md step 3):
//   node scripts/cast/import-fill.mjs <slug> <edit.png|jpg>
// The image tool re-renders at its own size (1254 px for Codex CLI), so the edit is area-resized
// to the portrait's size and stored as assets/characters/cast/<slug>/fill.jpg (quality 92, about a
// fifth of a PNG). Only the lifted regions of it ever reach the plate (`composePlate`), so the JPEG
// loss and the edit's whole-image re-render never show outside them. Prints the mean difference
// to the portrait so a drifting edit (framing, colours) is caught before it is used.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runnerImport } from "vite";
import { resize } from "./measure.mjs";

const [slug, source] = process.argv.slice(2);
if (!slug || !source) throw new Error("usage: node scripts/cast/import-fill.mjs <slug> <edit image>");
const dir = join("assets", "characters", "cast", slug);
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const require = createRequire(join(process.cwd(), "packages", "forge", "package.json"));
const { encode } = require("jpeg-js");

const read = (path) => {
  const decoded = forge.decodeImage(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) throw new Error(`import-fill: ${path}: ${decoded.errors.message}`);
  return decoded.value;
};
const portrait = read(join(dir, "portrait.png"));
const fill = resize(read(source), portrait.width, portrait.height);
let diff = 0;
for (let i = 0; i < fill.data.length; i += 4) for (let c = 0; c < 3; c++) diff += Math.abs(fill.data[i + c] - portrait.data[i + c]);
const jpeg = encode({ width: fill.width, height: fill.height, data: Buffer.from(fill.data) }, 92).data;
writeFileSync(join(dir, "fill.jpg"), jpeg);
console.log(`import-fill: ${slug}: ${fill.width}x${fill.height}, mean |edit - portrait| ${(diff / (fill.width * fill.height * 3)).toFixed(1)}/255, ${(jpeg.length / 1024).toFixed(0)} KB`);
