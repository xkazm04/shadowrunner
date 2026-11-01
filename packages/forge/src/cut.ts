// Cutting (forge-pipeline requirements 4.3, 4.4, 4.5; design.md "Cut algorithm"; director
// rulings 2 and 4; task 4 seams). Parts are cut front to back. A part loses every pixel where a
// part in front is fully opaque, so no two layers share an opaque core, and it reaches a few px
// under its neighbours in front, so their soft edges sit over it instead of over the ground.
// Pure: plain arrays in, fresh images out.
import { KEY_HI, type Mask, cornerKeyLo, dilateMask, emptyMask, featherMask, luma, lumaKey, rasterizeMask } from "./mask.js";
import { toCanvas } from "./parts.js";
import type { Part, PartName, Polygon, Rgba } from "./types.js";

/** design.md "Cut algorithm" step 2: front to back. */
export const CUT_ORDER: readonly PartName[] = [
  "eye_l",
  "eye_r",
  "monocle",
  "accessory",
  "hat",
  "crown",
  "hair",
  "jaw",
  "head",
  "torso",
];

/** design.md step 3: feather width in canvas px. */
export const CUT_FEATHER = 3;

/** Parts multiplied by the luma key, so ground between spikes and strands keys out (step 3). */
export const KEYED_PARTS: readonly PartName[] = ["crown", "hair", "accessory"];

/** Parts cut from the filled plate when one is given (step 4). */
export const PLATE_PARTS: readonly PartName[] = ["head", "torso"];

/**
 * Parts the fill step removes from the plate (task 5 ruling (a)): the server passes these to
 * `fillPrompt` and to `blurExtend`'s hole. They move or hide on their own, so the plate under them
 * is painted surface that the head layer carries.
 */
export const FILL_PARTS: readonly PartName[] = ["eye_l", "eye_r", "monocle", "accessory", "jaw"];

/**
 * Task 9: the jaw's lifted region is its polygon grown by this many px, so the edge of the hole an
 * open jaw leaves lies on painted surface, past the jaw's own outline (polygons run tight).
 */
export const JAW_GROW = 6;

/** Task 9: the head's surface under the jaw is darkened to this share of its light, deep inside. */
export const MOUTH_SHADE = 0.25;

/** Px over which the mouth shade ramps in from the edge of the jaw's lifted region. */
export const MOUTH_SHADE_RAMP = 28;

/** Task 9: the plate takes the fill within this many px of the lifted region (see plate.ts). */
export const PLATE_DILATE = 12;

/** Ruling 4: a hat holding more than this share of the head's area is a hood. */
export const HOOD_SHARE = 0.6;

/** Ruling 4: what a hood gives up before it is cut. */
export const HOOD_YIELDS: readonly PartName[] = ["head", "eye_l", "eye_r", "jaw"];

/** Canvas px, as in a Rig layer: top-left x, y, then width, height. */
export type Bbox = [x: number, y: number, w: number, h: number];

export interface Cut {
  /** The cut-out, cropped to `bbox`; alpha = source alpha * mask. */
  image: Rgba;
  bbox: Bbox;
}

export interface CutPart extends Cut {
  name: PartName;
}

export interface CutResult {
  /** In CUT_ORDER (front to back), one per part that kept any alpha. */
  layers: CutPart[];
  /** Parts whose mask came out empty (off the canvas, or wholly behind parts in front). */
  empty: PartName[];
  /** The key's `lo` used for this portrait (ruling 2, capped at KEY_HI - 1). */
  keyLo: number;
  /** Whether the hat was treated as a hood (ruling 4). */
  hood: boolean;
}

export interface CutOptions {
  /**
   * The filled plate (`composePlate`: FILL_PARTS painted out); head and torso keep its painted
   * surface under the lifted region (ruling (a), task 9). Without it head and torso come from the
   * portrait and lose those parts' cores like any other.
   */
  plate?: Rgba;
  /** Defaults to CUT_FEATHER. */
  feather?: number;
}

function sameSize(a: { width: number; height: number }, b: { width: number; height: number }, where: string): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError(`${where}: size ${b.width}x${b.height} does not match ${a.width}x${a.height}`);
  }
}

/** Smallest box holding every non-zero mask pixel, or undefined for an empty mask. */
export function bboxOfMask(mask: Mask): Bbox | undefined {
  const { width, height, data } = mask;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[y * width + x] ?? 0) === 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? undefined : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

/**
 * Requirement 4.3: the portrait under the mask, cropped to the mask's bbox, plus that bbox in
 * canvas px. Colour is copied unchanged; alpha is portrait alpha * mask / 255, rounded.
 * Undefined when the mask is empty.
 */
export function cutLayer(portrait: Rgba, mask: Mask): Cut | undefined {
  sameSize(portrait, mask, "cutLayer");
  const bbox = bboxOfMask(mask);
  if (bbox === undefined) return undefined;
  const [bx, by, bw, bh] = bbox;
  const data = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const at = (by + y) * portrait.width + bx + x;
      const to = (y * bw + x) * 4;
      data.set(portrait.data.subarray(at * 4, at * 4 + 3), to);
      data[to + 3] = Math.round(((portrait.data[at * 4 + 3] ?? 0) * (mask.data[at] ?? 0)) / 255);
    }
  }
  return { image: { width: bw, height: bh, data }, bbox };
}

/** Share of the head's pixels (hard raster, pixel centres) that lie inside the hat. 0 for an empty head. */
export function hoodShare(head: Polygon, hat: Polygon, width: number, height: number): number {
  const h = rasterizeMask(head, width, height, 0).data;
  const t = rasterizeMask(hat, width, height, 0).data;
  let area = 0;
  let shared = 0;
  for (let i = 0; i < h.length; i++) {
    if (h[i] === 0) continue;
    area++;
    if (t[i] !== 0) shared++;
  }
  return area === 0 ? 0 : shared / area;
}

/** The canvas polygons of `parts`, first of each name (parseParts already drops repeats). */
function polygonsOf(parts: readonly Part[], width: number, height: number): Map<PartName, Polygon> {
  const polys = new Map<PartName, Polygon>();
  for (const part of parts) if (!polys.has(part.name)) polys.set(part.name, toCanvas(part.poly, width, height));
  return polys;
}

/** One FILL_PARTS part's lifted region: its hard polygon, the jaw's grown by JAW_GROW. */
function liftedOf(name: PartName, poly: Polygon, width: number, height: number): Mask {
  const hard = rasterizeMask(poly, width, height, 0);
  return name === "jaw" ? dilateMask(hard, JAW_GROW) : hard;
}

/**
 * Task 9: the region the fill paints and the head carries under the moving parts: the hard union
 * of the FILL_PARTS polygons (or of `names` among them), the jaw's grown by JAW_GROW. 255 inside.
 */
export function liftedRegion(parts: readonly Part[], width: number, height: number, names: readonly PartName[] = FILL_PARTS): Mask {
  const polys = polygonsOf(parts, width, height);
  const out: Mask = { width, height, data: new Uint8ClampedArray(width * height) };
  for (const name of FILL_PARTS) {
    if (!names.includes(name)) continue;
    const poly = polys.get(name);
    if (poly === undefined) continue;
    liftedOf(name, poly, width, height).data.forEach((a, i) => {
      if (a !== 0) out.data[i] = 255;
    });
  }
  return out;
}

/** `under` where `weight` is 0 (bit for bit), `over` where it is 255, linear between; all four channels. */
export function blendBy(under: Rgba, over: Rgba, weight: Mask): Rgba {
  const data = under.data.slice();
  for (let i = 0; i < weight.data.length; i++) {
    const w = weight.data[i] ?? 0;
    if (w === 0) continue;
    for (let c = i * 4; c < i * 4 + 4; c++) data[c] = Math.round((under.data[c] ?? 0) + (((over.data[c] ?? 0) - (under.data[c] ?? 0)) * w) / 255);
  }
  return { width: under.width, height: under.height, data };
}

/**
 * How far a part grows under the parts in front of it (task 4 seams): far enough that its own
 * feather band ends inside their opaque cores, so it is opaque under their whole feather band.
 * 0 for a hard cut, which has no partial edges.
 */
export function seamReach(feather: number): number {
  return feather > 0 ? 2 * Math.ceil(feather) + 2 : 0;
}

/**
 * The shape a part is cut from: its own polygon, grown by `reach` px into the polygons in front of
 * it (`front`), never into the ground. Feathering this shape keeps the part opaque under the soft
 * edges of its neighbours in front, while its own silhouette against the ground stays soft.
 */
function underFront(own: Mask, front: Mask, reach: number): Mask {
  if (reach === 0) return own;
  const grown = dilateMask(own, reach).data;
  const data = own.data.slice();
  for (let i = 0; i < data.length; i++) if (grown[i] === 255 && front.data[i] === 255) data[i] = 255;
  return { width: own.width, height: own.height, data };
}

/**
 * Parts -> layers (requirement 4.4, design.md "Cut algorithm", rulings 2 and 4, task 4 seams).
 * In CUT_ORDER: take the part's polygon grown `seamReach(feather)` px into the parts already cut
 * in front of it, and feather it inward; for crown, hair and accessory multiply by
 * `lumaKey(cornerKeyLo(portrait), KEY_HI)`; for a hood (head more than HOOD_SHARE inside the hat)
 * take the head, eye and jaw masks out of the hat; then drop every pixel where a part in front is
 * fully opaque. So opaque cores never overlap, and where a front part's edge is partly transparent
 * the part behind it is opaque: the stack composites back to the source with no dark seam.
 *
 * With `options.plate` (ruling (a), task 9) the parts that move are lifted off a filled surface:
 * - each FILL_PARTS layer is opaque over its whole lifted region (the jaw's grown by JAW_GROW) and
 *   feathers outward over `feather` px, so at rest it hides everything the fill painted under it;
 * - head and torso are cut from the plate inside the lifted region (blended to the portrait over
 *   its inner `feather` px) and from the portrait outside it, are not reduced by the cores of
 *   FILL_PARTS, and the head also covers the lifted region grown by PLATE_DILATE. So an open jaw
 *   or a shut eye shows painted surface, never a hole, and at rest no fill pixel shows at all.
 * Without a plate no two cores overlap at all; with one, only a FILL_PARTS core may overlap a head
 * or torso core. A part name that repeats keeps its first polygon (parseParts already drops repeats).
 */
export function cutAll(portrait: Rgba, parts: readonly Part[], options: CutOptions = {}): CutResult {
  const { width, height } = portrait;
  const filled = options.plate !== undefined;
  const plate = options.plate ?? portrait;
  sameSize(portrait, plate, "cutAll plate");
  const feather = options.feather ?? CUT_FEATHER;
  const polys = polygonsOf(parts, width, height);

  /** Task 9: what the head carries under the moving parts, and the surface head and torso are cut from. */
  const lifted = filled ? liftedRegion(parts, width, height) : emptyMask(width, height);
  const surface = filled ? shadeMouth(blendBy(portrait, plate, featherMask(lifted, feather)), parts) : portrait;

  const keyLo = Math.min(cornerKeyLo(portrait), KEY_HI - 1);
  let key: Mask | undefined;
  const head = polys.get("head");
  const hat = polys.get("hat");
  const hood = head !== undefined && hat !== undefined && hoodShare(head, hat, width, height) > HOOD_SHARE;
  const reach = seamReach(feather);

  /** Hard union of the polygons already cut (the parts in front), 255 inside. */
  const front: Mask = { width, height, data: new Uint8ClampedArray(width * height) };
  /** 1 where a part in front is fully opaque: nothing behind may keep alpha there. */
  const core = new Uint8Array(width * height);
  /** The same, counting only parts outside FILL_PARTS: what blocks head and torso on a filled plate. */
  const kept = new Uint8Array(width * height);
  const layers: CutPart[] = [];
  const empty: PartName[] = [];
  for (const name of CUT_ORDER) {
    const poly = polys.get(name);
    if (poly === undefined) continue;
    const isLifted = FILL_PARTS.includes(name);
    const own = filled && isLifted ? liftedOf(name, poly, width, height) : rasterizeMask(poly, width, height, 0);
    const shape = underFront(own, front, reach);
    if (filled && isLifted) addTo(shape, dilateMask(own, feather));
    if (filled && name === "head") addTo(shape, dilateMask(lifted, PLATE_DILATE + feather));
    const m = featherMask(shape, feather).data;
    if (KEYED_PARTS.includes(name)) {
      key ??= keyOf(portrait, keyLo, filled ? plate : undefined);
      for (let i = 0; i < m.length; i++) m[i] = Math.round(((m[i] ?? 0) * (key.data[i] ?? 0)) / 255);
    }
    if (name === "hat" && hood) {
      for (const yielded of HOOD_YIELDS) {
        const other = polys.get(yielded);
        if (other === undefined) continue;
        const o = rasterizeMask(other, width, height, feather).data;
        for (let i = 0; i < m.length; i++) m[i] = Math.min(m[i] ?? 0, 255 - (o[i] ?? 0));
      }
    }
    const onPlate = PLATE_PARTS.includes(name);
    const blocked = filled && onPlate ? kept : core;
    for (let i = 0; i < m.length; i++) {
      if (blocked[i] === 1) m[i] = 0;
      else if (m[i] === 255) {
        core[i] = 1;
        if (!isLifted) kept[i] = 1;
      }
      if (own.data[i] !== 0) front.data[i] = 255;
    }
    const cut = cutLayer(onPlate ? surface : portrait, { width, height, data: m });
    if (cut === undefined) empty.push(name);
    else layers.push({ name, ...cut });
  }
  return { layers, empty, keyLo, hood };
}

/**
 * Task 9: what an open jaw uncovers is a mouth, so the head's surface under the jaw's lifted region
 * is shaded toward MOUTH_SHADE over MOUTH_SHADE_RAMP px from the region's edge. Whatever the fill
 * painted there (skin, teeth, rind, or the fallback's blur) reads as the inside of a mouth in shadow.
 * Hidden at rest: the jaw layer is opaque over the whole region. Modifies and returns `image`.
 */
function shadeMouth(image: Rgba, parts: readonly Part[]): Rgba {
  const { width, height } = image;
  const region = liftedRegion(parts, width, height, ["jaw"]);
  const box = bboxOfMask(region);
  if (box === undefined) return image;
  const [bx, , bw] = box;
  const ramp = featherMask(region, MOUTH_SHADE_RAMP).data;
  for (let i = 0; i < ramp.length; i++) {
    const r = ramp[i] ?? 0;
    if (r === 0) continue;
    // Deepest at the middle of the jaw's width, so the opening reads as a mouth, not a band.
    const across = Math.sin((Math.PI * ((i % width) - bx + 0.5)) / bw) ** 1.5;
    const shade = 1 - ((1 - MOUTH_SHADE) * r * across) / 255;
    for (let c = i * 4; c < i * 4 + 3; c++) image.data[c] = Math.round((image.data[c] ?? 0) * shade);
  }
  return image;
}

/** Task 9: a keyed pixel stays opaque once portrait and plate differ by this much luma. */
export const KEY_KEEP = 8;

/**
 * The luma key for crown, hair and accessory. With a plate, a pixel only keys out as far as the
 * plate behind it looks the same: alpha is at least |luma(portrait) - luma(plate)| / KEY_KEEP, so
 * a dark ribbon over a filled brow or a glow over a painted-out ground stays (task 9, rest = portrait).
 */
function keyOf(portrait: Rgba, lo: number, plate?: Rgba): Mask {
  const key = lumaKey(portrait, lo, KEY_HI);
  if (plate === undefined) return key;
  const p = portrait.data;
  const q = plate.data;
  for (let i = 0; i < key.data.length; i++) {
    const at = i * 4;
    const diff = Math.abs(luma(p[at] ?? 0, p[at + 1] ?? 0, p[at + 2] ?? 0) - luma(q[at] ?? 0, q[at + 1] ?? 0, q[at + 2] ?? 0));
    key.data[i] = Math.max(key.data[i] ?? 0, Math.min(255, Math.ceil((diff * 255) / KEY_KEEP)));
  }
  return key;
}

/** Sets `shape` to 255 wherever `extra` is non-zero. */
function addTo(shape: Mask, extra: Mask): void {
  for (let i = 0; i < shape.data.length; i++) if ((extra.data[i] ?? 0) !== 0) shape.data[i] = 255;
}
