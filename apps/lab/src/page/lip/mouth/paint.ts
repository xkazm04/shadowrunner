// L1's procedural mouth, painted in the head's frame (rig px) so it rides every head motion:
//  1. a skin patch (the sampled skin, top to chin, feathered to nothing at its edge) hides the
//     painted rest mouth where the drawn one differs from it;
//  2. the lips (the outer shape), the dark inside, and clipped to the inside the upper teeth and
//     the tongue; a closed or pressed mouth is a lip line.
// Everything scales with the mouth's own width, so it fits any rig with a jaw.
import type { Affine } from "@sr/avatar/core";
import { css, type MouthColours, type Rgb } from "./colours.js";
import type { MouthAnchor } from "./anchor.js";
import type { MouthParams } from "./shapes.js";

const PATCH_RX = 0.75;
const PATCH_RY = 0.3;
/** Share of the patch radius that is fully opaque before the feather. */
const PATCH_CORE = 0.62;

type Surface = HTMLCanvasElement | OffscreenCanvas;

function surface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** The skin patch for one geometry + colour pair, cached (rebuilt when either changes). */
export function createPatchCache(): (anchor: MouthAnchor, colours: MouthColours) => { image: Surface; x: number; y: number; w: number; h: number } | undefined {
  let key = "";
  let built: { image: Surface; x: number; y: number; w: number; h: number } | undefined;
  return (anchor, colours) => {
    const { cx, lineY, width } = anchor.geometry;
    const rx = width * PATCH_RX;
    const ry = width * PATCH_RY;
    const next = `${cx}|${lineY}|${width}|${colours.skinTop.join()}|${colours.skinBottom.join()}`;
    if (next === key && built !== undefined) return built;
    const w = Math.max(2, Math.ceil(2 * rx));
    const h = Math.max(2, Math.ceil(2 * ry));
    const image = surface(w, h);
    const g = image.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (g === null) return undefined;
    const fill = g.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, css(colours.skinTop));
    fill.addColorStop(1, css(colours.skinBottom));
    g.fillStyle = fill;
    g.fillRect(0, 0, w, h);
    // Feather: keep the core, fade the rim (an ellipse: a circle gradient squashed to the patch).
    g.globalCompositeOperation = "destination-in";
    g.setTransform(1, 0, 0, h / w, 0, 0);
    const mask = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    mask.addColorStop(0, "rgba(0, 0, 0, 1)");
    mask.addColorStop(PATCH_CORE, "rgba(0, 0, 0, 1)");
    mask.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = mask;
    g.fillRect(0, 0, w, w);
    key = next;
    built = { image, x: cx - rx, y: lineY + width * 0.06 - ry, w: 2 * rx, h: 2 * ry };
    return built;
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * A lens-to-ellipse mouth outline about (cx, y): half-width `hw`, `up` above the line, `down`
 * below. `round` 0 is a lens with pointed corners, 1 an ellipse.
 */
function outline(g: CanvasRenderingContext2D, cx: number, y: number, hw: number, up: number, down: number, round: number): void {
  const a = lerp(0.25, 0, round);
  const b = lerp(0.05, 0.5523, round);
  const c = lerp(0.62, 0.5523, round);
  g.beginPath();
  g.moveTo(cx - hw, y);
  g.bezierCurveTo(cx - hw + hw * a, y - up * b, cx - hw * c, y - up, cx, y - up);
  g.bezierCurveTo(cx + hw * c, y - up, cx + hw - hw * a, y - up * b, cx + hw, y);
  g.bezierCurveTo(cx + hw - hw * a, y + down * b, cx + hw * c, y + down, cx, y + down);
  g.bezierCurveTo(cx - hw * c, y + down, cx - hw + hw * a, y + down * b, cx - hw, y);
  g.closePath();
}

const setAffine = (g: CanvasRenderingContext2D, m: Affine): void => g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

const lift = (c: Rgb, k: number): Rgb => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

export interface PaintInput {
  anchor: MouthAnchor;
  params: MouthParams;
  colours: MouthColours;
  /** 0..1: how much of the drawn mouth replaces the art's own (0 = the art untouched). */
  alpha: number;
}

export type PatchCache = ReturnType<typeof createPatchCache>;

/** Paints one frame of the procedural mouth into `g` (the recorded composite). */
export function paintMouth(g: CanvasRenderingContext2D, input: PaintInput, patches: PatchCache): void {
  const { anchor, params: p, colours, alpha } = input;
  const a = Math.min(1, Math.max(0, alpha)) * anchor.opacity;
  if (!(a > 0.001)) return;
  const { cx, lineY, width, maxOpen } = anchor.geometry;
  g.save();
  setAffine(g, anchor.affine);
  g.globalAlpha = a;
  const patch = patches(anchor, colours);
  if (patch !== undefined) g.drawImage(patch.image, patch.x, patch.y, patch.w, patch.h);

  const hw = (width / 2) * p.width;
  const inner = Math.max(p.open * maxOpen, anchor.gap * 0.9);
  const up = inner * 0.28;
  const down = inner * 0.72;
  const y = lineY + width * 0.02;
  const lipUp = width * (0.07 + 0.04 * p.round) * (1 - 0.25 * p.press);
  const lipDown = width * (0.09 + 0.05 * p.round) * (1 - 0.2 * p.press);

  // Lips: the outer shape, a little wider than the inside so the corners close.
  outline(g, cx, y, hw + width * 0.04, up + lipUp, down + lipDown, p.round);
  g.fillStyle = css(colours.lip);
  g.fill();
  // A soft light on the lower lip, where the face's light lands.
  g.globalAlpha = a * 0.35;
  outline(g, cx, y + down + lipDown * 0.45, hw * 0.55, lipDown * 0.12, lipDown * 0.25, 1);
  g.fillStyle = css(lift(colours.lip, 1.6));
  g.fill();
  g.globalAlpha = a;

  if (inner > width * 0.012) {
    outline(g, cx, y, hw, up, down, p.round);
    g.fillStyle = css(colours.inner);
    g.fill();
    g.save();
    g.clip();
    if (p.teeth > 0.02) {
      const teethH = Math.min(inner * 0.45, width * 0.09) * p.teeth;
      g.fillStyle = css(colours.teeth);
      g.fillRect(cx - hw, y - up - 1, 2 * hw, teethH + 1);
    }
    if (p.tongue > 0.02) {
      const tongueH = down * (0.45 + 0.35 * p.tongue);
      outline(g, cx, y + down + tongueH * 0.15, hw * 0.62, tongueH, tongueH * 0.2, 1);
      g.fillStyle = css(colours.tongue);
      g.fill();
    }
    g.restore();
  } else {
    // Closed: a lip line, heavier when pressed.
    g.beginPath();
    g.moveTo(cx - hw, y);
    g.quadraticCurveTo(cx, y + width * 0.015 * (1 - p.press), cx + hw, y);
    g.lineWidth = width * (0.018 + 0.014 * p.press);
    g.lineCap = "round";
    g.strokeStyle = css(colours.inner);
    g.stroke();
  }
  g.restore();
}
