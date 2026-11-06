// Expression faces for a character with socketed eyes (face-control, WP-B), run by expressions.mjs
// --import for the slugs of face-lib.mjs CAST_EYES. Per family, the edits in var/cast-expr/<slug>/
// are tried in order (`<family>.png`, then the stricter re-runs `<family>.a1.png`, `<family>.a2.png`):
// the first whose `faceStability` against the portrait is inside the limits (IRIS_DRIFT_LIMIT,
// OUTSIDE_BAND_LIMIT; `--force` takes the first edit regardless) is cut (`cutVariants`, cut to the
// brow+lid band), each socketed eye's patch re-read by `socketVariant` (iris painted out, its own
// socket `<eye>.<family>.socket.png`, `narrowed`), and its faces written as WebP q88 with lossless
// alpha (as the faces of character-control task 5). A family with no passing edit keeps no face (it
// stays procedural). Jaw faces that are byte-identical across every family are dropped. Every attempt's
// numbers go to var/cast-expr/<slug>/stability.json. `--measure` prints them and writes nothing else.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { readJsonFile, writeJsonFile } from "../forge-lib.mjs";
import { decode, jobDir, socketing, stabilityEyes } from "./face-lib.mjs";
import { resize } from "./measure.mjs";

/** The committed expression faces' WebP (character-control task 5): q88, alpha lossless. */
export const FACE_WEBP = { quality: 88, alphaQuality: 100, effort: 6 };
export const ATTEMPTS = 3;

async function webp(image) {
  const raw = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return sharp(raw, { raw: { width: image.width, height: image.height, channels: 4 } }).webp(FACE_WEBP).toBuffer();
}

const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

export async function importSocketed({ forge, slug, families, work, force, measure }) {
  const dir = jobDir(slug);
  const { portrait, out } = socketing(forge, slug);
  const job = readJsonFile(join(dir, "job.json"));
  const rig = job.value.rig;
  const layers = new Map();
  for (const layer of rig.layers) if (layer.file.endsWith(".png") && existsSync(join(dir, layer.file))) layers.set(layer.name, decode(forge, join(dir, layer.file)));
  const face = forge.faceShape(rig, layers);
  const eyes = stabilityEyes(rig, out.eyes);
  const byEye = new Map(out.eyes.map((e) => [e.name, e]));
  // The re-render floor: the iris-free edit (same editor, same portrait) changes nothing outside the eyes.
  const irisFree = join("var", "cast-eyes", slug, "iris-free.png");
  const floor = existsSync(irisFree) ? forge.faceStability(forge.registerEdit(resize(decode(forge, irisFree), portrait.width, portrait.height), portrait, rig, face).image, portrait, rig, face, {}).outsideBandMean : undefined;
  console.log(`expressions: ${slug}: re-render floor ${floor === undefined ? "none" : floor.toFixed(2)}, outside-band limit ${forge.outsideLimit(floor).toFixed(2)}, iris drift limit ${forge.IRIS_DRIFT_LIMIT} px`);
  const report = { floor: round(floor), limit: round(forge.outsideLimit(floor)) };
  for (const family of families) {
    const tries = [];
    let chosen;
    for (let n = 0; n < ATTEMPTS && chosen === undefined; n++) {
      const file = join(work, n === 0 ? `${family}.png` : `${family}.a${n}.png`);
      if (!existsSync(file)) continue;
      const fitted = forge.registerEdit(resize(decode(forge, file), portrait.width, portrait.height), portrait, rig, face);
      const edited = fitted.image;
      const s = forge.faceStability(edited, portrait, rig, face, eyes);
      const ok = forge.isStable(s, floor);
      tries.push({ attempt: n, registered: { scale: round(fitted.scale), dx: fitted.dx, dy: fitted.dy }, irisDriftPx: round(s.irisDriftPx), outsideBandMean: round(s.outsideBandMean), bandMean: round(s.bandMean), eyes: Object.fromEntries(Object.entries(s.eyes).map(([k, v]) => [k, round(v)])), stable: ok });
      console.log(`expressions: ${slug} ${family} attempt ${n} (fit x${fitted.scale.toFixed(3)} ${fitted.dx},${fitted.dy}): iris drift ${s.irisDriftPx.toFixed(1)} px (${Object.entries(s.eyes).map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(1) : v}`).join(", ")}), outside band ${s.outsideBandMean.toFixed(2)}, band ${s.bandMean.toFixed(2)} -> ${ok ? "stable" : "REFUSED"}`);
      if (ok || force) chosen = edited;
    }
    report[family] = { tries, used: chosen === undefined ? "none" : tries[tries.length - 1].attempt };
    if (measure) continue;
    for (const layer of rig.layers) {
      const old = layer.variants?.[family];
      if (old === undefined) continue;
      for (const f of [old.file, old.socket]) if (f !== undefined) rmSync(join(dir, f), { force: true });
      delete layer.variants[family];
      if (Object.keys(layer.variants).length === 0) delete layer.variants;
    }
    if (chosen === undefined) {
      console.log(`expressions: ${slug} ${family}: no stable edit${tries.length < ATTEMPTS ? ` (re-run: expressions.mjs ${slug} --request --families ${family} --attempt ${tries.length})` : ""}; no face`);
      continue;
    }
    const cut = forge.cutVariants(rig, layers, portrait, chosen, family);
    const notes = [];
    for (const [name, { patch, image }] of Object.entries(cut.patches)) {
      const eye = byEye.get(name);
      let art = image;
      const next = { ...patch, file: patch.file.replace(/\.png$/, ".webp") };
      if (eye !== undefined) {
        const v = forge.socketVariant(eye, image);
        art = v.image;
        next.socket = `${name}.${family}.socket.png`;
        writeFileSync(join(dir, next.socket), forge.encodePng(v.socket));
        if (v.narrowed) next.narrowed = true;
        notes.push(`${name} iris ${typeof v.drift === "number" ? `${v.drift.toFixed(1)} px` : v.drift}${v.narrowed ? " narrowed" : ""}${v.socketFromBase ? " (socket: the base's)" : ""}`);
      }
      writeFileSync(join(dir, next.file), await webp(art));
      const layer = rig.layers.find((l) => l.name === name);
      layer.variants = { ...layer.variants, [family]: next };
    }
    report[family].patches = Object.keys(cut.patches);
    console.log(`expressions: ${slug} ${family}: faces ${Object.keys(cut.patches).join(", ") || "none"}${notes.length > 0 ? `; ${notes.join("; ")}` : ""}`);
  }
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, measure ? "stability.measure.json" : "stability.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (measure) return;
  for (const jaw of rig.layers.filter((l) => l.kind === "jaw" && l.variants !== undefined)) {
    const files = Object.values(jaw.variants).map((p) => p.file);
    const first = readFileSync(join(dir, files[0]));
    if (files.length < 2 || !files.every((f) => readFileSync(join(dir, f)).equals(first))) continue;
    for (const f of files) rmSync(join(dir, f), { force: true });
    delete jaw.variants;
    console.log(`expressions: ${slug}: ${jaw.name}'s ${files.length} faces are byte-identical: dropped`);
  }
  writeJsonFile(join(dir, "job.json"), job.value, job);
}
