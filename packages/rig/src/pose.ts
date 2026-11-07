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
// - Face control (face-control, eyes.ts): irises, closed-lid blinks, narrowed faces, the face
//   profile (`resolveFace`: motion.tilt scales the mood's head tilt and pitch, motion.gesture the
//   gesture peaks, expression.strength the face weights) and the breathing idle. At the default
//   profile, on a rig without irises or a face profile, every pose is exactly as before.
import { breathAt, breathes, cellOf, eyeOf, faceOf, irisOffset, layerIndex, snapCell, squintOf, strengthen, type SocketBox } from "./eyes.js";
import type { ResolvedFace } from "./face.js";
import type { EmotionDrive } from "./look.js";
import { browPoses, facesOf, moodOf, shapeOf, type BrowPose } from "./mood.js";
import { actMotionAt, type ActCue } from "./act.js";
import { motionAt, ownBlinkAt } from "./motion.js";
import { IDENTITY, about, apply, compose, turnAbout, type Sim } from "./sim.js";
import type { Emotion, ExpressionFamily, Gesture, Layer, LayerKind, Look, Rig } from "./types.js";

// The face-control pose helpers are public through this module (index.ts exports it).
export * from "./eyes.js";

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
  /**
   * Where the irises look (face-control), -1..1 per axis of the socket's half extents (clamped);
   * x positive is screen right, y positive down. Omitted means rest (0, 0).
   */
  gaze?: { x: number; y: number };
  /** A signature act in play (tiger L1, act.ts): that layer's own motion once. Omitted: none. */
  act?: ActCue;
}

/** What poseLayers needs beyond the rig, look and drive (face-control). */
export interface PoseOptions {
  /** The profile in force; omitted means `resolveFace(rig, look)`. */
  face?: ResolvedFace;
  /** Per eye layer name, its socket's half extents; an eye missing here keeps its iris at rest. */
  sockets?: ReadonlyMap<string, SocketBox>;
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
  /** An eye with `closed` art (face-control): the blink's closure, 0..1; omitted = open. */
  closed?: number;
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
export const EMISSIVE_KINDS: ReadonlySet<LayerKind> = new Set(["eye", "iris", "crown", "accessory"]);

/**
 * Whether a layer gives light: its own `emissive`, else its kind's default (EMISSIVE_KINDS). An eye
 * with a `socket` (face-control) gives none by default: its iris carries the light.
 */
export const isEmissive = (layer: Pick<Layer, "kind" | "emissive"> & { socket?: string | undefined }): boolean =>
  layer.emissive ?? (layer.kind === "eye" && layer.socket !== undefined ? false : EMISSIVE_KINDS.has(layer.kind));

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
const clamp = (value: number, lo: number, hi: number): number => (Number.isNaN(value) ? 0 : Math.min(hi, Math.max(lo, value)));

/** The running gesture's offsets at `t`: the peak scaled by a half-sine over its duration, times `k` (motion.gesture). */
function gestureAt(t: number, cue: GestureCue | undefined, k: number): Peak {
  if (cue === undefined) return REST;
  const elapsed = t - cue.startedAt;
  if (!(elapsed >= 0 && elapsed <= GESTURE_DURATION_S)) return REST;
  const envelope = Math.sin((Math.PI * elapsed) / GESTURE_DURATION_S) * k;
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
  /** The breathing this frame (face-control, eyes.ts): a rise in canvas px (positive up) and a scale. */
  breath?: { risePx: number; scale: number };
}

function frameOf(rig: Rig, look: Look, drive: Drive, face: ResolvedFace): Frame {
  const gesture = gestureAt(finite(drive.t), drive.gesture, face.motion.gesture);
  const mood = moodOf(look, drive.mood);
  mood.headTilt *= face.motion.tilt;
  mood.headPitch *= face.motion.tilt;
  const yaw = clamp(drive.headYaw, -YAW_LIMIT_DEG, YAW_LIMIT_DEG);
  const pitch = clamp(drive.headPitch + gesture.pitchDeg + mood.headPitch, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  const breath = breathes(rig, look) ? breathAt(drive.t, face.motion.breath, drive.still === true) : undefined;
  return {
    perDepthX: (yaw / YAW_LIMIT_DEG) * YAW_SHIFT * rig.width,
    perDepthY: (pitch / PITCH_LIMIT_DEG) * PITCH_SHIFT * rig.height,
    jawPx: clamp(drive.jawOpen + mood.jawSet, 0, 1) * rig.height,
    gesture,
    liftY: gesture.lift * rig.height,
    blink: clamp(drive.blink, 0, 1),
    mood,
    brows: browPoses(rig, mood.browLift),
    ...(breath === undefined ? {} : { breath: { risePx: breath.rise * rig.height, scale: breath.scale } }),
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

/** The breath about the anchor of a head or body group's root (eyes.ts), outermost of its local transform. */
function breathOf(layer: Layer, frame: Frame, local: Sim): Sim {
  if (frame.breath === undefined) return local;
  const [ax, ay] = layer.anchor;
  const swell = about(ax, ay, 0, frame.breath.scale, frame.breath.scale);
  return compose({ ...swell, ty: swell.ty - frame.breath.risePx }, local);
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
  /** The layer is a head or body or follows one, so the breath already reached it. */
  breathed: boolean;
}

const BREATHING: ReadonlySet<LayerKind> = new Set(["head", "body"]);

/** Gesture world transforms for every layer, composed down follow chains (missing or cyclic parents act as roots). */
function worldsOf(rig: Rig, look: Look, frame: Frame, byName: ReadonlyMap<string, Layer>): Map<string, World> {
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
    const breathRoot = BREATHING.has(layer.kind) && !(parent?.breathed ?? false);
    const own = localOf(layer, rig, look, frame, gestured);
    const local = breathRoot ? breathOf(layer, frame, own) : own;
    const sim = parent === undefined ? local : compose(parent.sim, local);
    const world: World = { sim, headed: parentHeaded || gestured, breathed: (parent?.breathed ?? false) || breathRoot };
    visiting.delete(layer.name);
    worlds.set(layer.name, world);
    return world;
  };
  for (const layer of rig.layers) resolve(layer);
  return worlds;
}

function tintOf(layer: Layer, gesture: Peak, glowGain: number): number {
  if (!isEmissive(layer)) return 1;
  return (layer.kind === "eye" || layer.kind === "iris" ? 1 + gesture.eyeTint : 1) * (1 + gesture.glowTint) * glowGain;
}

/**
 * Per layer, the float it carries: its parent's carried float, then its own float (a turn about
 * its anchor as posed by its gesture transform under the parent's carry, and a move). It is
 * composed after the gesture transform and before the layer's own parallax and jaw drop (a turn
 * about the anchor commutes with a move, so the layer's own float is as if applied last), so a
 * follower turns rigidly with its parent and its parallax stays a pure shift.
 */
function carriesOf(rig: Rig, worlds: Map<string, World>, drive: Drive, byName: ReadonlyMap<string, Layer>): Map<string, Sim> {
  const carries = new Map<string, Sim>();
  const visiting = new Set<string>();
  const resolve = (layer: Layer): Sim => {
    const known = carries.get(layer.name);
    if (known !== undefined) return known;
    visiting.add(layer.name);
    const parentLayer = layer.follow === undefined ? undefined : byName.get(layer.follow);
    const inherited = parentLayer === undefined || visiting.has(parentLayer.name) ? IDENTITY : resolve(parentLayer);
    const motion = actMotionAt(layer, drive.t, drive.still === true, drive.act, rig.height);
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
export function poseLayers(rig: Rig, look: Look, drive: Drive, options: PoseOptions = {}): LayerPose[] {
  const face = options.face ?? faceOf(rig, look);
  const frame = frameOf(rig, look, drive, face);
  const { byName } = layerIndex(rig);
  const worlds = worldsOf(rig, look, frame, byName);
  const carries = carriesOf(rig, worlds, drive, byName);
  const hidden = new Set(look.hidden);
  const shown = (layer: Layer): boolean => layer.visible !== false && !hidden.has(layer.name);
  const still = drive.still === true;
  const simOf = (layer: Layer): Sim => finalOf(layer, compose(carries.get(layer.name) ?? IDENTITY, worlds.get(layer.name)?.sim ?? IDENTITY), frame);
  const cell = cellOf(rig);
  const closureOf = (layer: Layer): number => Math.max(frame.blink, ownBlinkAt(layer.motion, drive.t, still));
  return rig.layers
    .map((layer, index) => ({ layer, index, eye: eyeOf(layer, byName) }))
    .filter(({ layer, eye }) => shown(layer) && (eye === undefined || shown(eye)))
    .sort((a, b) => a.layer.z - b.layer.z || a.index - b.index)
    .map(({ layer, eye }): LayerPose => {
      const motion = actMotionAt(layer, drive.t, still, drive.act, rig.height);
      // An iris rides its eye's transform, moved by the gaze in the eye's rest frame (eyes.ts), by whole cells on pixel art.
      const [ox, oy] = eye === undefined ? [0, 0] : snapCell(irisOffset(drive.gaze, options.sockets?.get(eye.name), face.gaze.range), cell);
      const sim = eye === undefined ? simOf(layer) : compose(simOf(eye), { ...IDENTITY, tx: ox, ty: oy });
      const [bx, by] = layer.bbox;
      const [ax, ay] = layer.anchor;
      const [px, py] = apply(sim, ax, ay);
      const faces = strengthen(facesOf(layer, look, drive.mood, face.expression.faces), face.expression.strength);
      const closure = closureOf(eye ?? layer);
      const lids = (eye ?? layer).closed !== undefined;
      const squint = layer.kind === "eye" ? clamp(squintOf(layer, faces, frame.mood.squint), 0, 1) : 0;
      const squash = layer.kind === "eye" ? (lids ? 1 : 1 - BLINK_SQUASH * closure) * (1 - squint) : 1;
      // A socketed eye's pulse moves to its iris (an iris pulse of its own wins).
      const gain = layer.kind === "eye" && layer.socket !== undefined ? 1 : eye !== undefined && layer.motion?.pulse === undefined ? motionAt(eye.motion, drive.t, still).gain : motion.gain;
      return {
        name: layer.name,
        x: bx + px - ax,
        y: by + py - ay,
        scale: [sim.kx, sim.ky * squash],
        rotation: sim.rot,
        opacity: eye !== undefined && lids ? 1 - Math.min(1, closure) : 1,
        tint: tintOf(layer, frame.gesture, frame.mood.glowGain) * gain,
        ...(faces === undefined ? {} : { faces }),
        ...(layer.kind === "eye" && lids && closure > 0 ? { closed: Math.min(1, closure) } : {}),
      };
    });
}
