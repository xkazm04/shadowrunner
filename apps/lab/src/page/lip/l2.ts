// L2, forge mouths: the same scheduler and tracking as L1 (mouth/driver.ts), but each shape is an
// image of the character's own mouth (var/lab/mouths/<character>/, made by src/mouths from the
// pack's art and the forge's image model, or a deterministic placeholder). The shapes crossfade by
// their weights inside a feathered mask cut to the face (the rest crop's own alpha), drawn in the
// head's frame over the crop square. A shape with no image, and every shape until the images have
// loaded, is drawn by L1's procedural mouth; the jaw opens only for those (the art has its own).
import type { LipDriverFactory, LipContext } from "../types.js";
import { createMouthDriver } from "./mouth/driver.js";
import { createPatchCache, paintMouth } from "./mouth/paint.js";
import { findMouthSet, type MouthSetManifest } from "./mouth/set.js";
import { blendParams, MOUTH_SHAPES, restWeights, type MouthShape, type ShapeWeights } from "./mouth/shapes.js";

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Surface2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function surface(side: number): { canvas: Surface; g: Surface2D } | undefined {
  const canvas: Surface = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(side, side) : Object.assign(document.createElement("canvas"), { width: side, height: side });
  const g = canvas.getContext("2d") as Surface2D | null;
  return g === null ? undefined : { canvas, g };
}

/** Feathered ellipse about the mouth, in crop px: opaque core, fading rim. */
export const MASK = { rx: 0.75, ry: 0.36, core: 0.6, below: 0.06 } as const;

/** Every shape's image cut by the rest crop's alpha (the face's outline) and the feathered mask. */
async function loadShapes(manifest: MouthSetManifest, urls: Partial<Record<MouthShape, string>>, mouthWidth: number, mouth: { x: number; y: number }): Promise<Map<MouthShape, Surface>> {
  const side = manifest.crop[2];
  const bitmaps = new Map<MouthShape, ImageBitmap>();
  await Promise.all(
    (Object.entries(urls) as [MouthShape, string][]).map(async ([shape, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`mouth ${shape}: HTTP ${res.status}`);
      bitmaps.set(shape, await createImageBitmap(await res.blob()));
    }),
  );
  const rest = bitmaps.get("rest");
  const out = new Map<MouthShape, Surface>();
  for (const [shape, bitmap] of bitmaps) {
    const s = surface(side);
    if (s === undefined) continue;
    s.g.drawImage(bitmap, 0, 0, side, side);
    s.g.globalCompositeOperation = "destination-in";
    if (rest !== undefined) s.g.drawImage(rest, 0, 0, side, side);
    // A circle squashed to the ellipse about (mx, my): y' = k y + my (1 - k). The fill covers the
    // whole square, so destination-in clears everything outside the mask too.
    const rx = mouthWidth * MASK.rx;
    const k = MASK.ry / MASK.rx;
    const mx = mouth.x;
    const my = mouth.y + mouthWidth * MASK.below;
    const c = my * (1 - k);
    s.g.setTransform(1, 0, 0, k, 0, c);
    const grad = s.g.createRadialGradient(mx, my, 0, mx, my, rx);
    grad.addColorStop(0, "rgba(0, 0, 0, 1)");
    grad.addColorStop(MASK.core, "rgba(0, 0, 0, 1)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    s.g.fillStyle = grad;
    s.g.fillRect(0, -c / k, side, side / k);
    out.set(shape, s.canvas);
  }
  for (const b of bitmaps.values()) b.close();
  return out;
}

/** Splits a mix into the part the art draws (normalised) and the part L1 draws (as weights). */
export function splitMix(weights: ShapeWeights, drawn: ReadonlySet<MouthShape>): { art: [MouthShape, number][]; artShare: number; procedural: ShapeWeights; proceduralShare: number } {
  const art: [MouthShape, number][] = [];
  const procedural = restWeights();
  procedural.rest = 0;
  let artShare = 0;
  let proceduralShare = 0;
  for (const shape of MOUTH_SHAPES) {
    const w = weights[shape];
    if (!(w > 0)) continue;
    if (drawn.has(shape)) {
      art.push([shape, w]);
      artShare += w;
    } else {
      procedural[shape] = w;
      proceduralShare += w;
    }
  }
  art.sort((a, b) => b[1] - a[1]);
  return { art: art.map(([s, w]) => [s, artShare > 0 ? w / artShare : 0]), artShare, procedural, proceduralShare };
}

export const createL2: LipDriverFactory = (ctx: LipContext) => {
  const character = ctx.character;
  const found = findMouthSet(character);
  if (typeof found === "string") throw new Error(`Lip arm L2: ${found}.`);
  const { manifest, urls } = found;
  const [cropX, cropY, side] = manifest.crop;
  let shapes = new Map<MouthShape, Surface>();
  let loading: Promise<void> | undefined;
  const mix = surface(side);
  const patches = createPatchCache();

  const drawn = (): ReadonlySet<MouthShape> => new Set(shapes.keys());
  const driver = createMouthDriver(
    "L2",
    ctx,
    (g, f) => {
      if (loading === undefined) {
        const mouth = { x: f.anchor.geometry.cx - cropX, y: f.anchor.geometry.lineY - cropY };
        loading = loadShapes(manifest, urls, f.anchor.geometry.width, mouth)
          .then((loaded) => {
            shapes = loaded;
          })
          .catch((error: unknown) => console.warn(`Lip arm L2: the mouth set did not load (${error instanceof Error ? error.message : String(error)}); drawing L1's mouth.`));
      }
      const split = splitMix(f.weights, drawn());
      if (split.proceduralShare > 0) {
        const params = blendParams(split.procedural);
        paintMouth(g, { anchor: f.anchor, params, colours: f.colours, alpha: f.alpha * split.proceduralShare }, patches);
      }
      if (split.artShare <= 0 || mix === undefined || !(f.alpha > 0)) return;
      // The art's shapes, averaged by weight: each drawn over the last at w_k / (w_1 + ... + w_k).
      mix.g.setTransform(1, 0, 0, 1, 0, 0);
      mix.g.globalCompositeOperation = "source-over";
      mix.g.clearRect(0, 0, side, side);
      let acc = 0;
      for (const [shape, w] of split.art) {
        const image = shapes.get(shape);
        if (image === undefined) continue;
        acc += w;
        mix.g.globalAlpha = acc > 0 ? w / acc : 0;
        mix.g.drawImage(image, 0, 0);
      }
      mix.g.globalAlpha = 1;
      const m = f.anchor.affine;
      g.save();
      g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      g.globalAlpha = f.alpha * split.artShare * f.anchor.opacity;
      g.drawImage(mix.canvas, cropX, cropY, side, side);
      g.restore();
    },
    {
      // The art carries its own opening: the jaw opens only for what L1 draws.
      jawWeights: (w) => {
        const split = splitMix(w, drawn());
        return { ...split.procedural, rest: 1 - split.proceduralShare };
      },
    },
  );
  return driver;
};
