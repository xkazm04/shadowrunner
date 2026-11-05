// The mouth's colours, taken from the character's own art around the mouth (so the drawn mouth
// reads as part of the face, not a sticker): skin above the lip and on the chin, sampled from the
// composite before anything is painted over it, and the lips, inside and teeth derived from them.
// The derivations are pure (tested); `sampleSkin` reads pixels.
import { apply, type MouthAnchor } from "./anchor.js";

export type Rgb = readonly [r: number, g: number, b: number];

export interface MouthColours {
  skinTop: Rgb;
  skinBottom: Rgb;
  lip: Rgb;
  inner: Rgb;
  teeth: Rgb;
  tongue: Rgb;
}

const clamp = (v: number): number => Math.round(Math.min(255, Math.max(0, v)));
const scale = (c: Rgb, k: number): Rgb => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
const luma = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Lips, inside and teeth from the two skin samples. */
export function deriveColours(skinTop: Rgb, skinBottom: Rgb): MouthColours {
  const skin = mix(skinTop, skinBottom, 0.5);
  const lip = scale(skin, 0.58);
  // Teeth: the skin's hue lifted most of the way to its own brightest channel, so a grey face gets
  // bone and a green one a sickly ivory, never a pasted white.
  const peak = Math.max(skin[0], skin[1], skin[2], 1);
  const bright: Rgb = scale(skin, Math.min(3, 225 / peak));
  const teeth = mix(skin, bright, 0.75);
  const inner = scale(skin, 0.1);
  // The tongue sits in the dark: the lip colour, a touch warmer, half lit.
  const tongue: Rgb = [clamp(lip[0] * 0.9 + 12), clamp(lip[1] * 0.7), clamp(lip[2] * 0.7)];
  return { skinTop, skinBottom, lip, inner, teeth, tongue: luma(tongue) > luma(lip) ? scale(tongue, 0.85) : tongue };
}

export const css = (c: Rgb, alpha = 1): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

/** The mean colour of a small box of device pixels around (x, y). */
function meanAt(g: CanvasRenderingContext2D, x: number, y: number, r: number): Rgb | undefined {
  const x0 = Math.max(0, Math.round(x - r));
  const y0 = Math.max(0, Math.round(y - r));
  const w = Math.min(g.canvas.width - x0, Math.round(2 * r) + 1);
  const h = Math.min(g.canvas.height - y0, Math.round(2 * r) + 1);
  if (w <= 0 || h <= 0) return undefined;
  const data = g.getImageData(x0, y0, w, h).data;
  let n = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 200) continue;
    red += data[i] ?? 0;
    green += data[i + 1] ?? 0;
    blue += data[i + 2] ?? 0;
    n += 1;
  }
  return n === 0 ? undefined : [clamp(red / n), clamp(green / n), clamp(blue / n)];
}

/**
 * Skin above the upper lip and on the chin, read from the composite (back layers + avatar, before
 * any mouth or front painter). Undefined when either point is off the art (transparent).
 */
export function sampleSkin(g: CanvasRenderingContext2D, anchor: MouthAnchor): MouthColours | undefined {
  const { cx, lineY, width } = anchor.geometry;
  const [tx, ty] = apply(anchor.affine, cx, lineY - width * 0.22);
  const [bx, by] = apply(anchor.affine, cx, lineY + width * 0.42);
  const r = Math.max(2, Math.hypot(anchor.affine[0], anchor.affine[1]) * width * 0.05);
  const top = meanAt(g, tx, ty, r);
  const bottom = meanAt(g, bx, by, r);
  return top === undefined || bottom === undefined ? undefined : deriveColours(top, bottom);
}
