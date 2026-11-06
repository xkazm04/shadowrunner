// Expression faces for the non-human five (cast-face-pass, WP1b), after eyes.mjs:
//   node scripts/cast/five/faces.mjs <slug> [--families a,b] [--measure] [--force] [--composite a,b]
// Per family the Codex edits in var/cast-expr/<slug>/ are tried in order (<family>.png, then the
// stricter re-runs <family>.a1.png, <family>.a2.png): each is registered (`registerEdit`) and gated
// (`faceStability` + this character's own gaze track, recipes.mjs RECIPES `track`): iris drift <=
// IRIS_DRIFT_LIMIT and outside-band <= the no-op re-render's floor + OUTSIDE_BAND_MARGIN. `--composite`
// families instead re-cut the RECORDED face (the backup's patches, mouth patches left out) composited
// on the portrait, gated against the composite floor (the WebP round trip's own noise + the margin).
// The first stable source is taken only inside the brow+lid band (the character's reach) and cut
// (`cutVariants`); mouth layers (kind jaw) keep no face; each eye patch is socket-read (`faceEye`).
// A family with no stable source keeps no face. Numbers go to var/cast-expr/<slug>/stability.json.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { runnerImport } from "vite";
import { readJsonFile, writeJsonFile } from "../../forge-lib.mjs";
import { resize } from "../measure.mjs";
import { FAMILIES, FIVE_SLUGS, exprWork, eyesWork, hexRgb, jobDir, load, origDir, restComposite, softMask, webp } from "./lib.mjs";
import { RECIPES, dimSlitLight, faceEye, hotSpot, inpaintLight, restDrift, socketed } from "./recipes.mjs";

const ATTEMPTS = 3;
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const slug = args.find((a, i) => !a.startsWith("--") && !["--families", "--composite", "--probe"].includes(args[i - 1]));
if (!FIVE_SLUGS.includes(slug)) throw new Error(`usage: node scripts/cast/five/faces.mjs <${FIVE_SLUGS.join("|")}> [--families a,b] [--measure] [--force] [--composite a,b]`);
const composite = option("--composite")?.split(",") ?? [];
const families = option("--families")?.split(",") ?? FAMILIES;
const measure = args.includes("--measure");
const force = args.includes("--force");

const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const { module: orbs } = await runnerImport("/packages/forge/src/eyeOrb.ts");
const recipe = RECIPES[slug];
const reach = recipe.reach;
const dir = jobDir(slug);
const { orig, portrait, eyes } = await socketed(forge, orbs, slug);
const job = readJsonFile(join(dir, "job.json"));
const rig = job.value.rig;
const layers = new Map();
for (const layer of rig.layers) if (existsSync(join(dir, layer.file))) layers.set(layer.name, await load(join(dir, layer.file)));
const face = forge.faceShape(rig, layers);
const band = forge.browLidBand(rig, reach);
const byEye = new Map(eyes.map((e) => [e.name, e]));
const tint = hexRgb(rig.palette.eye);
const glowEyes = Object.fromEntries(eyes.filter((e) => e.kind === "glow" && recipe.track === "glow").map((e) => {
  const [bx, by] = rig.layers.find((l) => l.name === e.name).bbox;
  return [e.name, { bbox: rig.layers.find((l) => l.name === e.name).bbox, iris: { cx: bx + e.iris.cx, cy: by + e.iris.cy, r: e.iris.r }, look: "glow", tint }];
}));
const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

/** The character's own gaze track for rings (the interior's centre) and slits (the light's x). */
/**
 * Lantern Warden: a face's sockets are its recut holes from the mask edit of that face
 * (`<edit>.holes.png`, request.mjs --holes; green = open), cropped per eye; undefined without one.
 */
async function holesOf(file) {
  if (!existsSync(file)) return undefined;
  const mask = (await fit(file)).image;
  const bits = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < bits.length; i++) bits[i] = mask.data[i * 4 + 1] > 180 && mask.data[i * 4] < 110 && mask.data[i * 4 + 2] < 110 ? 1 : 0;
  return bits;
}
const holeCrop = (holes, [bx, by, bw, bh]) => {
  const out = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) out[y * bw + x] = holes[(by + y) * portrait.width + bx + x];
  return out;
};
/** One eye face, with the face's own holes when the character has them. */
function eyeFace(e, image, holes) {
  const v = faceEye(forge, e, image);
  if (holes === undefined) return v;
  const bbox = rig.layers.find((l) => l.name === e.name).bbox;
  const own = holeCrop(holes, bbox);
  // The face's own candle (wherever the edit lit it) painted out inside its holes: the player draws the iris.
  if (e.inpaint) v.image = inpaintLight(image, own);
  const narrowed = own.reduce((a, b) => a + b, 0) < forge.NARROW_SHARE * e.socket.reduce((a, b) => a + b, 0);
  return { ...v, socket: softMask(forge, own, bbox[2], bbox[3]), narrowed, drift: restDrift(own, bbox[2], e.iris, narrowed) };
}

function ownDrift(edited, holes) {
  const out = {};
  for (const e of eyes) {
    if (recipe.track === "rest") {
      const bbox = rig.layers.find((l) => l.name === e.name).bbox;
      const a = hotSpot(forge.cropImage(portrait, bbox));
      const b = hotSpot(forge.cropImage(edited, bbox));
      out[`${e.name} hot spot (reported)`] = a === undefined || b === undefined ? "unsure" : `${Math.hypot(b.cx - a.cx, b.cy - a.cy).toFixed(1)}`;
      out[e.name] = holes === undefined ? "no holes mask" : eyeFace(e, forge.cropImage(edited, bbox), holes).drift;
      continue;
    }
    if (e.kind !== "ring" && e.kind !== "slit") continue;
    const bbox = rig.layers.find((l) => l.name === e.name).bbox;
    const v = faceEye(forge, e, forge.cropImage(edited, bbox));
    out[e.name] = v.drift;
  }
  return out;
}

function gate(edited, floor, holes) {
  const s = forge.faceStability(edited, portrait, rig, face, glowEyes, reach);
  const own = ownDrift(edited, holes);
  const all = { ...s.eyes, ...own };
  const moves = Object.values(all).filter((v) => typeof v === "number");
  const irisDriftPx = moves.length === 0 ? 0 : Math.max(...moves);
  const blocked = Object.values(all).includes("no holes mask");
  return { irisDriftPx, outsideBandMean: s.outsideBandMean, bandMean: s.bandMean, eyes: all, stable: !blocked && forge.isStable({ irisDriftPx, outsideBandMean: s.outsideBandMean }, floor) };
}

/** `edited` kept only inside the band (the portrait elsewhere), so no layer outside it changes. */
function inBand(edited) {
  const data = portrait.data.slice();
  for (let i = 0; i < portrait.width * portrait.height; i++) {
    const k = band.data[i] / 255;
    if (k > 0) for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(portrait.data[i * 4 + c] * (1 - k) + edited.data[i * 4 + c] * k);
  }
  return { ...portrait, data };
}

const fit = async (file) => forge.registerEdit(resize(await load(file), portrait.width, portrait.height), portrait, rig, face, reach);
const noop = join(eyesWork(slug), "noop.png");
const editFloor = existsSync(noop) ? forge.faceStability((await fit(noop)).image, portrait, rig, face, {}, reach).outsideBandMean : undefined;

// The recorded faces as composites: the backup rig at rest with one family's head/eye/brow faces
// (mouth faces left out) over the same rig neutral; where they differ, the portrait takes the face.
const origRig = orig.value.rig;
const origImages = {};
for (const l of origRig.layers) for (const f of [l.file, ...Object.values(l.variants ?? {}).map((p) => p.file)]) origImages[f] ??= await load(existsSync(join(origDir(slug), f)) ? join(origDir(slug), f) : join(dir, f));
const noMouth = { ...origRig, layers: origRig.layers.map((l) => (l.kind === "jaw" ? { ...l, variants: undefined } : l)) };
const neutral = composite.length > 0 ? await restComposite(forge, noMouth, origDir(slug), undefined, origImages) : undefined;
async function recordedFace(family) {
  const withFace = await restComposite(forge, noMouth, origDir(slug), family, origImages);
  const data = portrait.data.slice();
  for (let i = 0; i < data.length; i += 4) if (withFace.data[i] !== neutral.data[i] || withFace.data[i + 1] !== neutral.data[i + 1] || withFace.data[i + 2] !== neutral.data[i + 2]) data.set(withFace.data.subarray(i, i + 3), i);
  return { ...portrait, data };
}
// The composite floor: the portrait through the faces' own WebP (q88) and back, outside the band.
const raw = await sharp(await webp(portrait)).ensureAlpha().raw().toBuffer();
const viaWebp = { ...portrait, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) };
const compositeFloor = forge.faceStability(viaWebp, portrait, rig, face, {}, reach).outsideBandMean;
console.log(`faces: ${slug}: edit floor ${editFloor?.toFixed(2) ?? "none (no noop.png)"} -> limit ${forge.outsideLimit(editFloor).toFixed(2)}; composite floor ${compositeFloor.toFixed(2)} -> limit ${forge.outsideLimit(compositeFloor).toFixed(2)}; drift limit ${forge.IRIS_DRIFT_LIMIT} px; reach ${JSON.stringify(reach)}`);

// --probe <file>: gate one image (the no-op re-render: the track's own noise) and stop.
if (option("--probe") !== undefined) {
  const g = gate((await fit(option("--probe"))).image, editFloor);
  console.log(`faces: ${slug} probe ${option("--probe")}: drift ${g.irisDriftPx.toFixed(1)} px (${Object.entries(g.eyes).map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(1) : v}`).join(", ")}), outside ${g.outsideBandMean.toFixed(2)}, band ${g.bandMean.toFixed(2)}`);
  process.exit(0);
}
const statsPath = join(exprWork(slug), measure ? "stability.measure.json" : "stability.json");
const report = existsSync(statsPath) ? JSON.parse(readFileSync(statsPath, "utf8")) : {};
Object.assign(report, { editFloor: round(editFloor), editLimit: round(forge.outsideLimit(editFloor)), compositeFloor: round(compositeFloor), compositeLimit: round(forge.outsideLimit(compositeFloor)) });
for (const family of families) {
  const tries = [];
  let chosen;
  const sources = composite.includes(family) ? [{ attempt: "recorded", image: await recordedFace(family), floor: compositeFloor }] : [];
  for (let n = 0; n < ATTEMPTS && !composite.includes(family); n++) {
    const file = join(exprWork(slug), n === 0 ? `${family}.png` : `${family}.a${n}.png`);
    if (existsSync(file)) {
      const fitted = await fit(file);
      const holes = recipe.track === "rest" ? await holesOf(file.replace(/\.png$/, ".holes.png")) : undefined;
      sources.push({ attempt: n, image: fitted.image, holes, floor: editFloor, registered: { scale: round(fitted.scale), dx: fitted.dx, dy: fitted.dy } });
    }
  }
  for (const src of sources) {
    const g = gate(src.image, src.floor, src.holes);
    tries.push({ attempt: src.attempt, ...(src.registered === undefined ? {} : { registered: src.registered }), irisDriftPx: round(g.irisDriftPx), outsideBandMean: round(g.outsideBandMean), bandMean: round(g.bandMean), eyes: Object.fromEntries(Object.entries(g.eyes).map(([k, v]) => [k, round(v)])), stable: g.stable });
    console.log(`faces: ${slug} ${family} ${src.attempt}: drift ${g.irisDriftPx.toFixed(1)} px (${Object.entries(g.eyes).map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(1) : v}`).join(", ")}), outside ${g.outsideBandMean.toFixed(2)} (limit ${forge.outsideLimit(src.floor).toFixed(2)}), band ${g.bandMean.toFixed(2)} -> ${g.stable ? "stable" : "REFUSED"}`);
    if (g.stable || force) {
      chosen = src;
      break;
    }
  }
  report[family] = { tries, used: chosen?.attempt ?? "none" };
  if (measure) continue;
  for (const layer of rig.layers) {
    const old = layer.variants?.[family];
    if (old === undefined) continue;
    for (const f of [old.file, old.socket]) if (f !== undefined) rmSync(join(dir, f), { force: true });
    delete layer.variants[family];
    if (Object.keys(layer.variants).length === 0) delete layer.variants;
  }
  if (chosen === undefined) {
    console.log(`faces: ${slug} ${family}: no stable source; no face`);
    continue;
  }
  // A band cut (also on the Vicar's one-piece eyes) patches no jaw layer: the mouth stays the art's.
  const cut = forge.cutVariants(rig, layers, portrait, inBand(chosen.image), family, reach, { band: true });
  const notes = [];
  for (const [name, { patch, image }] of Object.entries(cut.patches)) {
    const layer = rig.layers.find((l) => l.name === name);
    if (layer.kind === "jaw") {
      notes.push(`${name} dropped (mouth stays art)`);
      continue;
    }
    const next = { ...patch, file: patch.file.replace(/\.png$/, ".webp") };
    let art = image;
    if (recipe.kind === "slit" && layer.kind === "head") art = dimSlitLight(image);
    // Lantern: a recut hole reaching past the eye layer lights the head's face too; its candle goes the same way.
    if (recipe.track === "rest" && layer.kind === "head" && chosen.holes !== undefined) art = inpaintLight(image, holeCrop(chosen.holes, patch.bbox));
    const eye = byEye.get(name);
    if (eye !== undefined) {
      const v = eyeFace(eye, image, chosen.holes);
      art = v.image;
      // A glow eye's face is the edit edge to edge: its soft rim would show the head's base (the
      // unlit plate) between it and the head's face, a ring around the eye; the rim is made solid.
      if (eye.kind === "glow") art = { ...art, data: art.data.map((c, i) => (i % 4 === 3 && c > 0 ? 255 : c)) };
      if (v.socket !== undefined) {
        next.socket = `${name}.${family}.socket.png`;
        writeFileSync(join(dir, next.socket), forge.encodePng(v.socket));
      }
      if (v.narrowed) next.narrowed = true;
      notes.push(`${name} ${typeof v.drift === "number" ? `${v.drift.toFixed(1)} px` : v.drift}${v.narrowed ? " narrowed" : ""}`);
    }
    writeFileSync(join(dir, next.file), await webp(art));
    layer.variants = { ...layer.variants, [family]: next };
  }
  report[family].patches = Object.keys(cut.patches).filter((n) => rig.layers.find((l) => l.name === n).kind !== "jaw");
  console.log(`faces: ${slug} ${family}: faces ${report[family].patches.join(", ") || "none"}${notes.length > 0 ? `; ${notes.join("; ")}` : ""}`);
}
mkdirSync(exprWork(slug), { recursive: true });
writeFileSync(statsPath, `${JSON.stringify(report, null, 2)}\n`);
if (!measure) writeJsonFile(join(dir, "job.json"), job.value, job);
