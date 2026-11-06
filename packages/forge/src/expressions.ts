// Expression faces (character-control design.md "Expressions", requirement 5): one image edit per
// family changes only the face; `cutVariants` keeps the edit inside the face mask and turns what
// changed into per-layer patches (`Layer.variants`). The live forge (api/_lib/forge-expressions.ts)
// and the offline tool (scripts/cast/expressions.mjs) share it. Pure: images in, fresh images out.
//
// The re-cut: a Rig does not carry its layers' cut recipe (parts, plate, keys, mattes), so each
// layer is re-cut by its own alpha. Its new colour is the composite's (`edited` inside the feathered
// mask, the base outside), its alpha the base's. A head layer takes the edit only where no eye, jaw
// or brow layer in front of it is opaque: what lies under those is the plate and the painted mouth
// cavity, which an open jaw or a shut eye must still show. The rig owns the mouth (llm-avatar-lab):
// when the rig has `mouth`, the head and jaw re-cuts get the mouth region back from the base
// (`resetMouth`), so an edit changes eyes and brows and the renderer's mouth carries the emotion.
import type { ExpressionFamily, Layer, LayerPatch, Rig, RigMouth } from "@sr/rig";
import { dilateMask, emptyMask, featherMask, type Mask } from "./mask.js";
import { browLidBand, type BandReach } from "./stability.js";
import type { Rgba } from "./types.js";

/** Mean |edited - portrait| (0..255) in the mask's outer ring over which a family is flagged. */
export const EXPRESSION_DRIFT_LIMIT = 20;
/** The ring the edit did not mean to change: the mask's outer quarter (by distance to its edge). */
export const DRIFT_RING_SHARE = 0.25;
/** A layer gets a patch when its re-cut differs from the base by more than this mean (0..255) in its bbox. */
export const PATCH_MIN_MEAN = 2;
/** face-control: the same for a band-cut head or hair (mean over its changed box). */
export const BAND_PATCH_MIN_MEAN = 0.5;
/** A patch is the changed area plus this margin (canvas px). */
export const PATCH_MARGIN = 4;
/** Face mask: band margins as shares of the head's height, dilation as a share of the rig width, feather in px. */
export const BAND_ABOVE = 0.06;
export const BAND_BELOW = 0.03;
export const MASK_DILATE = 0.02;
export const MASK_FEATHER = 8;
const OPAQUE = 128;

export const isBrowLayer = (name: string): boolean => /^brow(_|$)/.test(name);

/**
 * design.md "Prompt": FACE per family. The rig owns the mouth (llm-avatar-lab round 3) and the gaze
 * (face-control: the iris layer moves inside the socket): each FACE names the brows and the eyelids
 * only, never where the eyes look, so the edit keeps the irises where they were.
 */
export const EXPRESSION_FACES: Readonly<Record<ExpressionFamily, string>> = Object.freeze({
  joy: "warm delight: the lower lids lifted into soft happy crescents, the brows raised and soft",
  showman: "a theatrical flourish: the lids opened wide, the brows high and arched",
  anger: "fury: the brows drawn down hard into a V with a crease between them, the lids narrowed into a glare",
  gloom: "gloom: heavy lowered upper lids, the brows flat and low with their inner ends lifted",
  smug: "smug superiority: one brow raised high, the upper lids half lowered",
  suspicion: "suspicion: the lids narrowed, one brow lowered",
});

/**
 * face-control: for a line-art face whose edits drew the brows faint or thin (Auntie Asp, owner board
 * 2026-11-06), one more sentence: the brows stay the portrait's bold ink and move for the emotion.
 */
export const INK_BROWS = "Draw both brows as bold solid black ink strokes, exactly as thick, dark and long as in the portrait, and move and bend them for the emotion; never fade, thin, smudge or hide them behind the eyes or the spectacles.";

/** face-control: what a refused face's re-run adds, one sentence per attempt past the first. */
export const STRICTER: readonly string[] = [
  "Only the brow hairs and the eyelid skin may change: every pixel below the lower lids and above the brows stays identical, and the irises do not move by even one pixel.",
  "This is a tiny retouch, not a repaint: leave the eyeballs, the nose, the cheeks, the forehead and the outline of the face untouched and redraw nothing outside the brows and lids.",
];

/**
 * The edit for one family; `style` (a brief's style name), when given, is appended as one more
 * sentence so the edit keeps the house of the drawing. face-control's strict frame: only the brows
 * and lids change; the irises keep their place, size and direction; the face keeps its structure;
 * the mouth and jaw stay as painted (no "closed": a visor or a maw drawn open must stay open).
 * `attempt` 1.. adds the first `attempt` STRICTER sentences (a re-run of a refused face).
 * cast-face-pass: `material`, when given, follows them (a character's own terms: pixel art, carved
 * pumpkin, steel, stained glass; what its eyes are and must stay).
 */
export function expressionPrompt(name: string, family: ExpressionFamily, style?: string, attempt = 0, material?: string): string {
  const frame = `Edit this portrait of ${name}. Change ONLY the brows and the eyelids, to ${EXPRESSION_FACES[family]}. Keep both irises and pupils exactly where they are, the same size and looking in the same direction as in the portrait: do not move, turn, recolour or redraw the eyeballs. Keep the structure of the face exactly: the same head shape, cheeks, nose, mouth, lips and jaw, neutral and at rest; do not open, smile, snarl, purse or move the mouth, and add no lines or folds around the mouth or on the cheeks. Keep the same character, pose, framing, art style, colours, lighting, background and every other pixel. Do not add or remove objects.`;
  const stricter = STRICTER.slice(0, Math.max(0, attempt)).join(" ");
  const strict = [frame, stricter, material?.trim() ?? ""].filter((t) => t !== "").join(" ");
  return style === undefined || style.trim() === "" ? strict : `${strict} The art style is ${style.trim()}.`;
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
export function faceShape(rig: Pick<Rig, "width" | "height" | "layers">, layers: ReadonlyMap<string, Rgba>): Mask {
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

/** cast-face-pass: `band` cuts to the brow+lid band without iris layers too (a one-piece eye: the Vicar). */
export interface VariantCutOptions {
  band?: boolean;
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
 * Mouth region (`resetMouth`) as shares of the mouth's width: centre drop, half-width, half-heights
 * above and below. Tuned on the Tallyman's six faces (the brief's ellipse 0.08 / 0.8 / 0.4 / 0.6 left
 * the grin's raised corners, the open upper lip and the smirk's tail; a cut through the nostrils
 * doubled them): a rounded box that reaches the corners and takes the nose's lower half whole.
 */
export const RESET_DROP = 0;
export const RESET_RX = 0.95;
export const RESET_RY_ABOVE = 0.75;
export const RESET_RY_BELOW = 0.6;
/** The region's inward feather, px: base inside, the patch outside, blended across this band. */
export const RESET_FEATHER = 8;
/** The region's superellipse power: 2 is an ellipse; 4 a rounded box that reaches a grin's raised corners. */
export const RESET_POWER = 4;

/**
 * A reset region's size, shares of the mouth's width, overriding RESET_RX / RESET_RY_ABOVE /
 * RESET_RY_BELOW: recorded faces whose grin, open jaw or nose crease reach past the default region
 * (scripts/cast/mouth-backfill.mjs keeps the per-character values).
 */
export interface ResetRegion {
  rx?: number;
  above?: number;
  below?: number;
}

/** The base's weight (0..1) at canvas point (x, y): 1 deeper than RESET_FEATHER px inside the mouth region, 0 outside. */
export function mouthWeight(mouth: RigMouth, x: number, y: number, region: ResetRegion = {}): number {
  const dx = x - mouth.cx;
  const dy = y - (mouth.lineY + RESET_DROP * mouth.width);
  const rx = (region.rx ?? RESET_RX) * mouth.width;
  const ry = (dy < 0 ? (region.above ?? RESET_RY_ABOVE) : (region.below ?? RESET_RY_BELOW)) * mouth.width;
  const r = (Math.abs(dx / rx) ** RESET_POWER + Math.abs(dy / ry) ** RESET_POWER) ** (1 / RESET_POWER);
  if (r === 0) return 1;
  if (r >= 1) return 0;
  const dist = Math.hypot(dx, dy);
  // Along the ray from the centre: the edge lies at dist / r, so the pixel is dist / r - dist inside.
  return Math.min(1, (dist / r - dist) / RESET_FEATHER);
}

/**
 * The rig owns the mouth (llm-avatar-lab): `patch` (placed at `patchBbox`, canvas px) with the
 * mouth region restored from `base` (placed at `baseBbox`). The region is a superellipse (power
 * RESET_POWER) centred at
 * (cx, lineY + RESET_DROP * width), half-width RESET_RX * width, half-height RESET_RY_ABOVE * width
 * above its centre and RESET_RY_BELOW * width below; every RGBA channel is blended patch -> base by
 * `mouthWeight` (pixel centres). Patch pixels the base does not cover stay as they are. Fresh image.
 */
export function resetMouth(patch: Rgba, patchBbox: Layer["bbox"], base: Rgba, baseBbox: Layer["bbox"], mouth: RigMouth, region: ResetRegion = {}): Rgba {
  const data = patch.data.slice();
  const [px, py] = patchBbox;
  const [bx, by] = baseBbox;
  for (let y = 0; y < patch.height; y++) {
    for (let x = 0; x < patch.width; x++) {
      const w = mouthWeight(mouth, px + x + 0.5, py + y + 0.5, region);
      if (w === 0) continue;
      const sx = Math.round(px + x - bx);
      const sy = Math.round(py + y - by);
      if (sx < 0 || sy < 0 || sx >= base.width || sy >= base.height) continue;
      const o = (y * patch.width + x) * 4;
      const s = (sy * base.width + sx) * 4;
      for (let c = 0; c < 4; c++) data[o + c] = Math.round((patch.data[o + c] ?? 0) * (1 - w) + (base.data[s + c] ?? 0) * w);
    }
  }
  return { width: patch.width, height: patch.height, data };
}

/** Sum of |next - base| over RGB, and the box [x0, y0, x1, y1] of the pixels that differ (x1 = -1 when none). */
function changeOf(base: Uint8ClampedArray, next: Uint8ClampedArray, width: number): { sum: number; box: [number, number, number, number] } {
  let sum = 0;
  const box: [number, number, number, number] = [Infinity, Infinity, -1, -1];
  for (let i = 0; i < base.length; i += 4) {
    let moved = false;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((next[i + c] ?? 0) - (base[i + c] ?? 0));
      sum += d;
      if (d !== 0) moved = true;
    }
    if (!moved) continue;
    const x = (i / 4) % width;
    const y = Math.floor(i / 4 / width);
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  }
  return { sum, box };
}

/**
 * design.md "Cut": for every head, eye, jaw or brow layer, its re-cut from the composite (see the
 * header); a layer whose re-cut differs from its base by more than PATCH_MIN_MEAN in its bbox (a
 * band-cut head: in its changed box) gets a patch. face-control: on a socketed rig (iris layers) the edit
 * is taken only inside the brow+lid band (`browLidBand`), so the jaw, mouth and cheeks keep their base. Eye, jaw and brow patches are `replace` and cover the whole layer (a replace patch hides its
 * base, so a crop would erase the unchanged rest); the head's is `over`, cropped to the changed area
 * plus PATCH_MARGIN. cast-face-pass: a band cut (`opts.band`, or a socketed rig) patches no jaw layer. Every pixel the mask leaves at 0 equals the base. `drift` (`driftOf`) flags the
 * family over EXPRESSION_DRIFT_LIMIT; the patches are returned either way. Throws when `edited` is not
 * the portrait's size (callers area-resize first).
 */
export function cutVariants(rig: Rig, layers: ReadonlyMap<string, Rgba>, portrait: Rgba, edited: Rgba, family: ExpressionFamily, reach: BandReach = {}, opts: VariantCutOptions = {}): VariantCut {
  if (edited.width !== portrait.width || edited.height !== portrait.height || portrait.width !== rig.width || portrait.height !== rig.height) {
    throw new RangeError(`cutVariants: edited ${edited.width}x${edited.height}, portrait ${portrait.width}x${portrait.height}, rig ${rig.width}x${rig.height}`);
  }
  const shape = faceShape(rig, layers);
  const soft = featherMask(shape, MASK_FEATHER).data;
  // face-control: an expression moves the brows and lids only; a socketed rig (iris layers) takes the edit in the brow+lid band.
  const band = opts.band === true || rig.layers.some((l) => l.kind === "iris") ? browLidBand(rig, reach).data : undefined;
  if (band !== undefined) soft.forEach((v, i) => (soft[i] = Math.round((v * (band[i] ?? 0)) / 255)));
  const drift = driftOf(shape, portrait, edited);
  const patches: VariantCut["patches"] = {};
  for (const layer of rig.layers) {
    const base = layers.get(layer.name);
    // face-control: with the band, a crown on the head (hair over the brows: Sister Vesper) is cut like the head.
    const headLike = layer.kind === "head" || (band !== undefined && layer.kind === "crown" && layer.follow === "head");
    if (base === undefined || !(headLike || isFaceLayer(layer))) continue;
    // cast-face-pass: a band-cut face never patches the jaw; the mouth stays the art's (a sliding jaw, a maw, lips the warp moves).
    if (band !== undefined && layer.kind === "jaw") continue;
    const cover = headLike ? coverInFront(rig, layers, layer.z) : undefined;
    const [bx, by] = layer.bbox;
    let next: Uint8ClampedArray = base.data.slice();
    const weight = new Float32Array(base.width * base.height);
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        const cx = bx + x;
        const cy = by + y;
        const o = (y * base.width + x) * 4;
        if (cx < 0 || cy < 0 || cx >= rig.width || cy >= rig.height || (base.data[o + 3] ?? 0) === 0) continue;
        const ci = cy * rig.width + cx;
        const w = ((soft[ci] ?? 0) / 255) * (cover === undefined ? 1 : 1 - (cover[ci] ?? 0) / 255);
        if (w === 0) continue;
        weight[y * base.width + x] = w;
        for (let c = 0; c < 3; c++) next[o + c] = Math.round((base.data[o + c] ?? 0) * (1 - w) + (edited.data[ci * 4 + c] ?? 0) * w);
      }
    }
    // The rig owns the mouth: the head and jaw keep the neutral mouth, the eyes and brows the edit.
    if (rig.mouth !== undefined && (layer.kind === "head" || layer.kind === "jaw")) {
      next = resetMouth({ width: base.width, height: base.height, data: next }, layer.bbox, base, layer.bbox, rig.mouth).data;
    }
    const { sum, box } = changeOf(base.data, next, base.width);
    const [x0, y0, x1, y1] = box;
    // face-control: a band-cut head changes only around the eyes, so its mean is taken over the changed box, not the whole head.
    const area = band !== undefined && headLike ? (x1 - x0 + 1) * (y1 - y0 + 1) : base.width * base.height;
    // A band-cut head-like layer shares the brows with the others: any real change makes its patch, or a brow is drawn in halves.
    if (x1 < 0 || sum / (area * 3) <= (band !== undefined && headLike ? BAND_PATCH_MIN_MEAN : PATCH_MIN_MEAN)) continue;
    const replace = !headLike;
    const [px0, py0, px1, py1] = replace
      ? [0, 0, base.width - 1, base.height - 1]
      : [Math.max(0, x0 - PATCH_MARGIN), Math.max(0, y0 - PATCH_MARGIN), Math.min(base.width - 1, x1 + PATCH_MARGIN), Math.min(base.height - 1, y1 + PATCH_MARGIN)];
    const pw = px1 - px0 + 1;
    const ph = py1 - py0 + 1;
    const data = new Uint8ClampedArray(pw * ph * 4);
    for (let y = 0; y < ph; y++) data.set(next.subarray(((py0 + y) * base.width + px0) * 4, ((py0 + y) * base.width + px0 + pw) * 4), y * pw * 4);
    // face-control: a band-cut head patch is the edit itself with the band's weight as its alpha, so it
    // fades out inside the band and a lossy face file leaves no box around the eyes.
    if (band !== undefined && !replace) {
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const li = (py0 + y) * base.width + px0 + x;
          const w = weight[li] ?? 0;
          const o = (y * pw + x) * 4;
          const ci = (by + py0 + y) * rig.width + bx + px0 + x;
          if (w > 0) for (let c = 0; c < 3; c++) data[o + c] = edited.data[ci * 4 + c] ?? 0;
          data[o + 3] = Math.round((base.data[li * 4 + 3] ?? 0) * w);
        }
      }
    }
    patches[layer.name] = {
      patch: { file: variantFile(layer.name, family), bbox: [bx + px0, by + py0, pw, ph], mode: replace ? "replace" : "over" },
      image: { width: pw, height: ph, data },
    };
  }
  return { family, drift, patches, flagged: drift > EXPRESSION_DRIFT_LIMIT };
}
