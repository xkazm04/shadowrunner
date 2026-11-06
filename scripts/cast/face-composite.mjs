// Faces measured as composites (cast-face-pass): a recorded character's old expression faces, from
// the backup (var/cast-eyes/<slug>/orig/), drawn on its old rig at rest, are an "edit" with no
// re-render: `faceStability` measures them against the old rig at rest with nothing on, and their
// noise floor is the committed faces' WebP (q88) alone, measured here by a no-op face (every patched
// layer's own pixels through the same WebP) drawn the same way. The limit is that floor + the margin
// (stability.ts outsideLimit). The old jaw faces are left out (a band cut never patches the jaw). A
// face that passes is cut to the band like any edit (expressions-socketed.mjs). No network, no model.
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { readJsonFile } from "../forge-lib.mjs";
import { jobDir, load, origDir, restComposite } from "./face-lib.mjs";

/** The committed faces' WebP (character-control task 5): q88, alpha lossless. */
const FACE_WEBP = { quality: 88, alphaQuality: 100, effort: 6 };

async function throughWebp(image) {
  const raw = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  const bytes = await sharp(raw, { raw: { width: image.width, height: image.height, channels: 4 } }).webp(FACE_WEBP).toBuffer();
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/**
 * The old faces of `slug` as composites, or undefined without a backup or faces. `base` is the old rig
 * at rest, `faceOf(family)` the old rig with that family's faces (undefined when it had none), and
 * `floor` the outside-band mean of a no-op face (`rig`, `face`, `reach`: the new rig's band and face).
 */
export async function oldFaces(forge, slug, rig, face, reach) {
  const backup = join(origDir(slug), "job.json");
  if (!existsSync(backup)) return undefined;
  const recorded = readJsonFile(backup).value.rig;
  // A band cut never patches the jaw (expressions.ts): the old jaw faces (mouth repaints) are left out.
  const old = { ...recorded, layers: recorded.layers.map((l) => (l.kind === "jaw" ? Object.fromEntries(Object.entries(l).filter(([k]) => k !== "variants")) : l)) };
  const families = [...new Set(old.layers.flatMap((l) => Object.keys(l.variants ?? {})))];
  if (families.length === 0) return undefined;
  const images = {};
  const from = (file) => (existsSync(join(origDir(slug), file)) ? join(origDir(slug), file) : join(jobDir(slug), file));
  for (const layer of old.layers) {
    for (const file of [layer.file, ...Object.values(layer.variants ?? {}).map((p) => p.file)]) if (existsSync(from(file))) images[file] = await load(from(file));
  }
  const base = await restComposite(forge, old, jobDir(slug), undefined, images);
  // The no-op face: each of the first family's patches replaced by its own layer's pixels under it, through the WebP.
  const first = families[0];
  const noop = {};
  const noopRig = { ...old, layers: old.layers.map((l) => ({ ...l })) };
  for (const layer of noopRig.layers) {
    const patch = layer.variants?.[first];
    if (patch === undefined) continue;
    const [px, py, pw, ph] = patch.bbox;
    const own = forge.cropImage(images[layer.file], [px - layer.bbox[0], py - layer.bbox[1], pw, ph]);
    const file = `${patch.file}#noop`;
    noop[file] = await throughWebp(own);
    layer.variants = { [first]: { ...patch, file } };
  }
  const still = await restComposite(forge, noopRig, jobDir(slug), first, { ...images, ...noop });
  const floor = forge.faceStability(still, base, rig, face, {}, reach).outsideBandMean;
  const faceOf = async (family) => (families.includes(family) ? restComposite(forge, old, jobDir(slug), family, images) : undefined);
  return { base, floor, faceOf };
}
