// Recolour (character-control design.md "Recolour", req 1, 2.3): the one rule both renderers use,
// in TS (canvas2d and tests) and GLSL (gl/programs.ts, the same expressions), plus the selection
// of which light or region colour a layer's pixels take for a look. Pure, no DOM.
//
//   src (r,g,b) -> HSL (h, s, l); target -> (ht, st, lt)
//   out = HSL->RGB(ht, max(st * S_KEEP + s * (1 - S_KEEP), S_FLOOR * st), L(l))
//
// L is the lightness map (companion-lanes round 4). A light (eye, glow, mouth) keeps the art's
// lightness: L(l) = l, and so does a region slot without `shade: "move"` (the forge's slots are
// lightness bands of one material: moving one band tears it from its neighbours; director ruling,
// round 4). A `shade: "move"` slot (a material, e.g. a companion's jacket) moves it: with lr the
// lightness of the slot's reference colour
// (`regions.slots[i].hex`, the art's median colour of that slot), L is the piecewise-linear curve
// (0,0) - (lr,lt) - (1,1), so the slot's own colour lands on the target's lightness, the shading
// around it keeps its order and black and white stay put. lr and lt are both clamped to
// [L_EPS, 1 - L_EPS] first (no division by ~0 on a pure black or white reference), so lt == lr is
// exactly the identity and a black or white target is off by at most L_EPS.
//
// Soft edges (companion-lanes round 5, `LayerRegions.soft`): the map's G is the pixel's coverage of
// its slot, and the slot's result is mixed over the pixel without it by that coverage (`softMix`);
// a layer without `soft` reads coverage 1, the old path exactly.
//
// Decisions the spec leaves open:
// - Per light, not per look: a light recolours only when the look's colour differs from the rig's
//   palette (case-insensitive hex), and a region only when `look.regions` has its key. So a look
//   equal to the rig takes no recolour path at all and draws exactly as before, and changing one
//   light never changes how the other lights' layers draw.
// - One light per layer: an `eye` layer takes the eye light (all pixels, emissive or not); a layer
//   named `mouth_glow` the mouth light (all pixels); any other emissive layer the glow light (pixels
//   with saturation > GLOW_SATURATION). Eye layers never take the glow light: the eye light owns them.
// - A region colour wins over the layer's light on its slot's pixels. A `cavity` slot takes the
//   mouth light unless `look.regions` names a colour for it, on ANY layer (director amendment: live
//   forges paint the cavity into the head layer, under the jaw, so it is not always a jaw slot).
// - cast-face-pass: an eye or iris with `tint: false` keeps the art's own colour, so it takes no
//   light at all (`keepsArtColour`); its region slots still recolour.
import { isEmissive, MAX_REGION_SLOTS, regionKey, type Layer, type Look, type Rig } from "@sr/rig";
import type { Rgb } from "./frame.js";

export const S_KEEP = 0.85;
export const S_FLOOR = 0.6;
/** Emissive pixels at or below this saturation (white highlights) keep their paint under the glow light. */
export const GLOW_SATURATION = 0.25;

/** Hue, saturation, lightness, each 0..1. */
export type Hsl = [h: number, s: number, l: number];

const HEX = /^#[0-9a-f]{6}$/i;

/** The classic HSL of 0..1 RGB (h 0..1; grey has h = s = 0). */
export function rgbToHsl(rgb: Rgb): Hsl {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d <= 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, Math.min(1, s), l];
}

/** HSL -> 0..1 RGB, the branch-free form the shader uses. */
export function hslToRgb(hsl: Hsl): Rgb {
  const [h, s, l] = hsl;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const k = (offset: number): number => {
    const x = (((h * 6 + offset) % 6) + 6) % 6;
    return l + c * (Math.min(1, Math.max(0, Math.abs(x - 3) - 1)) - 0.5);
  };
  return [k(0), k(4), k(2)];
}

/** "#rrggbb" -> its HSL; anything else is black. */
export function hexToHsl(hex: string): Hsl {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) return [0, 0, 0];
  return rgbToHsl([parseInt(m[1] ?? "0", 16) / 255, parseInt(m[2] ?? "0", 16) / 255, parseInt(m[3] ?? "0", 16) / 255]);
}

/** The lightness map's guard: lr and lt are clamped to [L_EPS, 1 - L_EPS] (1/256, half an 8-bit step). */
export const L_EPS = 1 / 256;
/** `ref` for "keep the source's lightness" (the lights, and a slot with no readable reference). */
export const KEEP_L = -1;

/**
 * The lightness map: `l` through (0,0) - (lr,lt) - (1,1); `lr` < 0 (KEEP_L) returns `l` unchanged.
 * Continuous, monotonic, 0 -> 0, 1 -> 1, lr -> lt, the identity when lt == lr.
 */
export function mapLightness(l: number, lr: number, lt: number): number {
  if (lr < 0) return l;
  const r = Math.min(1 - L_EPS, Math.max(L_EPS, lr));
  const t = Math.min(1 - L_EPS, Math.max(L_EPS, lt));
  return l <= r ? (l * t) / r : t + ((l - r) * (1 - t)) / (1 - r);
}

/**
 * The rule on a source already in HSL: the target's hue, mostly its saturation, and the source's
 * lightness mapped by `ref` (a region slot's reference lightness; KEEP_L for a light).
 */
export function recolourHsl(src: Hsl, target: Hsl, ref: number = KEEP_L): Rgb {
  const st = target[1];
  return hslToRgb([target[0], Math.max(st * S_KEEP + src[1] * (1 - S_KEEP), S_FLOOR * st), mapLightness(src[2], ref, target[2])]);
}

/** The rule on 0..1 RGB toward `target` ("#rrggbb" or HSL); `ref` as `recolourHsl`. */
export function recolourRgb(src: Rgb, target: string | Hsl, ref: number = KEEP_L): Rgb {
  return recolourHsl(rgbToHsl(src), typeof target === "string" ? hexToHsl(target) : target, ref);
}

export type LightMode = "all" | "saturated";

export interface LayerLight {
  /** Which palette light it is. */
  name: "eye" | "glow" | "mouth";
  target: Hsl;
  mode: LightMode;
}

/** What a look does to one layer's pixels. Absent (undefined) means: draw it as painted. */
export interface LayerRecolour {
  /** Stable for equal recolours: the canvas2d cache key. */
  key: string;
  light?: LayerLight;
  /** Per slot index (map value - 1), the target; length MAX_REGION_SLOTS, undefined = as painted. */
  slots: readonly (Hsl | undefined)[];
  /**
   * Per slot index, the lightness its pixels map from (`mapLightness`'s lr): the slot's reference
   * hex's lightness when the slot is `shade: "move"` and `look.regions` names its colour; KEEP_L
   * otherwise (no flag, the mouth light on a cavity, off). Length MAX_REGION_SLOTS.
   */
  refs: readonly number[];
  /**
   * companion-lanes round 5 (`LayerRegions.soft`): the map's G is the pixel's coverage of its slot,
   * and a slot's colour is mixed over what the pixel would be without it by that coverage. Absent =
   * coverage 1 on every slot pixel (the old path, exactly).
   */
  soft?: true;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** An eye or iris whose light keeps the art's colour (`Layer.tint` false): no eye colour, eyeGain only. */
export const keepsArtColour = (layer: Pick<Layer, "kind" | "tint">): boolean => layer.tint === false && (layer.kind === "eye" || layer.kind === "iris");

/** The light a layer takes for `look`, when that light differs from the rig's palette. */
function lightOf(rig: Pick<Rig, "palette">, layer: Layer, look: Pick<Look, "palette">): LayerLight | undefined {
  if (keepsArtColour(layer)) return undefined;
  const pick = (name: LayerLight["name"], mode: LightMode): LayerLight | undefined => {
    const hex = look.palette[name];
    return HEX.test(hex) && !same(hex, rig.palette[name]) ? { name, target: hexToHsl(hex), mode } : undefined;
  };
  // face-control: on an eye with a socket the eye light recolours its iris, not the white and lids.
  if (layer.kind === "iris" || (layer.kind === "eye" && layer.socket === undefined)) return pick("eye", "all");
  if (layer.name === "mouth_glow") return pick("mouth", "all");
  if (isEmissive(layer)) return pick("glow", "saturated");
  return undefined;
}

/** The look's recolour of `layer`, or undefined when it draws as painted (the old path). */
export function layerRecolour(rig: Pick<Rig, "palette">, layer: Layer, look: Pick<Look, "palette" | "regions">): LayerRecolour | undefined {
  const light = lightOf(rig, layer, look);
  const slots: (Hsl | undefined)[] = new Array<Hsl | undefined>(MAX_REGION_SLOTS).fill(undefined);
  const refs: number[] = new Array<number>(MAX_REGION_SLOTS).fill(KEEP_L);
  const keys: string[] = [];
  const mouth = look.palette.mouth;
  const mouthOn = HEX.test(mouth) && !same(mouth, rig.palette.mouth);
  (layer.regions?.slots ?? []).slice(0, MAX_REGION_SLOTS).forEach((slot, i) => {
    const key = regionKey(layer.name, slot.id);
    const own = look.regions !== undefined && Object.hasOwn(look.regions, key) ? look.regions[key] : undefined;
    const region = own !== undefined && HEX.test(own);
    const hex = region ? own : slot.id === "cavity" && mouthOn ? mouth : undefined;
    if (hex === undefined) return;
    slots[i] = hexToHsl(hex);
    // A region colour on a `shade: "move"` slot moves lightness from the slot's reference; every
    // other slot (the forge's lightness bands, the whole cast) and the mouth light keep the art's.
    if (region && slot.shade === "move" && HEX.test(slot.hex)) refs[i] = hexToHsl(slot.hex)[2];
    keys.push(`${i}${hex.toLowerCase()}`);
  });
  if (light === undefined && keys.length === 0) return undefined;
  const lightKey = light === undefined ? "-" : `${light.name}${look.palette[light.name].toLowerCase()}`;
  const soft = layer.regions?.soft === true && keys.length > 0;
  return { key: `${lightKey}|${keys.join(",")}${soft ? "|s" : ""}`, ...(light === undefined ? {} : { light }), slots, refs, ...(soft ? { soft: true as const } : {}) };
}

/** Every layer's recolour for `look`, by layer name (layers drawn as painted are absent). */
export function rigRecolours(rig: Rig, look: Pick<Look, "palette" | "regions">): Map<string, LayerRecolour> {
  const out = new Map<string, LayerRecolour>();
  for (const layer of rig.layers) {
    const plan = layerRecolour(rig, layer, look);
    if (plan !== undefined && !out.has(layer.name)) out.set(layer.name, plan);
  }
  return out;
}

/** Whether any slot of the plan is on (the index map is needed). */
export const needsMap = (plan: LayerRecolour): boolean => plan.slots.some((s) => s !== undefined);

/**
 * Where a quad's uv lands in its layer's index map: `[u0, v0, du, dv]`, map uv = (u0, v0) + uv *
 * (du, dv). The base quad is `[0, 0, 1, 1]`; a face patch at `patch` (canvas px) covers its part.
 */
export function mapRect(layerBbox: readonly number[], patchBbox: readonly number[]): [number, number, number, number] {
  const [lx = 0, ly = 0, lw = 1, lh = 1] = layerBbox;
  const [px = 0, py = 0, pw = 0, ph = 0] = patchBbox;
  return [(px - lx) / lw, (py - ly) / lh, pw / lw, ph / lh];
}

/** The index map read for a canvas2d recolour: straight RGBA, R = slot index + 1 (G = coverage on a soft layer). */
export interface IndexMap {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** As `mapRect`. */
  rect: readonly [number, number, number, number];
}

/** The byte offset of the nearest map texel under pixel (x, y) of a `w` x `h` image; -1 outside the map. */
function texelAt(map: IndexMap, x: number, y: number, w: number, h: number): number {
  const u = map.rect[0] + ((x + 0.5) / w) * map.rect[2];
  const v = map.rect[1] + ((y + 0.5) / h) * map.rect[3];
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return -1;
  const mx = Math.min(map.width - 1, Math.floor(u * map.width));
  const my = Math.min(map.height - 1, Math.floor(v * map.height));
  return (my * map.width + mx) * 4;
}

/** The slot index (0 none, 1..4) under pixel (x, y) of a `w` x `h` image, nearest map texel. */
export function slotAt(map: IndexMap, x: number, y: number, w: number, h: number): number {
  const at = texelAt(map, x, y, w, h);
  return at < 0 ? 0 : (map.data[at] ?? 0);
}

/**
 * A soft slot's mix (round 5): `over` (the slot's recolour) on `under` (the pixel without the slot:
 * the light's result, or the art) by coverage `c` 0..1; c >= 1 is `over` itself, the binary path.
 * GLSL: `mix(under, over, c)` (programs.ts), the same expression per channel.
 */
export function softMix(under: Rgb, over: Rgb, c: number): Rgb {
  if (c >= 1) return over;
  return [under[0] * (1 - c) + over[0] * c, under[1] * (1 - c) + over[1] * c, under[2] * (1 - c) + over[2] * c];
}

/**
 * Recolours straight (not premultiplied) RGBA pixels of a `w` x `h` image in place: the light on
 * the pixels its mode selects, then each enabled region slot's colour on its own pixels.
 */
export function recolourPixels(data: Uint8ClampedArray, w: number, h: number, plan: LayerRecolour, map?: IndexMap): void {
  const light = plan.light;
  const useMap = map !== undefined && needsMap(plan);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if ((data[i + 3] ?? 0) === 0) continue;
      const hsl = rgbToHsl([(data[i] ?? 0) / 255, (data[i + 1] ?? 0) / 255, (data[i + 2] ?? 0) / 255]);
      let target: Hsl | undefined;
      let ref = KEEP_L;
      let cover = 1;
      let lit: Hsl | undefined;
      if (light !== undefined && (light.mode === "all" || hsl[1] > GLOW_SATURATION)) target = lit = light.target;
      if (useMap) {
        const at = texelAt(map, x, y, w, h);
        const slot = at < 0 ? 0 : (map.data[at] ?? 0);
        const own = slot >= 1 && slot <= MAX_REGION_SLOTS ? plan.slots[slot - 1] : undefined;
        if (own !== undefined) {
          target = own;
          ref = plan.refs[slot - 1] ?? KEEP_L;
          if (plan.soft === true) cover = (map.data[at + 1] ?? 0) / 255;
        }
      }
      if (target === undefined) continue;
      const over = recolourHsl(hsl, target, ref);
      // Soft (round 5): the slot's colour over the pixel without it (the light's result, or the art).
      const [r, g, b] = cover >= 1 ? over : softMix(lit === undefined ? [(data[i] ?? 0) / 255, (data[i + 1] ?? 0) / 255, (data[i + 2] ?? 0) / 255] : recolourHsl(hsl, lit), over, cover);
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
    }
  }
}
