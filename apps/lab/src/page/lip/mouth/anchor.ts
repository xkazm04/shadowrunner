// The mouth in this frame, for what the lab paints over the player's mouth (L2's forge art, cropped
// by geometry.ts): in the jaw's parent frame (the head), so it follows every head motion; the jaw's
// own drop, measured in that frame, is how far the lower lip has moved. Read from
// player.layerFrames() (@sr/avatar, read-only). The player places its own drawn mouth the same way
// (@sr/avatar mouth/anchor.ts), on Rig.mouth only.
import { applyAffine as apply, invertAffine, type Affine, type LayerFrame } from "@sr/avatar/core";
import { mouthGeometry, type MeasuredMouth, type MouthGeometry } from "./geometry.js";

export { apply, invertAffine };

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
