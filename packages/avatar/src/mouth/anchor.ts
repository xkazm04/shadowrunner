// Where the drawn mouth goes this frame: on the rig's measured mouth (Rig.mouth), in the head's frame
// (the jaw's parent), so it rides every head motion; the jaw's own drop, measured in that frame, is
// how far the lower lip has moved. A rig without `mouth` has no anchor: its art keeps its own mouth
// and the player never guesses a place for one.
import type { Layer, LayerPose, RigMouth } from "@sr/rig";
import { applyAffine, layerAffine, type Affine, type View } from "../render/frame.js";

export function invertAffine(m: Affine): Affine | undefined {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) return undefined;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** The rest mouth in rig px, and the largest inner opening the mouth draws. */
export interface MouthGeometry {
  cx: number;
  lineY: number;
  width: number;
  maxOpen: number;
  /** Pixel art: canvas px of one art pixel (`RigMouth.cell`); the mouth paints on that grid. */
  cell?: number;
}

/** The crop about the mouth, in mouth widths from (cx, lineY): the skin cover and the widest mouth fit. */
export const MOUTH_BOX = { left: 0.75, up: 0.36, width: 1.5, height: 1.06 } as const;

export const OPEN_OF_WIDTH = 0.32;

/** A usable measured mouth (finite, positive width), or undefined. */
export function mouthGeometry(mouth: RigMouth | undefined): MouthGeometry | undefined {
  if (mouth === undefined || !Number.isFinite(mouth.cx) || !Number.isFinite(mouth.lineY) || !Number.isFinite(mouth.width) || !(mouth.width > 0)) return undefined;
  const width = Math.max(1, mouth.width);
  const cell = typeof mouth.cell === "number" && Number.isFinite(mouth.cell) && mouth.cell > 0 ? mouth.cell : undefined;
  return { cx: mouth.cx, lineY: mouth.lineY, width, maxOpen: width * OPEN_OF_WIDTH, ...(cell === undefined ? {} : { cell }) };
}

/** The geometry of a mouth the player paints: only a usable `rig.mouth` marked `render: "drawn"`. */
export function drawnMouthGeometry(mouth: RigMouth | undefined): MouthGeometry | undefined {
  return mouth?.render === "drawn" ? mouthGeometry(mouth) : undefined;
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

/** A layer and its pose, as drawn this frame. */
export interface Posed {
  layer: Layer;
  pose: LayerPose;
  /** Index in the frame's poses (draw order). */
  index: number;
}

/** The jaw and the layer the mouth is drawn in (the jaw's `follow`, else the head), in this frame. */
export function mouthLayers(layers: ReadonlyMap<string, Layer>, poses: readonly LayerPose[]): { jaw: Posed; head: Posed | undefined } | undefined {
  let jaw: Posed | undefined;
  for (let i = 0; i < poses.length && jaw === undefined; i += 1) {
    const pose = poses[i];
    const layer = pose === undefined ? undefined : layers.get(pose.name);
    if (pose !== undefined && layer?.kind === "jaw") jaw = { layer, pose, index: i };
  }
  if (jaw === undefined) return undefined;
  let head: Posed | undefined;
  let byKind: Posed | undefined;
  for (let i = 0; i < poses.length; i += 1) {
    const pose = poses[i];
    const layer = pose === undefined ? undefined : layers.get(pose.name);
    if (pose === undefined || layer === undefined) continue;
    if (layer.name === jaw.layer.follow) head = { layer, pose, index: i };
    if (byKind === undefined && layer.kind === "head") byKind = { layer, pose, index: i };
  }
  return { jaw, head: head ?? byKind };
}

/** The mouth in this frame, or undefined (no measured mouth, or no jaw drawn). */
export function anchorOf(geometry: MouthGeometry, jaw: Posed, head: Posed | undefined, view: View, browY: number): MouthAnchor {
  const jawAffine = layerAffine(jaw.layer, jaw.pose, view, browY);
  const frame = head === undefined ? jawAffine : layerAffine(head.layer, head.pose, view, browY);
  let gap = 0;
  const inverse = head === undefined ? undefined : invertAffine(frame);
  if (inverse !== undefined) {
    const [dx, dy] = applyAffine(jawAffine, geometry.cx, geometry.lineY);
    gap = Math.max(0, applyAffine(inverse, dx, dy)[1] - geometry.lineY);
  }
  return { geometry, affine: frame, gap, opacity: Math.min(1, Math.max(0, jaw.pose.opacity)) };
}
