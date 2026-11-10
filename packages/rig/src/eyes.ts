// Face control in the pose (face-control design "Design brief", WP-A): the pure per-layer pieces
// poseLayers composes for eyes with an iris, the face profile's strengths and the breathing idle.
// Pure, no DOM.
//
// Decisions the brief leaves open (documented here so the renderer, driver and creator agree):
// - An iris (kind "iris") takes its eye's whole transform (the eye's follow chain, float carry and
//   parallax; not the iris's own depth, reshape or float) and moves inside it by the gaze offset:
//   `gaze (-1..1 per axis, clamped) x socket half extents x gaze.range`, in the eye's rest frame,
//   so a turned or scaled head turns the travel with it. The half extents come from the socket
//   mask's alpha box (`SocketBox`, measured by the player once per rig); until it is known the iris
//   rests (offset 0). The eye's own blink and squint squash are not passed on: the renderer clips
//   the iris by the eye's (squashed) socket mask instead, so the lids close over it.
// - An iris is drawn only when its eye is: a look that hides the eye hides its iris.
// - Blink on an eye with `closed` art: no squash; `LayerPose.closed` carries the closure (the
//   renderer draws the closed art over the eye at that weight) and the eye's iris fades by it.
// - Glow (brief "Glow moves to the iris"): an eye with a `socket` gives no light by default
//   (`isEmissive`), the iris does (kind default). The eye's own pulse moves to its iris (an iris
//   with a pulse of its own keeps that one); glare raises an emissive iris as it does an eye.
// - Squint: the mood's squint on an eye is scaled by `1 - (sum of the weights of the faces whose
//   patch is narrowed)`, so a face that already narrows the lids gets no squash on top.
// - expression.strength multiplies every face weight (a weight of 0 is dropped, as before).
// - Breathing (motion.breath): a rise of `breath x BREATH_RISE x height` and a scale of
//   `1 + breath x BREATH_SCALE` (both times `sin(2 pi BREATH_HZ t)`, so the mean is the rest pose)
//   about the anchor of each head or body layer with no head or body ancestor; followers inherit
//   it. Off under `Drive.still`. Only a rig with a face profile (`Rig.face` or `Look.face`), iris
//   layers or morph keys (companion-lanes) breathes: a rig without any keeps today's pose exactly
//   (its default breath is not 0).
// - Pixel art (cast-face-pass): on a rig with `mouth.cell` (the art's pixel, canvas px) the gaze
//   offset is rounded to whole cells (`snapCell`), so an iris steps by art pixels, never between.
import { resolveFace, type ResolvedFace } from "./face.js";
import type { ExpressionFamily, Layer, Look, Rig } from "./types.js";

/** Half extents of an eye's socket (the alpha box of its mask), canvas px of the eye's rest frame. */
export interface SocketBox {
  hx: number;
  hy: number;
}

/** Breathing rate, Hz. */
export const BREATH_HZ = 0.2;
/** Rise at breath 1, as a fraction of rig height. */
export const BREATH_RISE = 0.004;
/** Extra scale at breath 1. */
export const BREATH_SCALE = 0.006;

export type FaceWeights = { family: ExpressionFamily; weight: number }[];

const indexes = new WeakMap<readonly Layer[], { byName: ReadonlyMap<string, Layer>; irises: boolean }>();

/** The rig's layers by name (the first of a name wins) and whether any is an iris; kept per layers array (rigs are not mutated). */
export function layerIndex(rig: Pick<Rig, "layers">): { byName: ReadonlyMap<string, Layer>; irises: boolean } {
  let index = indexes.get(rig.layers);
  if (index === undefined) {
    const byName = new Map<string, Layer>();
    for (const layer of rig.layers) if (!byName.has(layer.name)) byName.set(layer.name, layer);
    index = { byName, irises: rig.layers.some((layer) => layer.kind === "iris") };
    indexes.set(rig.layers, index);
  }
  return index;
}

/** Whether the rig has iris layers (the eyes lead the gaze, face-control). */
export const hasIris = (rig: Pick<Rig, "layers">): boolean => layerIndex(rig).irises;

/** Whether the rig breathes: it has a face profile (rig or look), iris layers or morph keys (companion-lanes). */
export const breathes = (rig: Pick<Rig, "layers" | "face"> & { morph?: Rig["morph"] }, look: Pick<Look, "face">): boolean => rig.face !== undefined || look.face !== undefined || hasIris(rig) || rig.morph !== undefined;

/** The breathing at `t` for amplitude `amp`: a rise (fraction of height, positive up) and a scale; undefined when none. */
export function breathAt(t: number, amp: number, still: boolean): { rise: number; scale: number } | undefined {
  if (still || !(amp > 0) || !Number.isFinite(t)) return undefined;
  const s = Math.sin(2 * Math.PI * BREATH_HZ * t);
  return { rise: amp * BREATH_RISE * s, scale: 1 + amp * BREATH_SCALE * s };
}

/** Face weights times `strength` (0..1); zero weights are dropped and an empty list is undefined. */
export function strengthen(faces: FaceWeights | undefined, strength: number): FaceWeights | undefined {
  if (faces === undefined || strength === 1) return faces;
  const out = faces.map(({ family, weight }) => ({ family, weight: weight * strength })).filter((face) => face.weight > 0);
  return out.length === 0 ? undefined : out;
}

/** The mood squint left on `layer` once its narrowed faces (by weight) have taken their share. */
export function squintOf(layer: Pick<Layer, "variants">, faces: FaceWeights | undefined, squint: number): number {
  let narrowed = 0;
  for (const face of faces ?? []) if (layer.variants?.[face.family]?.narrowed === true) narrowed += face.weight;
  return narrowed <= 0 ? squint : squint * Math.max(0, 1 - narrowed);
}

const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0);

/** The iris move in its eye's rest frame, canvas px: gaze (clamped to -1..1) x half extents x range. */
export function irisOffset(gaze: { x: number; y: number } | undefined, box: SocketBox | undefined, range: number): [number, number] {
  if (gaze === undefined || box === undefined) return [0, 0];
  const r = Number.isFinite(range) ? Math.min(1, Math.max(0, range)) : 0;
  return [unit(gaze.x) * box.hx * r, unit(gaze.y) * box.hy * r];
}

/** The rig's art pixel (`mouth.cell`, canvas px) when usable, else undefined (smooth). */
export function cellOf(rig: Pick<Rig, "mouth">): number | undefined {
  const cell = rig.mouth?.cell;
  return typeof cell === "number" && Number.isFinite(cell) && cell > 0 ? cell : undefined;
}

/** An offset rounded to whole cells (unchanged without a cell). */
export function snapCell(offset: [number, number], cell: number | undefined): [number, number] {
  if (cell === undefined) return offset;
  return [Math.round(offset[0] / cell) * cell, Math.round(offset[1] / cell) * cell];
}

/** The eye layer an iris follows, when it follows one. */
export function eyeOf(layer: Layer, byName: ReadonlyMap<string, Layer>): Layer | undefined {
  if (layer.kind !== "iris" || layer.follow === undefined) return undefined;
  const eye = byName.get(layer.follow);
  return eye?.kind === "eye" ? eye : undefined;
}

let lastFace: { rig: Rig["face"]; look: Look["face"]; face: ResolvedFace } | undefined;

/** `resolveFace(rig, look)`, kept for the last pair of profiles (the per-frame call is then free). */
export function faceOf(rig: Pick<Rig, "face">, look: Pick<Look, "face">): ResolvedFace {
  if (lastFace === undefined || lastFace.rig !== rig.face || lastFace.look !== look.face) lastFace = { rig: rig.face, look: look.face, face: resolveFace(rig, look) };
  return lastFace.face;
}
