// poseLayers (rig-core req 4): deterministic per-frame layer transforms, pure, no DOM.
// Math per design.md "Pose math". Every layer gets a similarity transform (translation, rotation,
// uniform scale) composed down its follow chain, plus an own, non-inherited y-squash for blinks.
//
// Decisions the spec leaves open (documented here so the renderer and driver agree):
// - `Drive.gesture` is `{ name, startedAt }` on the same clock as `Drive.t` (seconds), matching the
//   driver's `DriverState.gesture`; the curve runs for GESTURE_DURATION_S from `startedAt`.
// - Every gesture follows one envelope, `sin(pi * elapsed / duration)`, peaking at the design value.
// - tilt, lean_in and recoil act on the head group: each `head` layer with no `head` ancestor,
//   about its own anchor; its followers inherit the change. nod adds pitch before the clamp.
// - `tint` is a light gain (1 = as drawn): glare raises `eye` layers, flare raises the emissive
//   kinds (`eye`, `crown`, `accessory`). Palette colours and eyeGain stay with the renderer.
// - A layer is drawn unless it is in `look.hidden` or carries `visible: false`.
// - Rulings of 2026-11-01 (req 4.3, 4.4): followers inherit only the gesture part of the parent's
//   transform (translation, rotation, scale about the parent's anchor). Parallax comes from the
//   layer's own depth, and the jaw drop is the jaw layer's own: a fixed canvas-px length along the
//   inherited down axis, unscaled by gestures and not passed on to the jaw's followers.
// - Layer motion (cast-forge req 1.3, motion.ts) comes last: the float turns the layer about its
//   posed anchor and moves it in canvas px, after the inherited follow transform, parallax and jaw
//   drop, and is not passed on to followers; the pulse multiplies the tint. `Drive.still`
//   (reduced motion) zeroes both.
import { motionAt } from "./motion.js";
import type { Gesture, Layer, LayerKind, Look, Rig } from "./types.js";

/** Head yaw clamp, degrees (the range Overlord measured for 2.5D artefacts). */
export const YAW_LIMIT_DEG = 22;
/** Head pitch clamp, degrees. */
export const PITCH_LIMIT_DEG = 12;
/** Parallax at full yaw for depth 1, as a fraction of rig width. */
export const YAW_SHIFT = 0.04;
/** Parallax at full pitch for depth 1, as a fraction of rig height. */
export const PITCH_SHIFT = 0.03;
/** Jaw drop at `jawOpen = 1`, as a fraction of rig height. */
export const JAW_DROP = 0.06;
/** Eye y-scale at `blink = 1` is `1 - BLINK_SQUASH`. */
export const BLINK_SQUASH = 0.9;
/** Length of every gesture curve, seconds. */
export const GESTURE_DURATION_S = 0.4;

/** Depth used when a layer has none (types.ts, Layer.depth). */
export const DEFAULT_DEPTH: Readonly<Record<LayerKind, number>> = {
  static: 0,
  body: 0.3,
  head: 0.6,
  jaw: 0.62,
  eye: 0.7,
  accessory: 0.75,
  crown: 0.65,
};

export interface GestureCue {
  name: Gesture;
  /** Seconds, same clock as `Drive.t`. */
  startedAt: number;
}

export interface Drive {
  /** Seconds. */
  t: number;
  /** Degrees, clamped to +-YAW_LIMIT_DEG. Positive moves near layers right. */
  headYaw: number;
  /** Degrees, clamped to +-PITCH_LIMIT_DEG. Positive moves near layers down. */
  headPitch: number;
  /** 0..1 (clamped). */
  jawOpen: number;
  /** 0..1 (clamped); 1 = eyes shut. */
  blink: number;
  gesture?: GestureCue;
  /** Reduced motion: layer float and pulse are zero (cast-forge req 1.3). Omitted means false. */
  still?: boolean;
}

export interface LayerPose {
  name: string;
  /** Posed bbox top-left, canvas px: the bbox moved by the layer's translation. */
  x: number;
  y: number;
  /** Applied about the posed anchor (`anchor + (x - bbox[0], y - bbox[1])`). */
  scale: [x: number, y: number];
  /** Radians, clockwise on the y-down canvas, about the posed anchor. */
  rotation: number;
  /** 0..1. */
  opacity: number;
  /** Light gain multiplied into the layer colour; 1 = as drawn. */
  tint: number;
}

/** Design.md gesture peaks, as offsets from rest. */
interface Peak {
  pitchDeg: number;
  tiltDeg: number;
  scale: number;
  /** Fraction of rig height; negative is up. */
  lift: number;
  eyeTint: number;
  glowTint: number;
}
const REST: Peak = { pitchDeg: 0, tiltDeg: 0, scale: 0, lift: 0, eyeTint: 0, glowTint: 0 };
const PEAKS: Record<Gesture, Partial<Peak>> = {
  nod: { pitchDeg: 6 },
  tilt: { tiltDeg: 5 },
  lean_in: { scale: 0.04 },
  recoil: { scale: -0.04, lift: -0.01 },
  glare: { eyeTint: 0.6 },
  flare: { glowTint: 1 },
};
const EMISSIVE: ReadonlySet<LayerKind> = new Set(["eye", "crown", "accessory"]);

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
const clamp = (value: number, lo: number, hi: number): number => (Number.isNaN(value) ? 0 : Math.min(hi, Math.max(lo, value)));

/** The running gesture's offsets at `t`: the peak scaled by a half-sine over its duration. */
function gestureAt(t: number, cue: GestureCue | undefined): Peak {
  if (cue === undefined) return REST;
  const elapsed = t - cue.startedAt;
  if (!(elapsed >= 0 && elapsed <= GESTURE_DURATION_S)) return REST;
  const envelope = Math.sin((Math.PI * elapsed) / GESTURE_DURATION_S);
  const peak = { ...REST, ...PEAKS[cue.name] };
  return {
    pitchDeg: peak.pitchDeg * envelope,
    tiltDeg: peak.tiltDeg * envelope,
    scale: peak.scale * envelope,
    lift: peak.lift * envelope,
    eyeTint: peak.eyeTint * envelope,
    glowTint: peak.glowTint * envelope,
  };
}

/** p -> k * R(rot) * p + t. */
interface Sim {
  rot: number;
  k: number;
  tx: number;
  ty: number;
}
const IDENTITY: Sim = { rot: 0, k: 1, tx: 0, ty: 0 };

function apply(s: Sim, x: number, y: number): [number, number] {
  const c = Math.cos(s.rot) * s.k;
  const n = Math.sin(s.rot) * s.k;
  return [c * x - n * y + s.tx, n * x + c * y + s.ty];
}

/** outer after inner. */
function compose(outer: Sim, inner: Sim): Sim {
  const [tx, ty] = apply(outer, inner.tx, inner.ty);
  return { rot: outer.rot + inner.rot, k: outer.k * inner.k, tx, ty };
}

interface Frame {
  /** Parallax shift per unit depth, canvas px. */
  perDepthX: number;
  perDepthY: number;
  jawY: number;
  gesture: Peak;
  liftY: number;
  squash: number;
}

function frameOf(rig: Rig, drive: Drive): Frame {
  const gesture = gestureAt(finite(drive.t), drive.gesture);
  const yaw = clamp(drive.headYaw, -YAW_LIMIT_DEG, YAW_LIMIT_DEG);
  const pitch = clamp(drive.headPitch + gesture.pitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  return {
    perDepthX: (yaw / YAW_LIMIT_DEG) * YAW_SHIFT * rig.width,
    perDepthY: (pitch / PITCH_LIMIT_DEG) * PITCH_SHIFT * rig.height,
    jawY: clamp(drive.jawOpen, 0, 1) * JAW_DROP * rig.height,
    gesture,
    liftY: gesture.lift * rig.height,
    squash: 1 - BLINK_SQUASH * clamp(drive.blink, 0, 1),
  };
}

/** The layer's own gesture transform in its parent's space; identity unless it starts a head group. */
function gestureLocalOf(layer: Layer, frame: Frame, gestured: boolean): Sim {
  if (!gestured) return IDENTITY;
  // Rotate and scale about the anchor, then lift: p -> k R (p - a) + a + (0, lift).
  const [ax, ay] = layer.anchor;
  const about: Sim = { rot: (frame.gesture.tiltDeg * Math.PI) / 180, k: 1 + frame.gesture.scale, tx: 0, ty: 0 };
  const [rx, ry] = apply(about, ax, ay);
  return { ...about, tx: ax - rx, ty: ay - ry + frame.liftY };
}

/**
 * The layer's full transform: its inherited gesture transform, then (in canvas space, so neither is
 * scaled or inherited) its own parallax and, for a jaw, the drop along the rotated down axis.
 */
function finalOf(layer: Layer, gesture: Sim, frame: Frame): Sim {
  const depth = layer.depth ?? DEFAULT_DEPTH[layer.kind];
  const drop = layer.kind === "jaw" ? frame.jawY : 0;
  return {
    ...gesture,
    tx: gesture.tx + frame.perDepthX * depth - Math.sin(gesture.rot) * drop,
    ty: gesture.ty + frame.perDepthY * depth + Math.cos(gesture.rot) * drop,
  };
}

interface World {
  /** Gesture-only world transform: the part followers inherit. */
  sim: Sim;
  /** The layer is a head or follows one, so a head-group gesture already reached it. */
  headed: boolean;
}

/** Gesture world transforms for every layer, composed down follow chains (missing or cyclic parents act as roots). */
function worldsOf(rig: Rig, frame: Frame): Map<string, World> {
  const byName = new Map<string, Layer>();
  for (const layer of rig.layers) if (!byName.has(layer.name)) byName.set(layer.name, layer);
  const worlds = new Map<string, World>();
  const visiting = new Set<string>();
  const resolve = (layer: Layer): World => {
    const known = worlds.get(layer.name);
    if (known !== undefined) return known;
    visiting.add(layer.name);
    const parentLayer = layer.follow === undefined ? undefined : byName.get(layer.follow);
    const parent = parentLayer === undefined || visiting.has(parentLayer.name) ? undefined : resolve(parentLayer);
    const parentHeaded = parent?.headed ?? false;
    const gestured = layer.kind === "head" && !parentHeaded;
    const local = gestureLocalOf(layer, frame, gestured);
    const world: World = { sim: parent === undefined ? local : compose(parent.sim, local), headed: parentHeaded || gestured };
    visiting.delete(layer.name);
    worlds.set(layer.name, world);
    return world;
  };
  for (const layer of rig.layers) resolve(layer);
  return worlds;
}

function tintOf(kind: LayerKind, gesture: Peak): number {
  const eye = kind === "eye" ? 1 + gesture.eyeTint : 1;
  return eye * (EMISSIVE.has(kind) ? 1 + gesture.glowTint : 1);
}

/** `sim` followed, in canvas space, by a rotation about the layer's posed anchor and a move. */
function withFloat(layer: Layer, sim: Sim, rotation: number, dx: number, dy: number): Sim {
  if (rotation === 0 && dx === 0 && dy === 0) return sim;
  const [ax, ay] = layer.anchor;
  const [px, py] = apply(sim, ax, ay);
  const turned: Sim = { ...sim, rot: sim.rot + rotation, tx: 0, ty: 0 };
  const [rx, ry] = apply(turned, ax, ay);
  return { ...turned, tx: px + dx - rx, ty: py + dy - ry };
}

/** Per visible layer, in `z` order (ties keep rig order), the pose for this frame. */
export function poseLayers(rig: Rig, look: Look, drive: Drive): LayerPose[] {
  const frame = frameOf(rig, drive);
  const worlds = worldsOf(rig, frame);
  const hidden = new Set(look.hidden);
  return rig.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.visible !== false && !hidden.has(layer.name))
    .sort((a, b) => a.layer.z - b.layer.z || a.index - b.index)
    .map(({ layer }): LayerPose => {
      const motion = motionAt(layer.motion, drive.t, drive.still === true);
      const posed = finalOf(layer, worlds.get(layer.name)?.sim ?? IDENTITY, frame);
      const sim = withFloat(layer, posed, motion.rotation, motion.dx, motion.dy);
      const [bx, by] = layer.bbox;
      const [ax, ay] = layer.anchor;
      const [px, py] = apply(sim, ax, ay);
      const squash = layer.kind === "eye" ? frame.squash : 1;
      return {
        name: layer.name,
        x: bx + px - ax,
        y: by + py - ay,
        scale: [sim.k, sim.k * squash],
        rotation: sim.rot,
        opacity: 1,
        tint: tintOf(layer.kind, frame.gesture) * motion.gain,
      };
    });
}
