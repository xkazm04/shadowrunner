// The drawn mouth (spark llm-avatar-lab, lab round 2 "precise and very solid"), painted in the
// head's frame (rig px) so it rides every head motion:
//  1. a skin patch (the sampled skin, top to chin, feathered to nothing at its edge) hides the
//     art's own lips wholly under the drawn mouth (the opaque core reaches past the corners), so
//     there is never a second mouth;
//  2. the lips (the outer shape), the dark inside, and clipped to the inside the upper teeth and
//     the tongue; a closed or pressed mouth is a lip line.
// Emotion (mouth/emotion.ts) bends it: smile lifts both corners (a frown drops them), skew lifts
// one corner and slides the curve toward it, snarl raises the upper lip over bared upper teeth,
// tight thins the lips to a pressed line; a lifted or dropped corner gets a short crease.
// Everything scales with the mouth's own width, so it fits any rig with a jaw.
import type { Affine } from "../render/frame.js";
import type { MouthAnchor } from "./anchor.js";
import { css, defaultMouthSurface, type MouthColours, type MouthSurface, type MouthSurfaceFactory, type MouthRgb, type Mouth2D } from "./colours.js";
import type { MouthParams } from "./shapes.js";

/**
 * The skin patch, in mouth widths about (cx, lineY): opaque from `top` above the line to `bottom`
 * below it and `half` to each side, feathered to nothing over `feather` beyond that. Sized for
 * neutral lips: the rig owns the mouth, so expression art carries no mouth of its own (Rig.mouth).
 */
export const PATCH = { half: 0.6, top: 0.18, bottom: 0.24, feather: 0.1 } as const;

type Surface = MouthSurface["canvas"];

/** The skin patch for one geometry + colour pair, cached (rebuilt when either changes). */
export function createPatchCache(surface: MouthSurfaceFactory = defaultMouthSurface): (anchor: MouthAnchor, colours: MouthColours) => { image: Surface; x: number; y: number; w: number; h: number } | undefined {
  let key = "";
  let keyColours: MouthColours | undefined;
  let keyGeometry = [NaN, NaN, NaN];
  let built: { image: Surface; x: number; y: number; w: number; h: number } | undefined;
  return (anchor, colours) => {
    const { cx, lineY, width } = anchor.geometry;
    // Same colours object and geometry: the cached patch, with no string built per frame.
    if (built !== undefined && colours === keyColours && keyGeometry[0] === cx && keyGeometry[1] === lineY && keyGeometry[2] === width) return built;
    const next = `${cx}|${lineY}|${width}|${colours.skinTop.join()}|${colours.skinBottom.join()}`;
    keyColours = colours;
    keyGeometry = [cx, lineY, width];
    if (next === key && built !== undefined) return built;
    const f = PATCH.feather / (2 * (PATCH.half + PATCH.feather));
    const w = Math.max(2, Math.ceil(2 * (PATCH.half + PATCH.feather) * width));
    const span = PATCH.top + PATCH.bottom + 2 * PATCH.feather;
    const h = Math.max(2, Math.ceil(span * width));
    const made = surface(w, h);
    if (made === null) return undefined;
    const { canvas: image, g } = made;
    const fill = g.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, css(colours.skinTop));
    fill.addColorStop(1, css(colours.skinBottom));
    g.fillStyle = fill;
    g.fillRect(0, 0, w, h);
    // Feather: two ramps multiplied (destination-in twice), so the corners round off softly.
    g.globalCompositeOperation = "destination-in";
    const across = g.createLinearGradient(0, 0, w, 0);
    const down = g.createLinearGradient(0, 0, 0, h);
    const fy = PATCH.feather / span;
    for (const [grad, edge] of [
      [across, f],
      [down, fy],
    ] as const) {
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(edge, "rgba(0, 0, 0, 1)");
      grad.addColorStop(1 - edge, "rgba(0, 0, 0, 1)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    key = next;
    const pw = 2 * (PATCH.half + PATCH.feather) * width;
    built = { image, x: cx - pw / 2, y: lineY - (PATCH.top + PATCH.feather) * width, w: pw, h: span * width };
    return built;
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A mouth's centre (cx, y) and its two corners, which emotion lifts or drops (rig px). */
export interface MouthFrame2D {
  cx: number;
  y: number;
  xl: number;
  yl: number;
  xr: number;
  yr: number;
}

/** Corners from the params: smile lifts both (negative drops them), skew lifts one side. */
export function mouthFrame(cx: number, y: number, hw: number, width: number, p: Pick<MouthParams, "smile" | "skew">): MouthFrame2D {
  const lift = width * 0.11 * p.smile;
  const tilt = width * 0.11 * p.skew;
  const shift = width * 0.05 * p.skew;
  const up = Math.max(0, tilt);
  const down = Math.max(0, -tilt);
  return {
    cx: cx + shift,
    y,
    xl: cx - hw + shift * 0.4,
    yl: y - lift - down + 0.2 * up,
    xr: cx + hw + shift * 0.4,
    yr: y - lift - up + 0.2 * down,
  };
}

const level = (cx: number, y: number, hw: number): MouthFrame2D => ({ cx, y, xl: cx - hw, yl: y, xr: cx + hw, yr: y });

/**
 * A lens-to-ellipse mouth outline through the frame's corners: `up` above the centre, `down`
 * below, `grow` px added outside each corner. `round` 0 is a lens with pointed corners, 1 an ellipse.
 */
function outline(g: Mouth2D, f: MouthFrame2D, up: number, down: number, round: number, grow = 0): void {
  const a = lerp(0.25, 0, round);
  const b = lerp(0.05, 0.5523, round);
  const c = lerp(0.62, 0.5523, round);
  const xl = f.xl - grow;
  const xr = f.xr + grow;
  const hl = f.cx - xl;
  const hr = xr - f.cx;
  g.beginPath();
  g.moveTo(xl, f.yl);
  g.bezierCurveTo(xl + hl * a, f.yl - up * b, f.cx - hl * c, f.y - up, f.cx, f.y - up);
  g.bezierCurveTo(f.cx + hr * c, f.y - up, xr - hr * a, f.yr - up * b, xr, f.yr);
  g.bezierCurveTo(xr - hr * a, f.yr + down * b, f.cx + hr * c, f.y + down, f.cx, f.y + down);
  g.bezierCurveTo(f.cx - hl * c, f.y + down, xl + hl * a, f.yl + down * b, xl, f.yl);
  g.closePath();
}

const setAffine = (g: Mouth2D, m: Affine): void => g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

const lift = (c: MouthRgb, k: number): MouthRgb => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

export interface PaintInput {
  anchor: MouthAnchor;
  params: MouthParams;
  colours: MouthColours;
  /** 0..1: how much of the drawn mouth replaces the art's own (0 = the art untouched). */
  alpha: number;
  /** 0..1 share of `alpha` the lips are drawn at (default 1); the cover always takes all of it. */
  lips?: number;
}

export type PatchCache = ReturnType<typeof createPatchCache>;

/**
 * The skin patch over the art's lips. It reaches full cover at half the mouth's alpha, so while a
 * drawn mouth fades in the art's lips are already gone (never two mouths, only a faint one).
 */
export function paintCover(g: Mouth2D, anchor: MouthAnchor, colours: MouthColours, alpha: number, patches: PatchCache): void {
  const a = Math.min(1, Math.max(0, alpha) * 2) * anchor.opacity;
  if (!(a > 0.001)) return;
  const patch = patches(anchor, colours);
  if (patch === undefined) return;
  g.save();
  setAffine(g, anchor.affine);
  g.globalAlpha = a;
  g.drawImage(patch.image, patch.x, patch.y, patch.w, patch.h);
  g.restore();
}

/** A short crease beside each corner the emotion moved (a cheek pulled up, or a sulk's fold). */
function creases(g: Mouth2D, f: MouthFrame2D, width: number, colour: MouthRgb, alpha: number): void {
  const corners: readonly (readonly [x: number, y: number, side: number])[] = [
    [f.xl, f.yl, -1],
    [f.xr, f.yr, 1],
  ];
  for (const [x, y, side] of corners) {
    const moved = Math.abs(f.y - y) / (width * 0.11);
    const k = Math.min(1, Math.max(0, (moved - 0.3) / 0.5));
    if (!(k > 0.01)) continue;
    const dir = y < f.y ? -1 : 1;
    const ox = x + side * width * 0.035;
    g.beginPath();
    g.moveTo(ox, y + dir * width * 0.06);
    g.quadraticCurveTo(ox + side * width * 0.035, y, ox, y - dir * width * 0.03);
    g.lineWidth = width * 0.016;
    g.lineCap = "round";
    g.strokeStyle = css(colour, alpha * 0.55 * k);
    g.stroke();
  }
}

/** Paints one frame of the drawn mouth into `g` (the cover first, then the lips at `lips` x alpha). */
export function paintMouth(g: Mouth2D, input: PaintInput, patches: PatchCache): void {
  const { anchor, params: p, colours, alpha } = input;
  paintCover(g, anchor, colours, alpha, patches);
  const a = Math.min(1, Math.max(0, alpha)) * Math.min(1, Math.max(0, input.lips ?? 1)) * anchor.opacity;
  if (!(a > 0.001)) return;
  const { cx, lineY, width, maxOpen } = anchor.geometry;
  g.save();
  setAffine(g, anchor.affine);
  g.globalAlpha = a;

  const hw = (width / 2) * p.width;
  const inner = Math.max(p.open * maxOpen, anchor.gap * 0.9);
  const up = inner * 0.28;
  const down = inner * 0.72;
  // The snarl raises the upper lip off the teeth even with the jaw shut.
  const snarlUp = p.snarl * width * 0.1;
  const f = mouthFrame(cx, lineY + width * 0.02, hw, width, p);
  const thin = 1 - 0.55 * p.tight;
  const lipUp = width * (0.07 + 0.04 * p.round) * (1 - 0.25 * p.press) * thin * (1 - 0.3 * p.snarl);
  const lipDown = width * (0.09 + 0.05 * p.round) * (1 - 0.2 * p.press) * thin;

  // Lips: the outer shape, a little wider than the inside so the corners close.
  outline(g, f, up + snarlUp + lipUp, down + lipDown, p.round, width * 0.04);
  g.fillStyle = css(colours.lip);
  g.fill();
  // A soft light on the lower lip, where the face's light lands.
  g.globalAlpha = a * 0.35;
  outline(g, level(f.cx, f.y + down + lipDown * 0.45, hw * 0.55), lipDown * 0.12, lipDown * 0.25, 1);
  g.fillStyle = css(lift(colours.lip, 1.6));
  g.fill();
  g.globalAlpha = a;

  const innerUp = up + snarlUp;
  if (innerUp + down > width * 0.012) {
    outline(g, f, innerUp, down, p.round);
    g.fillStyle = css(colours.inner);
    g.fill();
    g.save();
    g.clip();
    const bared = Math.min(1, p.snarl * 2);
    const teethH = Math.max(Math.min(inner * 0.45, width * 0.09) * p.teeth, (snarlUp + down * 0.3) * bared);
    if (teethH > width * 0.004) {
      const top = Math.min(f.yl, f.yr, f.y - innerUp) - 1;
      const bottom = f.y - innerUp + teethH;
      g.fillStyle = css(colours.teeth);
      g.fillRect(f.xl, top, f.xr - f.xl, bottom - top);
      if (bared > 0.2) {
        // Seams between the bared teeth, so a snarl reads as teeth and not a pale lip.
        g.strokeStyle = css(colours.inner, 0.45 * bared);
        g.lineWidth = width * 0.008;
        g.beginPath();
        for (const t of [-0.5, -0.17, 0.17, 0.5]) {
          const x = f.cx + t * (f.xr - f.xl) * 0.6;
          g.moveTo(x, top);
          g.lineTo(x, bottom);
        }
        g.stroke();
      }
    }
    if (p.tongue > 0.02 && down > 0) {
      const tongueH = down * (0.45 + 0.35 * p.tongue);
      outline(g, level(f.cx, f.y + down + tongueH * 0.15, hw * 0.62), tongueH, tongueH * 0.2, 1);
      g.fillStyle = css(colours.tongue);
      g.fill();
    }
    g.restore();
  } else {
    // Closed: a lip line through the corners, heavier when pressed or tight.
    const sag = width * 0.015 * (1 - p.press);
    g.beginPath();
    g.moveTo(f.xl, f.yl);
    g.quadraticCurveTo(f.cx, 2 * (f.y + sag) - (f.yl + f.yr) / 2, f.xr, f.yr);
    g.lineWidth = width * (0.018 + 0.014 * Math.max(p.press, p.tight));
    g.lineCap = "round";
    g.strokeStyle = css(colours.inner);
    g.stroke();
  }
  creases(g, f, width, colours.inner, a);
  g.restore();
}
