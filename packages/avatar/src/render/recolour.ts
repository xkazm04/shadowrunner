// Recolour (character-control design.md "Recolour", req 1, 2.3): the one rule both renderers use,
// in TS (canvas2d and tests) and GLSL (gl/programs.ts, the same expressions), plus the selection
// of which light or region colour a layer's pixels take for a look. Pure, no DOM.
//
//   src (r,g,b) -> HSL (h, s, l); target -> (ht, st, lt)
//   out = HSL->RGB(ht, max(st * S_KEEP + s * (1 - S_KEEP), S_FLOOR * st), l)
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

/** The rule on a source already in HSL: the target's hue, mostly its saturation, the source's lightness. */
export function recolourHsl(src: Hsl, target: Hsl): Rgb {
  const st = target[1];
  return hslToRgb([target[0], Math.max(st * S_KEEP + src[1] * (1 - S_KEEP), S_FLOOR * st), src[2]]);
}

/** The rule on 0..1 RGB toward `target` ("#rrggbb" or HSL). */
export function recolourRgb(src: Rgb, target: string | Hsl): Rgb {
  return recolourHsl(rgbToHsl(src), typeof target === "string" ? hexToHsl(target) : target);
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
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The light a layer takes for `look`, when that light differs from the rig's palette. */
function lightOf(rig: Pick<Rig, "palette">, layer: Layer, look: Pick<Look, "palette">): LayerLight | undefined {
  const pick = (name: LayerLight["name"], mode: LightMode): LayerLight | undefined => {
    const hex = look.palette[name];
    return HEX.test(hex) && !same(hex, rig.palette[name]) ? { name, target: hexToHsl(hex), mode } : undefined;
  };
  if (layer.kind === "eye") return pick("eye", "all");
  if (layer.name === "mouth_glow") return pick("mouth", "all");
  if (isEmissive(layer)) return pick("glow", "saturated");
  return undefined;
}

/** The look's recolour of `layer`, or undefined when it draws as painted (the old path). */
export function layerRecolour(rig: Pick<Rig, "palette">, layer: Layer, look: Pick<Look, "palette" | "regions">): LayerRecolour | undefined {
  const light = lightOf(rig, layer, look);
  const slots: (Hsl | undefined)[] = new Array<Hsl | undefined>(MAX_REGION_SLOTS).fill(undefined);
  const keys: string[] = [];
  const mouth = look.palette.mouth;
  const mouthOn = HEX.test(mouth) && !same(mouth, rig.palette.mouth);
  (layer.regions?.slots ?? []).slice(0, MAX_REGION_SLOTS).forEach((slot, i) => {
    const key = regionKey(layer.name, slot.id);
    const own = look.regions !== undefined && Object.hasOwn(look.regions, key) ? look.regions[key] : undefined;
    const hex = own !== undefined && HEX.test(own) ? own : slot.id === "cavity" && mouthOn ? mouth : undefined;
    if (hex === undefined) return;
    slots[i] = hexToHsl(hex);
    keys.push(`${i}${hex.toLowerCase()}`);
  });
  if (light === undefined && keys.length === 0) return undefined;
  const lightKey = light === undefined ? "-" : `${light.name}${look.palette[light.name].toLowerCase()}`;
  return { key: `${lightKey}|${keys.join(",")}`, ...(light === undefined ? {} : { light }), slots };
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

/** The index map read for a canvas2d recolour: straight RGBA, R = slot index + 1. */
export interface IndexMap {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** As `mapRect`. */
  rect: readonly [number, number, number, number];
}

/** The slot index (0 none, 1..4) under pixel (x, y) of a `w` x `h` image, nearest map texel. */
export function slotAt(map: IndexMap, x: number, y: number, w: number, h: number): number {
  const u = map.rect[0] + ((x + 0.5) / w) * map.rect[2];
  const v = map.rect[1] + ((y + 0.5) / h) * map.rect[3];
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
  const mx = Math.min(map.width - 1, Math.floor(u * map.width));
  const my = Math.min(map.height - 1, Math.floor(v * map.height));
  return map.data[(my * map.width + mx) * 4] ?? 0;
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
      if (light !== undefined && (light.mode === "all" || hsl[1] > GLOW_SATURATION)) target = light.target;
      if (useMap) {
        const slot = slotAt(map, x, y, w, h);
        const own = slot >= 1 && slot <= MAX_REGION_SLOTS ? plan.slots[slot - 1] : undefined;
        if (own !== undefined) target = own;
      }
      if (target === undefined) continue;
      const [r, g, b] = recolourHsl(hsl, target);
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
    }
  }
}
