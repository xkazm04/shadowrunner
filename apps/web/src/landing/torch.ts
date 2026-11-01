// The torch (costume requirement 3.3; design.md "Per-page notes, Landing"): the visitor's light in
// the cellar. Pure, no DOM. LandingPage turns a pointer or a focused control into a point in world
// px (World.tsx) and asks this module two things: where Malakor looks (his gaze follows the torch,
// costume requirement 9, through <AvatarCanvas lookAt>), and how much light a slide in the tray
// catches from it (the backlit glass, as in the prototype's `--lit`).
import type { LookAtPoint } from "@sr/avatar";

export interface Point {
  x: number;
  y: number;
}

/** Where the face looks from, and how far the torch must be for a full turn, in world px. */
export interface GazeAnchor {
  /** The point between the eyes. */
  x: number;
  y: number;
  /** World px from the anchor at which the gaze is fully turned on each axis (> 0). */
  reachX: number;
  reachY: number;
}

/** World px from a slide's centre at which the torch no longer lights it (the prototype's 220). */
export const SLIDE_REACH = 220;

/** Where the torch rests before the visitor moves it, as fractions of the world (the prototype's 50vw, 62vh). */
export const TORCH_REST = { x: 0.5, y: 0.62 } as const;

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);
const unit = (v: number): number => Math.min(1, Math.max(-1, v));

/**
 * Pure: the look-at point for a torch at `torch` (normalised view space, [-1, 1] per axis, y down).
 * Zero when the torch is on the anchor; linear inside the reach, clamped beyond it; each axis
 * independent of the other. A broken point or anchor counts as the centre (no turn).
 */
export function gazeAt(torch: Point, anchor: GazeAnchor): LookAtPoint {
  const rx = anchor.reachX > 0 && Number.isFinite(anchor.reachX) ? anchor.reachX : Infinity;
  const ry = anchor.reachY > 0 && Number.isFinite(anchor.reachY) ? anchor.reachY : Infinity;
  const x = unit(finite((torch.x - anchor.x) / rx));
  const y = unit(finite((torch.y - anchor.y) / ry));
  // -0 folded into 0, so a torch on the anchor is exactly the centre.
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/**
 * Pure: how much of the torch a slide catches at `distance` world px: 1 on the slide, falling
 * linearly to 0 at `reach`, 0 beyond. Never outside [0, 1]; a broken distance is out of reach.
 */
export function slideLight(distance: number, reach: number = SLIDE_REACH): number {
  if (!(reach > 0) || !Number.isFinite(distance)) return 0;
  return Math.min(1, Math.max(0, 1 - Math.abs(distance) / reach));
}
