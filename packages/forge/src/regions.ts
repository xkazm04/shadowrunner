// Colour regions (character-control design.md "Regions", requirement 2): per layer image, an index
// map and at most MAX_REGION_SLOTS recolourable slots, found from the pixels alone (no model call)
// and deterministically: the same layer gives a byte-identical map. Offline (scripts/cast/regions.mjs)
// and live (the assemble step) run this one function. Pure: an image in, a fresh map out.
import { MAX_REGION_SLOTS, type Layer, type LayerRegions, type RegionSlot, type Rig } from "@sr/rig";
import { encodePng } from "./image.js";
import type { Mask } from "./mask.js";
import { hsv } from "./palette.js";
import type { Rgba } from "./types.js";

/** Step 1: a pixel takes part from this alpha. */
export const REGION_ALPHA = 128;
/**
 * Step 2: chroma (max - min channel, 0..1) under this is near-grey, classed by lightness
 * (dark < 0.35 <= mid < 0.7 <= light). Chroma, not HSL saturation (director ruling 2026-11-03):
 * a near-black pixel has HSL saturation near 1, which split a black mouth into two slots.
 */
export const GREY_SATURATION = 0.12;
export const DARK_LIGHTNESS = 0.35;
export const LIGHT_LIGHTNESS = 0.7;
/** Step 2: coloured pixels fall in 12 hue bins of 30 degrees. */
export const REGION_HUE_BINS = 12;
/** Step 3: no slot holds less than this share of the opaque pixels. */
export const MIN_SLOT_SHARE = 0.04;
/** Step 7: a layer with less than this share of opaque pixels gets no regions. */
export const MIN_OPAQUE_SHARE = 0.02;
/**
 * The jaw cavity on a rig without the painted mask (an existing rig): the darkest class whose mean
 * chroma ((max - min) / 255) is under this, that is not the jaw's largest class, holds >= MIN_SLOT_SHARE,
 * lies at least CAVITY_UPPER_SHARE inside the upper half of the jaw's opaque rows and is enclosed
 * (at most CAVITY_EDGE_SHARE of its pixels touch the layer's edge: transparency or the frame), is the
 * `cavity` slot. Chroma, not HSL saturation: a near-black pixel has HSL saturation near 1 (#000a0a is 1.0).
 */
export const CAVITY_CHROMA = 0.1;
export const CAVITY_UPPER_SHARE = 0.75;
export const CAVITY_EDGE_SHARE = 0.25;
/** Semi-transparent edge pixels (0 < alpha < REGION_ALPHA) take their opaque neighbours' slot over this many passes. */
export const FRINGE_PASSES = 8;

export const CAVITY_SLOT = "cavity";

export interface RegionsOptions {
  /** Layer-size mask (non-zero = the painted mouth cavity, `paintCavity`): those pixels are the `cavity` slot. */
  cavity?: Mask;
}

export interface LayerRegionsResult {
  regions: LayerRegions;
  /** Layer-size: R = slot index + 1 (0 none), G = B = 0, A = 255. */
  map: Rgba;
}

/** The map's file name (step 6). */
export const regionsFile = (layer: string): string => `${layer}.regions.png`;

const GREY_CLASSES = 3;
const CAVITY_CLASS = GREY_CLASSES + REGION_HUE_BINS;

interface ClassStats {
  n: number;
  hued: number;
  cos: number;
  sin: number;
  light: number;
  sat: number;
}

/** HSL lightness and saturation (0..1) of an 8-bit RGB triple. */
export function hslOf(r: number, g: number, b: number): { l: number; s: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const span = max - min;
  return { l, s: span === 0 ? 0 : span / (1 - Math.abs(2 * l - 1)) };
}

function initialClass(r: number, g: number, b: number): { k: number; h: number; l: number; s: number } {
  const { l, s } = hslOf(r, g, b);
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  if (chroma < GREY_SATURATION) return { k: l < DARK_LIGHTNESS ? 0 : l < LIGHT_LIGHTNESS ? 1 : 2, h: 0, l, s };
  const h = hsv([r, g, b]).h;
  return { k: GREY_CLASSES + Math.min(REGION_HUE_BINS - 1, Math.floor(h / (360 / REGION_HUE_BINS))), h, l, s };
}

const meanHue = (c: ClassStats): number => (Math.atan2(c.sin, c.cos) * 180) / Math.PI;
const hueDistance = (a: ClassStats, b: ClassStats): number => {
  if (a.hued === 0 || b.hued === 0) return 180;
  const d = Math.abs(meanHue(a) - meanHue(b)) % 360;
  return Math.min(d, 360 - d);
};

/** Step 3: greedy merges, smallest first into its nearest class by hue, then lightness; returns each class's root. */
function mergeClasses(stats: ClassStats[], opaque: number): number[] {
  const root = stats.map((_, k) => k);
  const alive = (): number[] => stats.flatMap((c, k) => (root[k] === k && c.n > 0 ? [k] : []));
  for (;;) {
    const live = alive();
    const free = live.filter((k) => k !== CAVITY_CLASS);
    if (free.length < 2) break;
    let small = free[0] ?? 0;
    for (const k of free) if ((stats[k]?.n ?? 0) < (stats[small]?.n ?? 0)) small = k;
    const a = stats[small] as ClassStats;
    if (live.length <= MAX_REGION_SLOTS && a.n >= MIN_SLOT_SHARE * opaque) break;
    let best = -1;
    let bestHue = Infinity;
    let bestLight = Infinity;
    for (const k of free) {
      if (k === small) continue;
      const b = stats[k] as ClassStats;
      const dh = hueDistance(a, b);
      const dl = Math.abs(a.light / a.n - b.light / b.n);
      if (dh < bestHue || (dh === bestHue && dl < bestLight)) [best, bestHue, bestLight] = [k, dh, dl];
    }
    const into = stats[best] as ClassStats;
    into.n += a.n;
    into.hued += a.hued;
    into.cos += a.cos;
    into.sin += a.sin;
    into.light += a.light;
    into.sat += a.sat;
    a.n = 0;
    for (let k = 0; k < root.length; k++) if (root[k] === small) root[k] = best;
  }
  return root;
}

/** Step 4: one 3x3 majority pass over the labelled (opaque) pixels; a tie keeps the centre. */
function majority(labels: Int16Array, width: number, height: number): Int16Array {
  const out = labels.slice();
  const counts = new Map<number, number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centre = labels[y * width + x] ?? -1;
      if (centre < 0) continue;
      counts.clear();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = labels[ny * width + nx] ?? -1;
          if (v >= 0) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      let top = counts.get(centre) ?? 0;
      let winner = centre;
      let tied = false;
      for (const [v, n] of counts) {
        if (v === centre) continue;
        if (n > top) [winner, top, tied] = [v, n, false];
        else if (n === top) tied = true;
      }
      out[y * width + x] = tied ? centre : winner;
    }
  }
  return out;
}

/** Edge pixels (0 < alpha < REGION_ALPHA) take the commonest slot of their labelled neighbours (lowest on a tie). */
function fillFringe(map: Uint8Array, image: Rgba): void {
  const { width, height, data } = image;
  for (let pass = 0; pass < FRINGE_PASSES; pass++) {
    const next = map.slice();
    let changed = false;
    for (let i = 0; i < map.length; i++) {
      if (map[i] !== 0 || (data[i * 4 + 3] ?? 0) === 0) continue;
      const x = i % width;
      const y = (i - x) / width;
      const counts = new Array<number>(MAX_REGION_SLOTS + 1).fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = map[ny * width + nx] ?? 0;
          if (v > 0) counts[v] = (counts[v] ?? 0) + 1;
        }
      }
      let best = 0;
      for (let v = 1; v < counts.length; v++) if ((counts[v] ?? 0) > (counts[best] ?? 0)) best = v;
      if (best > 0) {
        next[i] = best;
        changed = true;
      }
    }
    map.set(next);
    if (!changed) break;
  }
}

const median = (hist: Uint32Array, n: number): number => {
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v] ?? 0;
    if (seen * 2 >= n) return v;
  }
  return 255;
};
const hex2 = (v: number): string => v.toString(16).padStart(2, "0");

/** Whether pixel `i` of `labels` (opaque = >= 0) has an unlabelled 4-neighbour or lies on the frame. */
function onEdge(labels: Int16Array, width: number, height: number, i: number): boolean {
  const x = i % width;
  const y = (i - x) / width;
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
  return (labels[i - 1] ?? -1) < 0 || (labels[i + 1] ?? -1) < 0 || (labels[i - width] ?? -1) < 0 || (labels[i + width] ?? -1) < 0;
}

/** The jaw cavity class of an existing rig (no painted mask), or -1 (see CAVITY_CHROMA). */
function inferredCavity(labels: Int16Array, image: Rgba, classes: readonly number[], largest: number, opaque: number): number {
  const { width } = image;
  let top = Infinity;
  let bottom = -1;
  labels.forEach((v, i) => {
    if (v < 0) return;
    const y = Math.floor(i / width);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  });
  const mid = (top + bottom + 1) / 2;
  let best = -1;
  let bestLight = Infinity;
  for (const k of classes) {
    if (k === largest) continue;
    let n = 0;
    let upper = 0;
    let light = 0;
    let sat = 0;
    let edge = 0;
    labels.forEach((v, i) => {
      if (v !== k) return;
      n++;
      if (Math.floor(i / width) < mid) upper++;
      if (onEdge(labels, width, image.height, i)) edge++;
      const r = image.data[i * 4] ?? 0;
      const g = image.data[i * 4 + 1] ?? 0;
      const b = image.data[i * 4 + 2] ?? 0;
      light += hslOf(r, g, b).l;
      sat += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    });
    if (n < MIN_SLOT_SHARE * opaque || sat / n >= CAVITY_CHROMA || upper < CAVITY_UPPER_SHARE * n || edge > CAVITY_EDGE_SHARE * n) continue;
    if (light / n < bestLight) [best, bestLight] = [k, light / n];
  }
  return best;
}

/**
 * design.md "Regions", steps 1-7, on one layer image (`layer` gives the name and kind): undefined for
 * the background, a layer under MIN_OPAQUE_SHARE opaque pixels, or one class. With `opts.cavity`
 * those pixels are their own class (never merged), the slot `cavity` named "mouth"; a jaw layer
 * without it gets `inferredCavity`. Slots are ordered by pixel count; the others are `r1..`, named
 * after the layer (`<part>`, `<part> 2`, ...); `hex` is the per-channel median of the slot's opaque
 * pixels. Edge pixels under REGION_ALPHA take their neighbours' slot (`fillFringe`) so a recolour
 * leaves no rim of painted colour.
 */
export function regionsOf(layer: Pick<Layer, "name" | "kind">, image: Rgba, opts: RegionsOptions = {}): LayerRegionsResult | undefined {
  if (layer.name === "background") return undefined;
  const { width, height, data } = image;
  const size = width * height;
  const labels = new Int16Array(size).fill(-1);
  const stats: ClassStats[] = Array.from({ length: CAVITY_CLASS + 1 }, () => ({ n: 0, hued: 0, cos: 0, sin: 0, light: 0, sat: 0 }));
  let opaque = 0;
  for (let i = 0; i < size; i++) {
    if ((data[i * 4 + 3] ?? 0) < REGION_ALPHA) continue;
    opaque++;
    const c = initialClass(data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0);
    const k = (opts.cavity?.data[i] ?? 0) !== 0 ? CAVITY_CLASS : c.k;
    const s = stats[k] as ClassStats;
    s.n++;
    s.light += c.l;
    s.sat += c.s;
    if (c.k >= GREY_CLASSES) {
      s.hued++;
      s.cos += Math.cos((c.h * Math.PI) / 180);
      s.sin += Math.sin((c.h * Math.PI) / 180);
    }
    labels[i] = k;
  }
  if (opaque < MIN_OPAQUE_SHARE * size) return undefined;
  const root = mergeClasses(stats, opaque);
  for (let i = 0; i < size; i++) {
    const v = labels[i] ?? -1;
    if (v >= 0) labels[i] = root[v] ?? v;
  }
  const filtered = majority(labels, width, height);
  const counts = new Map<number, number>();
  for (const v of filtered) if (v >= 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  const classes = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b);
  if (classes.length < 2) return undefined;
  const cavity = counts.has(CAVITY_CLASS) ? CAVITY_CLASS : layer.kind === "jaw" ? inferredCavity(filtered, image, classes, classes[0] ?? -1, opaque) : -1;

  const slots: RegionSlot[] = [];
  const index = new Map<number, number>();
  let named = 0;
  for (const k of classes) {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    filtered.forEach((v, i) => {
      if (v !== k) return;
      hist.forEach((h, c) => {
        const value = data[i * 4 + c] ?? 0;
        h[value] = (h[value] ?? 0) + 1;
      });
    });
    const n = counts.get(k) ?? 0;
    const hex = `#${hist.map((h) => hex2(median(h, n))).join("")}`;
    index.set(k, slots.length + 1);
    if (k === cavity) slots.push({ id: CAVITY_SLOT, name: "mouth", hex });
    else {
      named++;
      slots.push({ id: `r${named}`, name: named === 1 ? layer.name : `${layer.name} ${named}`, hex });
    }
  }
  const map = new Uint8Array(size);
  filtered.forEach((v, i) => {
    if (v >= 0) map[i] = index.get(v) ?? 0;
  });
  fillFringe(map, image);
  const out = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    out[i * 4] = map[i] ?? 0;
    out[i * 4 + 3] = 255;
  }
  return { regions: { map: regionsFile(layer.name), slots }, map: { width, height, data: out } };
}

/** The layer (by name) holding the most opaque pixels of a canvas-size cavity mask, jaws and eyes aside (the head under the jaw). */
export function cavityHolder(rig: Pick<Rig, "width" | "layers">, images: ReadonlyMap<string, Rgba>, cavity: Mask): string | undefined {
  let best: string | undefined;
  let most = 0;
  for (const layer of rig.layers) {
    const image = images.get(layer.name);
    if (image === undefined || layer.kind === "jaw" || layer.kind === "eye" || layer.name === "background") continue;
    const n = cropMask(cavity, layer.bbox, image).data.reduce((s, v, i) => s + (v !== 0 && (image.data[i * 4 + 3] ?? 0) >= REGION_ALPHA ? 1 : 0), 0);
    if (n > most) [best, most] = [layer.name, n];
  }
  return best;
}

/** A canvas mask cut to a layer's bbox (layer-size). */
export function cropMask(mask: Mask, [bx, by]: Layer["bbox"], image: { width: number; height: number }): Mask {
  const { width, height } = image;
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = bx + x;
      const cy = by + y;
      if (cx >= 0 && cy >= 0 && cx < mask.width && cy < mask.height) data[y * width + x] = mask.data[cy * mask.width + cx] ?? 0;
    }
  }
  return { width, height, data };
}

/**
 * Every layer's regions (live assemble step, offline retrofit): the rig with `regions` set where a
 * layer has any, and the map PNGs by file name. `cavity` (canvas-size, the painted mouth) goes to
 * its `cavityHolder`; jaw layers infer theirs.
 */
export function regionsForRig(rig: Rig, images: ReadonlyMap<string, Rgba>, cavity?: Mask): { rig: Rig; files: Record<string, Uint8Array> } {
  const holder = cavity === undefined ? undefined : cavityHolder(rig, images, cavity);
  const files: Record<string, Uint8Array> = {};
  const layers = rig.layers.map((layer) => {
    const image = images.get(layer.name);
    if (image === undefined) return layer;
    const own = cavity !== undefined && layer.name === holder ? { cavity: cropMask(cavity, layer.bbox, image) } : {};
    const found = regionsOf(layer, image, own);
    if (found === undefined) return layer;
    files[found.regions.map] = encodePng(found.map);
    return { ...layer, regions: found.regions };
  });
  return { rig: { ...rig, layers }, files };
}
