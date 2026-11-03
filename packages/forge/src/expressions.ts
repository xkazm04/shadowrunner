// Expression faces (character-control design.md "Expressions", requirement 5): one image edit per
// family changes only the face; `cutVariants` keeps the edit inside the face mask and turns what
// changed into per-layer patches (`Layer.variants`). The live forge (api/_lib/forge-expressions.ts)
// and the offline tool (scripts/cast/expressions.mjs) share it. Pure: images in, fresh images out.
//
// The re-cut: a Rig does not carry its layers' cut recipe (parts, plate, keys, mattes), so each
// layer is re-cut by its own alpha. Its new colour is the composite's (`edited` inside the feathered
// mask, the base outside), its alpha the base's. A head layer takes the edit only where no eye, jaw
// or brow layer in front of it is opaque: what lies under those is the plate and the painted mouth
// cavity, which an open jaw or a shut eye must still show.
import type { ExpressionFamily, Layer, LayerPatch, Rig } from "@sr/rig";
import { dilateMask, emptyMask, featherMask, type Mask } from "./mask.js";
import type { Rgba } from "./types.js";

/** Mean |edited - portrait| (0..255) in the mask's outer ring over which a family is flagged. */
export const EXPRESSION_DRIFT_LIMIT = 20;
/** The ring the edit did not mean to change: the mask's outer quarter (by distance to its edge). */
export const DRIFT_RING_SHARE = 0.25;
/** A layer gets a patch when its re-cut differs from the base by more than this mean (0..255) in its bbox. */
export const PATCH_MIN_MEAN = 2;
/** A patch is the changed area plus this margin (canvas px). */
export const PATCH_MARGIN = 4;
/** Face mask: band margins as shares of the head's height, dilation as a share of the rig width, feather in px. */
export const BAND_ABOVE = 0.06;
export const BAND_BELOW = 0.03;
export const MASK_DILATE = 0.02;
export const MASK_FEATHER = 8;
const OPAQUE = 128;

export const isBrowLayer = (name: string): boolean => /^brow(_|$)/.test(name);

/** design.md "Prompt": FACE per family. */
export const EXPRESSION_FACES: Readonly<Record<ExpressionFamily, string>> = Object.freeze({
  joy: "a warm, open delight: eyes smiling and slightly narrowed, brows raised, mouth in a broad smile",
  showman: "a theatrical showman's flourish: eyes wide, brows high and arched, mouth open in a grand exclamation",
  anger: "fury: brows drawn down hard into a V, eyes narrowed and glaring, mouth in a snarl showing teeth",
  gloom: "gloom: heavy lowered eyelids, brows flat and low, mouth a flat or downturned line",
  smug: "smug superiority: one brow raised, eyes half-lidded, a one-sided smirk",
  suspicion: "suspicion: eyes narrowed sideways, one brow lowered, lips pressed tight",
});

/**
 * The edit for one family, verbatim from design.md; `style` (a brief's style name), when given, is
 * appended as one more sentence so the edit keeps the house of the drawing.
 */
export function expressionPrompt(name: string, family: ExpressionFamily, style?: string): string {
  const frame = `Edit this portrait of ${name}. Change ONLY the facial expression to ${EXPRESSION_FACES[family]}. Keep the same character, pose, framing, art style, colours, lighting, background and every other pixel. Do not add or remove objects.`;
  return style === undefined || style.trim() === "" ? frame : `${frame} The art style is ${style.trim()}.`;
}

const isFaceLayer = (layer: Layer): boolean => layer.kind === "eye" || layer.kind === "jaw" || isBrowLayer(layer.name);

/** Sets `mask` where `image` (placed at `bbox`) is opaque, optionally only for canvas rows y0 <= y < y1. */
function stamp(mask: Mask, image: Rgba, [bx, by]: Layer["bbox"], y0 = -Infinity, y1 = Infinity): void {
  for (let y = 0; y < image.height; y++) {
    const cy = by + y;
    if (cy < 0 || cy >= mask.height || cy < y0 || cy >= y1) continue;
    for (let x = 0; x < image.width; x++) {
      const cx = bx + x;
      if (cx < 0 || cx >= mask.width) continue;
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) >= OPAQUE) mask.data[cy * mask.width + cx] = 255;
    }
  }
}

/** The hard (unfeathered) face shape: face layers, the head's face band, dilated. */
function faceShape(rig: Pick<Rig, "width" | "height" | "layers">, layers: ReadonlyMap<string, Rgba>): Mask {
  const shape = emptyMask(rig.width, rig.height);
  let top = Infinity;
  let jawBottom = -Infinity;
  let featureBottom = -Infinity;
  let jawTop = Infinity;
  for (const layer of rig.layers) {
    if (!isFaceLayer(layer)) continue;
    const image = layers.get(layer.name);
    if (image !== undefined) stamp(shape, image, layer.bbox);
    const [, y, , h] = layer.bbox;
    if (layer.kind === "jaw") {
      jawBottom = Math.max(jawBottom, y + h);
      jawTop = Math.min(jawTop, y);
    } else {
      top = Math.min(top, y);
      featureBottom = Math.max(featureBottom, y + h);
    }
  }
  for (const head of rig.layers) {
    const image = layers.get(head.name);
    if (head.kind !== "head" || image === undefined) continue;
    const h = head.bbox[3];
    const from = (Number.isFinite(top) ? top : jawTop) - BAND_ABOVE * h;
    const to = (Number.isFinite(jawBottom) ? jawBottom : featureBottom) + BAND_BELOW * h;
    if (Number.isFinite(from) && Number.isFinite(to)) stamp(shape, image, head.bbox, Math.floor(from), Math.ceil(to));
  }
  return dilateMask(shape, Math.round(MASK_DILATE * rig.width));
}

/**
 * design.md "Face mask": the union of the opaque pixels of the eye, jaw and brow layers and the head
 * layer's face band (from the top of the highest eye/brow bbox minus BAND_ABOVE of the head's height
 * to the bottom of the jaw bbox plus BAND_BELOW; without a jaw the lowest eye/brow bbox, without eyes
 * or brows the jaw's top), dilated by MASK_DILATE of the rig width and feathered MASK_FEATHER px
 * inward. Canvas-size; the mask is the alpha channel (colour is white).
 */
export function faceMask(rig: Pick<Rig, "width" | "height" | "layers">, layers: ReadonlyMap<string, Rgba>): Rgba {
  const soft = featherMask(faceShape(rig, layers), MASK_FEATHER);
  const data = new Uint8ClampedArray(rig.width * rig.height * 4).fill(255);
  soft.data.forEach((a, i) => (data[i * 4 + 3] = a));
  return { width: rig.width, height: rig.height, data };
}

/** City-block-ish (3-4 chamfer) distance from each set pixel of `shape` to the nearest unset one (or the frame). */
function edgeDistance(shape: Mask): Float32Array {
  const { width, height, data } = shape;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = data[i] === 0 ? 0 : 1e9;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= width || y >= height ? 0 : (d[y * width + x] ?? 0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i] ?? 0, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i] ?? 0, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  return d;
}

/** Mean |edited - portrait| over RGB in the mask's outer DRIFT_RING_SHARE (by edge distance); 0 for an empty mask. */
export function driftOf(shape: Mask, portrait: Rgba, edited: Rgba): number {
  const d = edgeDistance(shape);
  let deepest = 0;
  for (const v of d) deepest = Math.max(deepest, v);
  if (deepest === 0) return 0;
  const edge = DRIFT_RING_SHARE * deepest;
  let sum = 0;
  let n = 0;
  d.forEach((v, i) => {
    if (v === 0 || v > edge) return;
    n++;
    for (let c = 0; c < 3; c++) sum += Math.abs((edited.data[i * 4 + c] ?? 0) - (portrait.data[i * 4 + c] ?? 0));
  });
  return n === 0 ? 0 : sum / (n * 3);
}

export interface VariantCut {
  family: ExpressionFamily;
  drift: number;
  patches: Record<string, { patch: LayerPatch; image: Rgba }>;
  flagged: boolean;
}

/** The variant file of a layer (design.md: `<layer>.<family>.png`). */
export const variantFile = (layer: string, family: ExpressionFamily): string => `${layer}.${family}.png`;

/** Canvas coverage (max alpha) of the face layers in front of `z`. */
function coverInFront(rig: Pick<Rig, "width" | "height" | "layers">, layers: ReadonlyMap<string, Rgba>, z: number): Uint8Array {
  const cover = new Uint8Array(rig.width * rig.height);
  for (const layer of rig.layers) {
    const image = layers.get(layer.name);
    if (layer.z <= z || !isFaceLayer(layer) || image === undefined) continue;
    const [bx, by] = layer.bbox;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const cx = bx + x;
        const cy = by + y;
        if (cx < 0 || cy < 0 || cx >= rig.width || cy >= rig.height) continue;
        const i = cy * rig.width + cx;
        cover[i] = Math.max(cover[i] ?? 0, image.data[(y * image.width + x) * 4 + 3] ?? 0);
      }
    }
  }
  return cover;
}

/**
 * design.md "Cut": for every head, eye, jaw or brow layer, its re-cut from the composite (see the
 * header); a layer whose re-cut differs from its base by more than PATCH_MIN_MEAN in its bbox gets a
 * patch. Eye, jaw and brow patches are `replace` and cover the whole layer (a replace patch hides its
 * base, so a crop would erase the unchanged rest); the head's is `over`, cropped to the changed area
 * plus PATCH_MARGIN. Every pixel the mask leaves at 0 equals the base. `drift` (`driftOf`) flags the
 * family over EXPRESSION_DRIFT_LIMIT; the patches are returned either way. Throws when `edited` is not
 * the portrait's size (callers area-resize first).
 */
export function cutVariants(rig: Rig, layers: ReadonlyMap<string, Rgba>, portrait: Rgba, edited: Rgba, family: ExpressionFamily): VariantCut {
  if (edited.width !== portrait.width || edited.height !== portrait.height || portrait.width !== rig.width || portrait.height !== rig.height) {
    throw new RangeError(`cutVariants: edited ${edited.width}x${edited.height}, portrait ${portrait.width}x${portrait.height}, rig ${rig.width}x${rig.height}`);
  }
  const shape = faceShape(rig, layers);
  const soft = featherMask(shape, MASK_FEATHER).data;
  const drift = driftOf(shape, portrait, edited);
  const patches: VariantCut["patches"] = {};
  for (const layer of rig.layers) {
    const base = layers.get(layer.name);
    if (base === undefined || !(layer.kind === "head" || isFaceLayer(layer))) continue;
    const cover = layer.kind === "head" ? coverInFront(rig, layers, layer.z) : undefined;
    const [bx, by] = layer.bbox;
    const next = base.data.slice();
    let sum = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        const cx = bx + x;
        const cy = by + y;
        const o = (y * base.width + x) * 4;
        if (cx < 0 || cy < 0 || cx >= rig.width || cy >= rig.height || (base.data[o + 3] ?? 0) === 0) continue;
        const ci = cy * rig.width + cx;
        const w = ((soft[ci] ?? 0) / 255) * (cover === undefined ? 1 : 1 - (cover[ci] ?? 0) / 255);
        if (w === 0) continue;
        let moved = false;
        for (let c = 0; c < 3; c++) {
          const was = base.data[o + c] ?? 0;
          const now = Math.round(was * (1 - w) + (edited.data[ci * 4 + c] ?? 0) * w);
          next[o + c] = now;
          sum += Math.abs(now - was);
          if (now !== was) moved = true;
        }
        if (!moved) continue;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
    if (x1 < 0 || sum / (base.width * base.height * 3) <= PATCH_MIN_MEAN) continue;
    const replace = layer.kind !== "head";
    const [px0, py0, px1, py1] = replace
      ? [0, 0, base.width - 1, base.height - 1]
      : [Math.max(0, x0 - PATCH_MARGIN), Math.max(0, y0 - PATCH_MARGIN), Math.min(base.width - 1, x1 + PATCH_MARGIN), Math.min(base.height - 1, y1 + PATCH_MARGIN)];
    const pw = px1 - px0 + 1;
    const ph = py1 - py0 + 1;
    const data = new Uint8ClampedArray(pw * ph * 4);
    for (let y = 0; y < ph; y++) data.set(next.subarray(((py0 + y) * base.width + px0) * 4, ((py0 + y) * base.width + px0 + pw) * 4), y * pw * 4);
    patches[layer.name] = {
      patch: { file: variantFile(layer.name, family), bbox: [bx + px0, by + py0, pw, ph], mode: replace ? "replace" : "over" },
      image: { width: pw, height: ph, data },
    };
  }
  return { family, drift, patches, flagged: drift > EXPRESSION_DRIFT_LIMIT };
}
