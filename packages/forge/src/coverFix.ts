// The cut keeps every piece (perfection-pass task 16, requirement 16.1). A stage after assembly,
// deterministic from the portrait, the recorded parts, the painted background and the cut layers, so
// the forge runs it on every new rig (assembleRig) and the replay re-cut runs the same code on the
// committed layers (scripts/cover-recut.mjs). It changes only the head and body layers (the roots
// of the two groups) and the background under what the body newly holds:
// 1. Leftovers: every foreground pixel (cover.ts `foregroundOf`) the layers do not cover at rest to
//    its key goes to the group whose solid pixels are nearer (`nearerHead`: a hood's rim, a hat's
//    brim, hair past its polygon ride the head; a chest piece between the parts rides the body),
//    into that group's root layer. The rest view does not change: the pixel takes the colour that
//    showed under it at rest (the backdrop, and the body under a head pixel), mixed under what the
//    layer already had there. The backdrop held these pieces still; now they move with their group.
// 2. The background under a leftover now held opaque is painted out (blurExtend, as `backgroundOf`
//    paints under every moving layer), so a turned head or body leaves no static copy of it behind.
// 3. The neck: where the head group lies over the body, the body reaches up under it as far as the
//    head group moves against the body at the rig's limits (coverCheck.ts `neckOf`) plus the body's
//    own shift, opaque, in the painted background's colour (what the backdrop showed when the head
//    moved). Hidden at rest under the head group.
// No new art: every added pixel is the portrait's, the background's, or a mix of them. Pure.
import type { Layer, LayerPose, Rig } from "@sr/rig";
import { BACKGROUND_BLUR_PASSES, BACKGROUND_ERODE } from "./background.js";
import { type Images, COVER_SPECK, REST_DRIVE, SOLID, coverage, dropSpecks, foregroundOf, groupsOf, nearerHead, place, posesAt, solidOf } from "./cover.js";
import { neckOf } from "./coverCheck.js";
import { blendBy } from "./cut.js";
import { blurExtend } from "./fill.js";
import { type Mask, dilateMask } from "./mask.js";
import type { NamedPart, Part, Rgba } from "./types.js";

export interface PiecesInput {
  rig: Rig;
  /** Decoded layer pixels by `layer.file`. */
  images: Images;
  portrait: Rgba;
  /** The painted background (the backdrop layer's pixels). */
  background: Rgba;
  parts: readonly (Part | NamedPart)[];
}

export interface Pieces {
  rig: Rig;
  images: Record<string, Rgba>;
  background: Rgba;
  /** Layers changed. */
  changed: string[];
  /** Pixels taken as leftovers by the head and the body, and by the body under the head group. */
  head: number;
  body: number;
  neck: number;
  /** The neck reach used, px. */
  reach: number;
}

/** The body layer pieces go to: the rearmost `body` layer that follows nothing. */
export const bodyLayerOf = (rig: Rig): Layer | undefined => rig.layers.filter((l) => l.kind === "body" && l.follow === undefined).sort((a, b) => a.z - b.z)[0];

/** The head layer pieces go to: the rearmost `head` layer that follows nothing. */
export const headLayerOf = (rig: Rig): Layer | undefined => rig.layers.filter((l) => l.kind === "head" && l.follow === undefined).sort((a, b) => a.z - b.z)[0];

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const atRest = (layer: Layer, pose: LayerPose | undefined): boolean =>
  pose !== undefined && near(pose.x, layer.bbox[0]) && near(pose.y, layer.bbox[1]) && pose.rotation === 0 && pose.scale[0] === 1 && pose.scale[1] === 1;

/** The layer's image on a full canvas (transparent outside its bbox). */
function onCanvas(image: Rgba, [bx, by]: readonly number[], width: number, height: number): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < image.height; y++) {
    const cy = (by ?? 0) + y;
    if (cy < 0 || cy >= height) continue;
    for (let x = 0; x < image.width; x++) {
      const cx = (bx ?? 0) + x;
      if (cx >= 0 && cx < width) data.set(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4), (cy * width + cx) * 4);
    }
  }
  return { width, height, data };
}

/** The canvas image cropped to its non-transparent pixels, with that box; undefined when empty. */
function cropped(canvas: Rgba): { image: Rgba; bbox: [number, number, number, number] } | undefined {
  const { width, height, data } = canvas;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < width * height; i++) {
    if ((data[i * 4 + 3] ?? 0) === 0) continue;
    const x = i % width;
    const y = (i - x) / width;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (x1 < 0) return undefined;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x1 + 1) * 4), y * w * 4);
  return { image: { width: w, height: h, data: out }, bbox: [x0, y0, w, h] };
}

/**
 * Raises pixel `i` of `canvas` to alpha `to` (0..255), keeping what it showed over `under`: the new
 * colour is (c * a + u * (to - a)) / to, so the layer over `under` composites as before.
 */
function raise(canvas: Rgba, i: number, to: number, under: Rgba): void {
  const at = i * 4;
  const a = canvas.data[at + 3] ?? 0;
  if (to <= a) return;
  for (let c = 0; c < 3; c++) canvas.data[at + c] = Math.round(((canvas.data[at + c] ?? 0) * a + (under.data[at + c] ?? 0) * (to - a)) / to);
  canvas.data[at + 3] = to;
}

/** The background with the rest-posed layers below `z` drawn over it (what shows under a layer at `z`). */
function restUnder(rig: Rig, images: Images, background: Rgba, z: number): Rgba {
  const { width, height } = rig;
  const out = background.data.slice();
  const zOf = new Map(rig.layers.map((l) => [l.name, l.z]));
  for (const pose of posesAt(rig, REST_DRIVE)) {
    if ((zOf.get(pose.name) ?? Infinity) >= z) continue;
    const p = place(rig, images, pose);
    if (p === undefined) continue;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [sx, sy] = p.toImage(x + 0.5, y + 0.5);
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        if (ix < 0 || iy < 0 || ix >= p.image.width || iy >= p.image.height) continue;
        const s = (iy * p.image.width + ix) * 4;
        const a = ((p.image.data[s + 3] ?? 0) / 255) * p.opacity;
        if (a === 0) continue;
        const t = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) out[t + c] = Math.round((p.image.data[s + c] ?? 0) * a + (out[t + c] ?? 0) * (1 - a));
      }
    }
  }
  return { width, height, data: out };
}

/** The rig and images with each changed layer's image cropped and its bbox moved. */
function withLayers(rig: Rig, images: Images, canvases: ReadonlyMap<Layer, Rgba>): { rig: Rig; images: Record<string, Rgba> } {
  const boxes = new Map<string, [number, number, number, number]>();
  const out: Record<string, Rgba> = { ...images };
  for (const [layer, canvas] of canvases) {
    const cut = cropped(canvas);
    if (cut === undefined) continue;
    boxes.set(layer.name, cut.bbox);
    out[layer.file] = cut.image;
  }
  return {
    rig: {
      ...rig,
      layers: rig.layers.map((l) => ({
        ...l,
        ...(boxes.has(l.name) ? { bbox: boxes.get(l.name) ?? l.bbox } : {}),
      })),
    },
    images: out,
  };
}

/** Steps 1-3 of the header. A rig with no body layer, or whose body or head is not at rest at its bbox, comes back unchanged. */
export function keepEveryPiece(input: PiecesInput): Pieces {
  const { portrait, parts } = input;
  const { width, height } = input.rig;
  const same: Pieces = {
    rig: input.rig,
    images: { ...input.images },
    background: input.background,
    changed: [],
    head: 0,
    body: 0,
    neck: 0,
    reach: 0,
  };
  const rest = new Map(posesAt(input.rig, REST_DRIVE).map((p) => [p.name, p]));
  const bodyLayer = bodyLayerOf(input.rig);
  const bodyImage = bodyLayer === undefined ? undefined : input.images[bodyLayer.file];
  if (bodyLayer === undefined || bodyImage === undefined || !atRest(bodyLayer, rest.get(bodyLayer.name))) return same;
  const found = headLayerOf(input.rig);
  const headLayer = found !== undefined && input.images[found.file] !== undefined && atRest(found, rest.get(found.name)) ? found : undefined;
  const body = onCanvas(bodyImage, bodyLayer.bbox, width, height);
  const head = headLayer === undefined ? undefined : onCanvas(input.images[headLayer.file] ?? bodyImage, headLayer.bbox, width, height);
  const canvases = new Map<Layer, Rgba>([[bodyLayer, body], ...(headLayer === undefined || head === undefined ? [] : [[headLayer, head] as const])]);

  // 1. Leftovers, to the nearer group's root. Pieces under COVER_SPECK px are edge crumbs, as the check counts them.
  const fg = foregroundOf(portrait, parts).data;
  const cov = coverage(input.rig, input.images, [...rest.values()]);
  const left = Uint8Array.from(fg, (f, i) => (f > 0 && (cov[i] ?? 0) * 255 < f ? 1 : 0));
  const pieces = dropSpecks(left, width, COVER_SPECK);
  const opaqued = new Uint8Array(width * height);
  let tookHead = 0;
  let tookBody = 0;
  if (pieces > 0) {
    const groups = groupsOf(input.rig);
    const toHead = nearerHead(solidOf(input.rig, input.images, groups.head, SOLID), solidOf(input.rig, input.images, groups.body, SOLID), width);
    const underHead = headLayer === undefined ? undefined : restUnder(input.rig, input.images, input.background, headLayer.z);
    for (let i = 0; i < fg.length; i++) {
      const f = fg[i] ?? 0;
      if (left[i] !== 1) continue;
      const onHead = toHead[i] === 1 && head !== undefined && underHead !== undefined;
      const canvas = onHead ? head : body;
      if (f <= (canvas.data[i * 4 + 3] ?? 0)) continue;
      raise(canvas, i, f, onHead ? underHead : input.background);
      if (onHead) tookHead++;
      else tookBody++;
      if (f === 255) opaqued[i] = 1;
    }
  }
  const touchedLayers = (neckHeld: number): Map<Layer, Rgba> => new Map([...canvases].filter(([l]) => (l === bodyLayer ? tookBody + neckHeld > 0 : tookHead > 0)));
  let { rig, images } = withLayers(input.rig, input.images, touchedLayers(0));

  // 2. Paint the background out under the leftovers now held opaque, eroded by BACKGROUND_ERODE as
  // `backgroundOf` erodes, extended from just outside them (only these pixels: the rest is painted).
  let background = input.background;
  if (tookHead + tookBody > 0) {
    const kept = Uint8ClampedArray.from(opaqued, (v) => (v === 1 ? 0 : 255));
    const edge = dilateMask({ width, height, data: kept }, BACKGROUND_ERODE).data;
    const hole: Mask = { width, height, data: Uint8ClampedArray.from(opaqued, (v, i) => (v === 1 && edge[i] === 0 ? 255 : 0)) };
    if (hole.data.some((v) => v !== 0)) background = blendBy(background, blurExtend(background, dilateMask(hole, BACKGROUND_ERODE), { passes: BACKGROUND_BLUR_PASSES }), hole);
  }

  // 3. The neck, held by the body.
  const neck = neckOf(rig, images);
  const reach = neck.reach + Math.ceil(neck.bodyShift);
  let held = 0;
  if (neck.reach > 0) {
    for (let i = 0; i < width * height; i++) {
      if (neck.headAny[i] !== 1 || (neck.below[i] ?? Infinity) > reach || (body.data[i * 4 + 3] ?? 0) === 255) continue;
      raise(body, i, 255, background);
      held++;
    }
  }
  if (held > 0) ({ rig, images } = withLayers(input.rig, input.images, touchedLayers(held)));
  const changed = [...touchedLayers(held).keys()].map((l) => l.name);
  return {
    rig,
    images,
    background,
    changed,
    head: tookHead,
    body: tookBody,
    neck: held,
    reach,
  };
}
