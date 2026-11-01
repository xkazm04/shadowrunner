// Cutting (forge-pipeline requirements 4.3, 4.4, 4.5; design.md "Cut algorithm"; director
// rulings 2 and 4; task 4 seams). Parts are cut front to back. A part loses every pixel where a
// part in front is fully opaque, so no two layers share an opaque core, and it reaches a few px
// under its neighbours in front, so their soft edges sit over it instead of over the ground.
// Pure: plain arrays in, fresh images out.
import { KEY_HI, type Mask, cornerKeyLo, dilateMask, featherMask, lumaKey, rasterizeMask } from "./mask.js";
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
   * The filled portrait (fill step, FILL_PARTS removed); head and torso are cut from it and keep
   * the filled surface under FILL_PARTS (ruling (a)). Without it head and torso come from the
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
 * With `options.plate` (ruling (a)), head and torso are cut from the plate, are not reduced by the
 * cores of FILL_PARTS, and the head also takes in the FILL_PARTS polygons, so an open jaw or a
 * hidden monocle shows filled surface, never a hole. Without a plate no two cores overlap at all;
 * with one, only a FILL_PARTS core may overlap a head or torso core. A part name that repeats
 * keeps its first polygon (parseParts already drops repeats).
 */
export function cutAll(portrait: Rgba, parts: readonly Part[], options: CutOptions = {}): CutResult {
  const { width, height } = portrait;
  const filled = options.plate !== undefined;
  const plate = options.plate ?? portrait;
  sameSize(portrait, plate, "cutAll plate");
  const feather = options.feather ?? CUT_FEATHER;

  const polys = new Map<PartName, Polygon>();
  for (const part of parts) if (!polys.has(part.name)) polys.set(part.name, toCanvas(part.poly, width, height));

  /** Ruling (a): hard union of the FILL_PARTS polygons, which the head covers on a filled plate. */
  const lifted: Mask = { width, height, data: new Uint8ClampedArray(width * height) };
  if (filled) {
    for (const name of FILL_PARTS) {
      const poly = polys.get(name);
      if (poly === undefined) continue;
      rasterizeMask(poly, width, height, 0).data.forEach((a, i) => {
        if (a !== 0) lifted.data[i] = 255;
      });
    }
  }

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
    const own = rasterizeMask(poly, width, height, 0);
    const shape = underFront(own, front, reach);
    if (filled && name === "head") for (let i = 0; i < shape.data.length; i++) if (lifted.data[i] === 255) shape.data[i] = 255;
    const m = featherMask(shape, feather).data;
    if (KEYED_PARTS.includes(name)) {
      key ??= lumaKey(portrait, keyLo, KEY_HI);
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
    const isKept = !FILL_PARTS.includes(name);
    for (let i = 0; i < m.length; i++) {
      if (blocked[i] === 1) m[i] = 0;
      else if (m[i] === 255) {
        core[i] = 1;
        if (isKept) kept[i] = 1;
      }
      if (own.data[i] !== 0) front.data[i] = 255;
    }
    const cut = cutLayer(onPlate ? plate : portrait, { width, height, data: m });
    if (cut === undefined) empty.push(name);
    else layers.push({ name, ...cut });
  }
  return { layers, empty, keyLo, hood };
}
