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
//   layers (`isEmissive`: the layer's own `emissive`, else its kind is in EMISSIVE_KINDS). Glare
//   raises only an emissive eye: a layer with `emissive: false` takes no light gain from a gesture
//   (cast-forge task 12 follow-up); its own pulse still applies. Palette colours and eyeGain stay
//   with the renderer.
// - A layer is drawn unless it is in `look.hidden` or carries `visible: false`.
// - Rulings of 2026-11-01 (req 4.3, 4.4): followers inherit only the gesture part of the parent's
//   transform (translation, rotation, scale about the parent's anchor). Parallax comes from the
//   layer's own depth, and the jaw drop is the jaw layer's own: a fixed canvas-px length along the
//   inherited down axis, unscaled by gestures and not passed on to the jaw's followers. Its length
//   at full open is the layer's own `drop` (cast-forge task 3) times rig height, JAW_DROP when absent.
// - Layer motion (cast-forge req 1.3, motion.ts) comes last: the float turns the layer about its
//   posed anchor and moves it in canvas px, after the inherited follow transform, parallax and jaw
//   drop; the pulse multiplies the tint. `Drive.still` (reduced motion) zeroes both.
// - A float is carried down the follow chain (cast-forge task 4, amending task 1): a follower is
//   moved by its parent's float, as a canvas-space turn about the parent's posed anchor and a move,
//   before its own float, so a lure bulb stays on the tip of a swaying stalk. The pulse and the jaw
//   drop stay the layer's own.
// - An eye layer's own `motion.blink` (cast-forge task 6) is a closure that adds to `Drive.blink`
//   (the larger wins) and squashes only that eye; it is the layer's own, never inherited.
// - Character control (character-control design "Moods", "Reshape"; mood.ts): the look's emotion,
//   crossfaded by `Drive.mood`, holds a head roll (added to the tilt gesture's rotation on the head
//   group, so followers inherit), a pitch (added to the drive's before the clamp), an eye squint
//   (eye y-scale `(1 - 0.9 * closure) * (1 - squint)`), a jaw set (added to jawOpen, clamped to 1),
//   a glow gain (times the tint of emissive layers) and a brow lift (brow layers: a move up in the
//   parent's frame and a turn about the anchor, inherited). They hold under `still` as well.
// - `Look.shape` (clamped by clampShape) is part of the layer's own local transform, inside its
//   follow chain: `move(dx*W, dy*W) . gesture . browTurn . (rot, size*sx, size*sy about the anchor)`,
//   so the gesture turns a reshaped part about its moved anchor and followers inherit the reshape.
//   A transform is `R(rot) diag(kx, ky)`; composing a non-uniform parent with a turned child keeps
//   positions exact and the child's frame as `R(sum of turns) diag(product of scales)` (exact unless
//   both a stretch and a turn lie on one chain; a similarity cannot carry a shear).
import type { EmotionDrive } from "./look.js";
import { browPoses, facesOf, moodOf, shapeOf, type BrowPose } from "./mood.js";
import { motionAt, ownBlinkAt } from "./motion.js";
import type { Emotion, ExpressionFamily, Gesture, Layer, LayerKind, Look, Rig } from "./types.js";

/** Head yaw clamp, degrees (the range Overlord measured for 2.5D artefacts). */
export const YAW_LIMIT_DEG = 22;
/** Head pitch clamp, degrees. */
export const PITCH_LIMIT_DEG = 12;
/** Parallax at full yaw for depth 1, as a fraction of rig width. */
export const YAW_SHIFT = 0.04;
/** Parallax at full pitch for depth 1, as a fraction of rig height. */
export const PITCH_SHIFT = 0.03;
/** Jaw drop at `jawOpen = 1`, as a fraction of rig height, for a jaw layer with no `drop` of its own. */
export const JAW_DROP = 0.06;
/** The range of a jaw layer's own `drop` (cast-forge task 3): a pursed lip up to a skull's gape. */
export const JAW_DROP_MIN = 0.005;
export const JAW_DROP_MAX = 0.1;
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
  iris: 0.7,
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
  /**
   * An emotion change in progress (character-control design "Moods"): every mood value is
   * `lerp(from, look.emotion, smoothstep(mix))`. Omitted means mix 1 (the look's emotion, settled).
   */
  mood?: { from: Emotion; mix: number };
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
  /** Expression faces to draw with their weights (character-control); omitted = the base only. */
  faces?: { family: ExpressionFamily; weight: number }[];
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
/** Kinds that give light unless the layer says otherwise (`Layer.emissive`). */
export const EMISSIVE_KINDS: ReadonlySet<LayerKind> = new Set(["eye", "crown", "accessory"]);

/** Whether a layer gives light: its own `emissive`, else its kind's default (EMISSIVE_KINDS). */
export const isEmissive = (layer: Pick<Layer, "kind" | "emissive">): boolean => layer.emissive ?? EMISSIVE_KINDS.has(layer.kind);

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

/** p -> R(rot) * diag(kx, ky) * p + t; uniform (kx = ky) unless a reshape stretches a part. */
interface Sim {
  rot: number;
  kx: number;
  ky: number;
  tx: number;
  ty: number;
}
const IDENTITY: Sim = { rot: 0, kx: 1, ky: 1, tx: 0, ty: 0 };

function apply(s: Sim, x: number, y: number): [number, number] {
  const cos = Math.cos(s.rot);
  const sin = Math.sin(s.rot);
  const [cx, nx, cy, ny] = [cos * s.kx, sin * s.kx, cos * s.ky, sin * s.ky];
  return [cx * x - ny * y + s.tx, nx * x + cy * y + s.ty];
}

/** outer after inner (the linear part is exact when `outer` is uniform or `inner` does not turn). */
function compose(outer: Sim, inner: Sim): Sim {
  const [tx, ty] = apply(outer, inner.tx, inner.ty);
  return { rot: outer.rot + inner.rot, kx: outer.kx * inner.kx, ky: outer.ky * inner.ky, tx, ty };
}

/** p -> R(rot) diag(kx, ky) (p - a) + a. */
function about(ax: number, ay: number, rot: number, kx: number, ky: number): Sim {
  const [rx, ry] = apply({ rot, kx, ky, tx: 0, ty: 0 }, ax, ay);
  return { rot, kx, ky, tx: ax - rx, ty: ay - ry };
}

interface Frame {
  /** Parallax shift per unit depth, canvas px. */
  perDepthX: number;
  perDepthY: number;
  /** `jawOpen` (clamped) times rig height: a jaw drops this times its own `drop` fraction. */
  jawPx: number;
  gesture: Peak;
  liftY: number;
  /** `Drive.blink`, clamped: an eye's own blink (cast-forge task 6) adds to it, the larger wins. */
  blink: number;
  /** The held mood (character-control), crossfaded by `Drive.mood`. */
  mood: EmotionDrive;
  /** Brow layers' lift and turn for the mood's browLift. */
  brows: Map<string, BrowPose>;
}

function frameOf(rig: Rig, look: Look, drive: Drive): Frame {
  const gesture = gestureAt(finite(drive.t), drive.gesture);
  const mood = moodOf(look, drive.mood);
  const yaw = clamp(drive.headYaw, -YAW_LIMIT_DEG, YAW_LIMIT_DEG);
  const pitch = clamp(drive.headPitch + gesture.pitchDeg + mood.headPitch, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  return {
    perDepthX: (yaw / YAW_LIMIT_DEG) * YAW_SHIFT * rig.width,
    perDepthY: (pitch / PITCH_LIMIT_DEG) * PITCH_SHIFT * rig.height,
    jawPx: clamp(drive.jawOpen + mood.jawSet, 0, 1) * rig.height,
    gesture,
    liftY: gesture.lift * rig.height,
    blink: clamp(drive.blink, 0, 1),
    mood,
    brows: browPoses(rig, mood.browLift),
  };
}

/** The layer's own gesture transform in its parent's space; identity unless it starts a head group. */
function gestureLocalOf(layer: Layer, frame: Frame, gestured: boolean): Sim {
  if (!gestured) return IDENTITY;
  // Rotate and scale about the anchor, then lift: p -> k R (p - a) + a + (0, lift).
  const [ax, ay] = layer.anchor;
  const k = 1 + frame.gesture.scale;
  const turned = about(ax, ay, ((frame.gesture.tiltDeg + frame.mood.headTilt) * Math.PI) / 180, k, k);
  return { ...turned, ty: turned.ty + frame.liftY };
}

/** The layer's whole local transform: its reshape and brow turn about the anchor, its gesture, then the moves. */
function localOf(layer: Layer, rig: Rig, look: Look, frame: Frame, gestured: boolean): Sim {
  const gesture = gestureLocalOf(layer, frame, gestured);
  const shape = shapeOf(look, layer);
  const brow = frame.brows.get(layer.name);
  if (shape === undefined && brow === undefined) return gesture;
  const [ax, ay] = layer.anchor;
  let local = brow === undefined ? gesture : compose(gesture, about(ax, ay, (brow.tiltDeg * Math.PI) / 180, 1, 1));
  if (shape !== undefined) local = compose(local, about(ax, ay, (shape.rot * Math.PI) / 180, shape.size * shape.sx, shape.size * shape.sy));
  const move: Sim = { ...IDENTITY, tx: (shape?.dx ?? 0) * rig.width, ty: (shape?.dy ?? 0) * rig.width + (brow?.liftY ?? 0) };
  return compose(move, local);
}

/**
 * The layer's full transform: its inherited gesture transform, then (in canvas space, so neither is
 * scaled or inherited) its own parallax and, for a jaw, the drop along the rotated down axis.
 */
function finalOf(layer: Layer, gesture: Sim, frame: Frame): Sim {
  const depth = layer.depth ?? DEFAULT_DEPTH[layer.kind];
  const drop = layer.kind === "jaw" ? frame.jawPx * (layer.drop ?? JAW_DROP) : 0;
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
function worldsOf(rig: Rig, look: Look, frame: Frame): Map<string, World> {
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
    const local = localOf(layer, rig, look, frame, gestured);
    const world: World = { sim: parent === undefined ? local : compose(parent.sim, local), headed: parentHeaded || gestured };
    visiting.delete(layer.name);
    worlds.set(layer.name, world);
    return world;
  };
  for (const layer of rig.layers) resolve(layer);
  return worlds;
}

function tintOf(layer: Layer, gesture: Peak, glowGain: number): number {
  if (!isEmissive(layer)) return 1;
  return (layer.kind === "eye" ? 1 + gesture.eyeTint : 1) * (1 + gesture.glowTint) * glowGain;
}

/** The canvas-space turn by `rotation` about `[qx, qy]` followed by a move of `(dx, dy)`. */
function turnAbout(qx: number, qy: number, rotation: number, dx: number, dy: number): Sim {
  const [rx, ry] = apply({ rot: rotation, kx: 1, ky: 1, tx: 0, ty: 0 }, qx, qy);
  return { rot: rotation, kx: 1, ky: 1, tx: qx + dx - rx, ty: qy + dy - ry };
}

/**
 * Per layer, the float it carries: its parent's carried float, then its own float (a turn about
 * its anchor as posed by its gesture transform under the parent's carry, and a move). It is
 * composed after the gesture transform and before the layer's own parallax and jaw drop (a turn
 * about the anchor commutes with a move, so the layer's own float is as if applied last), so a
 * follower turns rigidly with its parent and its parallax stays a pure shift.
 */
function carriesOf(rig: Rig, worlds: Map<string, World>, drive: Drive): Map<string, Sim> {
  const byName = new Map<string, Layer>();
  for (const layer of rig.layers) if (!byName.has(layer.name)) byName.set(layer.name, layer);
  const carries = new Map<string, Sim>();
  const visiting = new Set<string>();
  const resolve = (layer: Layer): Sim => {
    const known = carries.get(layer.name);
    if (known !== undefined) return known;
    visiting.add(layer.name);
    const parentLayer = layer.follow === undefined ? undefined : byName.get(layer.follow);
    const inherited = parentLayer === undefined || visiting.has(parentLayer.name) ? IDENTITY : resolve(parentLayer);
    const motion = motionAt(layer.motion, drive.t, drive.still === true);
    let carry = inherited;
    if (motion.rotation !== 0 || motion.dx !== 0 || motion.dy !== 0) {
      const posed = compose(inherited, worlds.get(layer.name)?.sim ?? IDENTITY);
      const [qx, qy] = apply(posed, layer.anchor[0], layer.anchor[1]);
      carry = compose(turnAbout(qx, qy, motion.rotation, motion.dx, motion.dy), inherited);
    }
    visiting.delete(layer.name);
    carries.set(layer.name, carry);
    return carry;
  };
  for (const layer of rig.layers) resolve(layer);
  return carries;
}

/** Per visible layer, in `z` order (ties keep rig order), the pose for this frame. */
export function poseLayers(rig: Rig, look: Look, drive: Drive): LayerPose[] {
  const frame = frameOf(rig, look, drive);
  const worlds = worldsOf(rig, look, frame);
  const carries = carriesOf(rig, worlds, drive);
  const hidden = new Set(look.hidden);
  return rig.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.visible !== false && !hidden.has(layer.name))
    .sort((a, b) => a.layer.z - b.layer.z || a.index - b.index)
    .map(({ layer }): LayerPose => {
      const motion = motionAt(layer.motion, drive.t, drive.still === true);
      const sim = finalOf(layer, compose(carries.get(layer.name) ?? IDENTITY, worlds.get(layer.name)?.sim ?? IDENTITY), frame);
      const [bx, by] = layer.bbox;
      const [ax, ay] = layer.anchor;
      const [px, py] = apply(sim, ax, ay);
      const closure = Math.max(frame.blink, ownBlinkAt(layer.motion, drive.t, drive.still === true));
      const squash = layer.kind === "eye" ? (1 - BLINK_SQUASH * closure) * (1 - clamp(frame.mood.squint, 0, 1)) : 1;
      const faces = facesOf(layer, look, drive.mood);
      return {
        name: layer.name,
        x: bx + px - ax,
        y: by + py - ay,
        scale: [sim.kx, sim.ky * squash],
        rotation: sim.rot,
        opacity: 1,
        tint: tintOf(layer, frame.gesture, frame.mood.glowGain) * motion.gain,
        ...(faces === undefined ? {} : { faces }),
      };
    });
}
