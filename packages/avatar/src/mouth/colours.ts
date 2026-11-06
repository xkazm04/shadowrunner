// The drawn mouth's colours, taken from the character's own art around the mouth (so the mouth reads
// as part of the face, not a sticker): skin above the lip and on the chin, and the lips, inside,
// teeth and tongue derived from them. The skin is read once per rig from the rest art (every layer
// the rig draws, in z order, at its bbox), never from a drawn frame: a WebGL frame cannot be read
// back cheaply, and the rest art holds the neutral lips the forge keeps (Rig.mouth). A look's
// recolour is not applied to the sample.
import type { Rig, RigMouth } from "@sr/rig";
import { BACKDROP_LAYER } from "../player/cutout.js";
import type { RigAssets } from "../render/types.js";

export type MouthRgb = readonly [r: number, g: number, b: number];

export interface MouthColours {
  skinTop: MouthRgb;
  skinBottom: MouthRgb;
  lip: MouthRgb;
  inner: MouthRgb;
  teeth: MouthRgb;
  tongue: MouthRgb;
}

const clamp = (v: number): number => Math.round(Math.min(255, Math.max(0, v)));
const scale = (c: MouthRgb, k: number): MouthRgb => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];
const mix = (a: MouthRgb, b: MouthRgb, t: number): MouthRgb => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
const luma = (c: MouthRgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Lips, inside and teeth from the two skin samples. */
export function deriveColours(skinTop: MouthRgb, skinBottom: MouthRgb): MouthColours {
  const skin = mix(skinTop, skinBottom, 0.5);
  const lip = scale(skin, 0.58);
  // Teeth: the skin's hue lifted most of the way to its own brightest channel, so a grey face gets
  // bone and a green one a sickly ivory, never a pasted white.
  const peak = Math.max(skin[0], skin[1], skin[2], 1);
  const bright: MouthRgb = scale(skin, Math.min(3, 225 / peak));
  const teeth = mix(skin, bright, 0.75);
  const inner = scale(skin, 0.1);
  // The tongue sits in the dark: the lip colour, a touch warmer, half lit.
  const tongue: MouthRgb = [clamp(lip[0] * 0.9 + 12), clamp(lip[1] * 0.7), clamp(lip[2] * 0.7)];
  return { skinTop, skinBottom, lip, inner, teeth, tongue: luma(tongue) > luma(lip) ? scale(tongue, 0.85) : tongue };
}

export const css = (c: MouthRgb, alpha = 1): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

/** A 2D context the mouth paints on (a full context: paths, gradients, transforms). */
export type Mouth2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A 2D canvas the mouth paints on. */
export interface MouthSurface {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  g: Mouth2D;
}

/** Makes a `w` x `h` 2D surface, or null when the platform has none (then no mouth is drawn). */
export type MouthSurfaceFactory = (w: number, h: number) => MouthSurface | null;

export const defaultMouthSurface: MouthSurfaceFactory = (w, h) => {
  try {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(w, h);
      const g = canvas.getContext("2d");
      return g === null ? null : { canvas, g };
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d");
      return g === null ? null : { canvas, g };
    }
  } catch {
    // No 2D surface here: the mouth is not drawn.
  }
  return null;
};

/** The mean opaque colour of `data` (a w x h RGBA box) in the box (x0, y0, size) clipped to it. */
function meanAt(data: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, size: number): MouthRgb | undefined {
  let n = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + size); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + size); x += 1) {
      const i = (y * w + x) * 4;
      if ((data[i + 3] ?? 0) < 200) continue;
      red += data[i] ?? 0;
      green += data[i + 1] ?? 0;
      blue += data[i + 2] ?? 0;
      n += 1;
    }
  }
  return n === 0 ? undefined : [clamp(red / n), clamp(green / n), clamp(blue / n)];
}

/**
 * Skin above the upper lip and on the chin, read from the rig's rest art. Undefined when there is
 * no 2D surface or either point is off the art (transparent): then the mouth is not drawn.
 */
export function sampleArt(rig: Rig, assets: RigAssets, mouth: RigMouth, surface: MouthSurfaceFactory = defaultMouthSurface): MouthColours | undefined {
  const { cx, lineY, width } = mouth;
  const r = Math.max(1, Math.round(width * 0.05));
  const x0 = Math.floor(cx - r);
  const y0 = Math.floor(lineY - width * 0.22 - r);
  const yBottom = Math.floor(lineY + width * 0.42 - r);
  const size = 2 * r + 1;
  const w = size;
  const h = yBottom - y0 + size;
  const s = surface(w, h);
  if (s === null) return undefined;
  try {
    for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
      const image = assets[layer.file];
      if (layer.visible === false || layer.name === BACKDROP_LAYER || image === undefined) continue;
      const [bx, by, bw, bh] = layer.bbox;
      if (bx > x0 + w || by > y0 + h || bx + bw < x0 || by + bh < y0) continue;
      s.g.drawImage(image, bx - x0, by - y0, bw, bh);
    }
    const data = s.g.getImageData(0, 0, w, h).data;
    const top = meanAt(data, w, h, 0, 0, size);
    const bottom = meanAt(data, w, h, 0, yBottom - y0, size);
    return top === undefined || bottom === undefined ? undefined : deriveColours(top, bottom);
  } catch {
    return undefined;
  }
}
