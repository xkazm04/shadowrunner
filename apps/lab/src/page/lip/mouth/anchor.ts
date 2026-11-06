// The mouth in this frame (anchor.ts): the mouth is drawn in the jaw's parent frame (the head),
// so it follows every head motion; the jaw's own drop, measured in that frame, is how far the
// lower lip has moved. Read from player.layerFrames() (@sr/avatar, read-only).
import type { Affine, LayerFrame } from "@sr/avatar/core";
import { mouthGeometry, type MeasuredMouth, type MouthGeometry } from "./geometry.js";

export function invertAffine(m: Affine): Affine | undefined {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) return undefined;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export interface MouthAnchor {
  geometry: MouthGeometry;
  /** Rig px -> device px in the head's frame: set it on the context and draw in rig px. */
  affine: Affine;
  /** How far the jaw has dropped below its rest place, rig px in the head's frame (>= 0). */
  gap: number;
  /** The jaw layer's opacity this frame. */
  opacity: number;
}

/**
 * The mouth in this frame, or undefined when the rig has no jaw (nothing to track). `measured` is
 * the rig's own mouth (Rig.mouth) when it has one; otherwise the place is guessed from the jaw.
 */
export function mouthAnchor(frames: readonly LayerFrame[], measured?: MeasuredMouth): MouthAnchor | undefined {
  const jaw = frames.find((f) => f.layer.kind === "jaw");
  if (jaw === undefined) return undefined;
  const head = frames.find((f) => f.layer.name === jaw.layer.follow) ?? frames.find((f) => f.layer.kind === "head");
  const geometry = mouthGeometry(jaw.layer, head?.layer, measured);
  const frame = head ?? jaw;
  const inverse = invertAffine(frame.affine);
  let gap = 0;
  if (head !== undefined && inverse !== undefined) {
    const [dx, dy] = apply(jaw.affine, geometry.cx, geometry.lineY);
    gap = Math.max(0, apply(inverse, dx, dy)[1] - geometry.lineY);
  }
  return { geometry, affine: frame.affine, gap, opacity: jaw.opacity };
}
