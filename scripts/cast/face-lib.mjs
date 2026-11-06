// Shared by the face-control cast tools (eyes.mjs, expressions.mjs, face-sheet.mjs): the socketing
// of a recorded character's eyes from its backup (var/cast-eyes/<slug>/orig/, written by eyes.mjs on
// its first run), image loading for PNG and WebP, the rig at rest with one expression face on (iris
// layers clipped by the active socket, as the player draws them), and the eyes `faceStability` follows.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { readJsonFile } from "../forge-lib.mjs";
import { resize } from "./measure.mjs";

/**
 * Per character, how its eyes are drawn (face-control): `white` eyes take their whites from the
 * iris-free edit; `glow` and `dark` eyes have no white, so the edit (which gave them human whites)
 * only measures the opening and the socket under the iris is filled procedurally (eyeArt.ts).
 */
export const CAST_EYES = {
  "saint-cardia": { look: "white" },
  "sister-vesper": { look: "white" },
  // Her eyes are thin slits (43 x 25 px) under bold ink brows 30-35 px above them that the faces raise
  // to 70 px: the band reaches 1.7 eye widths up (LID_BAND_ABOVE's 0.9 cut her brows in half, owner board 2026-11-06).
  // `pin`: her approved eyes came from the second joy and showman edits; the wider band would take the first.
  // `brows`: anger, gloom and suspicion drew her brows thin or faint; their brows come from an INK_BROWS edit.
  "auntie-asp": { look: "glow", band: { above: 1.7 }, pin: { joy: 1, showman: 1 }, brows: { anger: "ink", gloom: "ink", suspicion: "ink" }, why: "glowing orange slits with no iris drawn: the iris is the brightest disc of the light" },
  "moth-widow": { look: "dark", why: "dark compound eyes with no white: the iris is the largest disc of the eyeball" },
};

export const jobDir = (slug) => join("assets", "replay", "forge", slug);
export const workDir = (slug) => join("var", "cast-eyes", slug);
export const origDir = (slug) => join(workDir(slug), "orig");

/** Raw RGBA of a PNG, JPEG or WebP file as the forge's Rgba. */
export async function load(path) {
  const { data, info } = await sharp(readFileSync(path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** The forge's own decoder (PNG, JPEG), as the cut steps read the layers. */
export function decode(forge, path) {
  const decoded = forge.decodeImage(new Uint8Array(readFileSync(path)));
  if (!decoded.ok) throw new Error(`${path}: ${decoded.errors.message}`);
  return decoded.value;
}

/**
 * The socketing of `slug`'s eyes from the backup: `socketEyes` on the original rig and eye files with
 * the character's look, the iris-free edit and the mask edit when present. Deterministic, so every
 * tool gets the same irises and sockets eyes.mjs wrote.
 */
export function socketing(forge, slug) {
  const orig = readJsonFile(join(origDir(slug), "job.json"));
  const rig = orig.value.rig;
  const portrait = decode(forge, join(jobDir(slug), orig.value.portrait));
  const images = {};
  for (const layer of rig.layers) images[layer.file] = decode(forge, layer.kind === "eye" ? join(origDir(slug), layer.file) : join(jobDir(slug), layer.file));
  const { look } = CAST_EYES[slug];
  const looks = Object.fromEntries(rig.layers.filter((l) => l.kind === "eye").map((l) => [l.name, look]));
  const edit = (name) => (existsSync(join(workDir(slug), name)) ? resize(decode(forge, join(workDir(slug), name)), portrait.width, portrait.height) : undefined);
  const clean = edit("iris-free.png");
  const marks = edit("eye-marks.png");
  const closed = edit("closed.png");
  if (look === "white" && clean === undefined) throw new Error(`${slug}: no ${join(workDir(slug), "iris-free.png")}; run eyes.mjs --request and Codex first`);
  const out = forge.socketEyes(rig, images, { looks, ...(clean === undefined ? {} : { clean }), ...(marks === undefined ? {} : { marks }), ...(closed === undefined ? {} : { closed }) });
  return { orig, portrait, images, out };
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The eyes `faceStability` follows: per socketed eye, its bbox, its iris in canvas px and look. */
export function stabilityEyes(rig, eyes) {
  const tint = hexRgb(rig.palette.eye);
  return Object.fromEntries(
    eyes.map((e) => {
      const layer = rig.layers.find((l) => l.name === e.name);
      const [bx, by] = layer.bbox;
      return [e.name, { bbox: layer.bbox, iris: { cx: bx + e.iris.cx, cy: by + e.iris.cy, r: e.iris.r }, look: e.look, tint }];
    }),
  );
}

/**
 * The rig at rest with `family`'s faces on (or none): patches drawn in place of (`replace`) or over
 * their layer, iris layers clipped by their eye's active socket (the face's own, else the base's).
 * `images` by file name; files missing from it are loaded from `dir`.
 */
export async function restComposite(forge, rig, dir, family, images = {}) {
  const get = async (file) => (images[file] ??= await load(join(dir, file)));
  const layers = [];
  const files = {};
  const sockets = {};
  for (const layer of rig.layers) {
    const patch = family === undefined ? undefined : layer.variants?.[family];
    const socket = patch?.socket ?? layer.socket;
    if (socket !== undefined) sockets[layer.name] = { bbox: layer.bbox, mask: await get(socket) };
    if (patch !== undefined && patch.mode === "replace") {
      layers.push({ ...layer, bbox: patch.bbox, file: patch.file });
      files[patch.file] = await get(patch.file);
      continue;
    }
    layers.push({ ...layer });
    files[layer.file] = await get(layer.file);
    if (patch !== undefined) {
      layers.push({ ...layer, name: `${layer.name}.${family}`, z: layer.z + 0.5, bbox: patch.bbox, file: patch.file });
      files[patch.file] = await get(patch.file);
    }
  }
  for (const layer of layers) {
    const eye = layer.kind === "iris" ? sockets[layer.follow] : undefined;
    if (eye === undefined) continue;
    const img = files[layer.file];
    const data = img.data.slice();
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const sx = Math.round(layer.bbox[0] + x - eye.bbox[0]);
        const sy = Math.round(layer.bbox[1] + y - eye.bbox[1]);
        const inside = sx >= 0 && sy >= 0 && sx < eye.mask.width && sy < eye.mask.height ? eye.mask.data[(sy * eye.mask.width + sx) * 4 + 3] / 255 : 0;
        data[(y * img.width + x) * 4 + 3] = Math.round(data[(y * img.width + x) * 4 + 3] * inside);
      }
    }
    files[`${layer.file}#clipped`] = { ...img, data };
    layer.file = `${layer.file}#clipped`;
  }
  return forge.compositeRig({ ...rig, layers }, files);
}
