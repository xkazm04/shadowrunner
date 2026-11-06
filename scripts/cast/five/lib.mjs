// Shared by the non-human five's tools (cast-face-pass, WP1b: eyes.mjs, faces.mjs, sheet runs): the
// backup of a character's recorded job (var/cast-eyes/<slug>/orig/, written on the first run; every
// run starts from it, so the tools can be re-run), image I/O, bit masks, and the per-character band
// reach. The face-control tools (face-lib.mjs CAST_EYES) serve the painterly four; these five are not
// in that table, so their recipes live here (scripts/cast/five/) and read the same folders.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { readJsonFile } from "../../forge-lib.mjs";

export const FIVE_SLUGS = ["announcer-of-dead-air", "lantern-warden", "reveille", "sir-vacant", "vicar-of-the-lure"];
export const FAMILIES = ["joy", "showman", "anger", "gloom", "smug", "suspicion"];
export const jobDir = (slug) => join("assets", "replay", "forge", slug);
export const eyesWork = (slug) => join("var", "cast-eyes", slug);
export const exprWork = (slug) => join("var", "cast-expr", slug);
export const origDir = (slug) => join(eyesWork(slug), "orig");

/**
 * The first run copies job.json, every eye file and every face (variant) file into orig/; later runs
 * read the recorded character from there. Returns the backup's job (readJsonFile: value, eol, trailing).
 */
export function backup(slug) {
  const orig = origDir(slug);
  if (!existsSync(join(orig, "job.json"))) {
    mkdirSync(orig, { recursive: true });
    const job = JSON.parse(readFileSync(join(jobDir(slug), "job.json"), "utf8"));
    copyFileSync(join(jobDir(slug), "job.json"), join(orig, "job.json"));
    for (const layer of job.rig.layers) {
      const files = [layer.kind === "eye" ? layer.file : undefined, ...Object.values(layer.variants ?? {}).map((p) => p.file)];
      for (const f of files) if (f !== undefined && existsSync(join(jobDir(slug), f))) copyFileSync(join(jobDir(slug), f), join(orig, f));
    }
  }
  return readJsonFile(join(orig, "job.json"));
}

/** A recorded file: the backup's copy when it has one (eyes, faces), else the job folder's. */
export const recorded = (slug, file) => (existsSync(join(origDir(slug), file)) ? join(origDir(slug), file) : join(jobDir(slug), file));

/** Raw RGBA of a PNG, JPEG or WebP file as the forge's Rgba. */
export async function load(path) {
  const { data, info } = await sharp(readFileSync(path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** The committed faces' WebP (character-control task 5): q88, alpha lossless. */
export const FACE_WEBP = { quality: 88, alphaQuality: 100, effort: 6 };
export async function webp(image) {
  const raw = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return sharp(raw, { raw: { width: image.width, height: image.height, channels: 4 } }).webp(FACE_WEBP).toBuffer();
}

/** The recorded rig's layer images by file (eyes and faces from the backup). */
export async function recordedImages(slug, rig) {
  const images = {};
  for (const layer of rig.layers) images[layer.file] = await load(recorded(slug, layer.file));
  return images;
}

export const lumaOf = (img, i) => 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
export const area = (bits) => bits.reduce((s, v) => s + v, 0);
export const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Bits of `img` (eye-local) passing `test(r, g, b, a, x, y)`. */
export function bitsWhere(img, test) {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = test(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3], i % img.width, Math.floor(i / img.width)) ? 1 : 0;
  return out;
}

/** 4-neighbour erosion (k < 0) or dilation (k > 0) by |k| px. */
export function morph(bits, w, h, k) {
  let cur = bits;
  const on = k > 0 ? 1 : 0;
  for (let s = 0; s < Math.abs(k); s++) {
    const from = cur;
    cur = from.map((v, i) => {
      if (v === on) return v;
      const x = i % w;
      const n = [x > 0 ? from[i - 1] : 0, x < w - 1 ? from[i + 1] : 0, i >= w ? from[i - w] : 0, i + w < from.length ? from[i + w] : 0];
      return n.some((m) => m === on) ? on : v;
    });
  }
  return cur;
}

/** Background-connected flood: the bits NOT set and not reachable from the border (holes of `bits`). */
export function holesOf(bits, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length > 0) {
    const i = stack.pop();
    if (seen[i] === 1 || bits[i] === 1) continue;
    seen[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i + w < w * h) stack.push(i + w);
  }
  return seen.map((v, i) => (v === 0 && bits[i] === 0 ? 1 : 0));
}

/** Centroid {cx, cy, n} of set bits (eye-local px centres), undefined when empty. */
export function centroid(bits, w) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < bits.length; i++) if (bits[i] === 1) (sx += (i % w) + 0.5), (sy += Math.floor(i / w) + 0.5), n++;
  return n === 0 ? undefined : { cx: sx / n, cy: sy / n, n };
}

/** The 4-connected component of `bits` holding the set pixel nearest (cx, cy); empty bits when none is set. */
export function componentAt(bits, w, h, cx, cy) {
  let seed = -1;
  let best = Infinity;
  for (let i = 0; i < bits.length; i++) {
    const d = bits[i] === 1 ? Math.hypot((i % w) + 0.5 - cx, Math.floor(i / w) + 0.5 - cy) : Infinity;
    if (d < best) (best = d), (seed = i);
  }
  const out = new Uint8Array(w * h);
  const stack = seed < 0 ? [] : [seed];
  while (stack.length > 0) {
    const i = stack.pop();
    if (out[i] === 1 || bits[i] !== 1) continue;
    out[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i + w < w * h) stack.push(i + w);
  }
  return out;
}

/**
 * The rig at rest with `family`'s faces on (or none), iris layers clipped by their eye's active socket
 * (the face's own, else the base's): as face-lib.mjs `restComposite`, kept here so these tools do not
 * break while the shared table changes. `images` by file name; files missing from it load from `dir`.
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

/** A socket mask PNG image from bits, its edge softened by a 3x3 box (the clip of a light reads as a rim, not a stair). */
export function softMask(forge, bits, w, h) {
  const img = forge.bitsToImage(bits, w, h);
  const a = new Float32Array(w * h).map((_, i) => img.data[i * 4 + 3]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) (s += a[(y + dy) * w + x + dx]), n++;
      img.data[(y * w + x) * 4 + 3] = Math.round(s / n);
    }
  }
  return img;
}
