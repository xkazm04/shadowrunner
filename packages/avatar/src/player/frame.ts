// The avatar frame body shared by <AvatarCanvas> and the React-free player (spec avatar-reach,
// design "Player core"): one driver step, the mood crossfade, the dressed rig posed, the dim eased,
// and the arguments for `renderer.draw`. Both callers own their clock, canvas and renderer; this
// owns the per-mount state (driver state, mood fade, dressed-rig cache, eased dim).
//
// Decisions the spec leaves open:
// - Mood crossfade (character-control "Moods"): when `look.emotion` changes, the drive carries
//   `mood: { from: previous, mix }` with mix rising 0 -> 1 over MOOD_FADE_S of driver time; under
//   reduced motion the change is instant (no `mood`). A change mid-fade starts a new fade from the
//   emotion it was fading to. A `drive` override passes through untouched.
// - `dim` is eased on the frame's dt and handed to the renderer in the frame clock.
// - The drawn mouth (spark llm-avatar-lab, "the rig owns the mouth"): for a rig with a usable
//   `mouth`, the mouth state (mouth/state.ts) turns the level (or a caller's `mouth` mix) and the
//   emotion into the frame clock's `mouth`, and the jaw opens for that mouth (its level replaces
//   the raw level). A rig without `mouth` runs exactly as before: no `mouth` key, the raw level.
// - The art mouth (spark art-mouth, mouthMode "warp"): the same mouth state runs and its pose goes
//   out as the frame clock's `mouth` (the GL renderer bends the art's own lips with it; canvas2D,
//   which only paints a "drawn" mouth, ignores it). The jaw keeps the raw level under the level drive,
//   so the jaw (and the canvas2D fallback) moves exactly as before; a caller's mix (visemes) opens
//   the jaw for that mix, as on a drawn rig. Modes "still" and undefined run exactly as before.
// - Face control (face-control): the profile is `resolveFace(rig, look)` every frame (the look may
//   change live from the creator's Face panel). Its drift reaches the driver, and on a rig with
//   irises its gaze part too (the eyes lead); its emotion strength scales the mouth's emotion bias;
//   pose.ts takes the rest. With `assets`, the socket half extents are measured and dead patches
//   dropped (render/inspect.ts) once per rig; the drive's `mood` goes out in the frame clock so the
//   renderers fade the look's light with it.
// - Signature acts (tiger L1): `act` names a layer on the frame its act starts; the body holds it at
//   the driver's t and hands it to pose.ts as `Drive.act` until it has surely ended (ACT_S_MAX).
//   pose.ts plays it (or, under reduced motion, its static twin). A `drive` override passes through.
// - Secondary motion (perfection-pass V1): once the drive is final (mood, act), the driver's channel
//   springs step toward `springTargetOf` and their lag goes out as `Drive.spring` (the canvas2D
//   fallback draws the same poses, so it swings too).
import { ACT_S_MAX, applyLook, faceOf, hasIris, MOOD_FADE_S, poseLayers, springStrength, springTargetOf, type ActCue, type Drive, type Emotion, type Gesture, type LayerPose, type Look, type Rig } from "@sr/rig";
import type { SurfaceFactory } from "../canvas2d/recolour.js";
import type { LookAtPoint } from "../driver/lookAt.js";
import { initialState, type DriverFace, type DriverState, type Gaze, type SpringState } from "../driver/state.js";
import { springLag, stepSpring } from "../driver/step.js";
import type { AssetLoader } from "../render/assets.js";
import { createRigInspector, withoutDeadPatches, type RigInspector } from "../render/inspect.js";
import type { RigAssets } from "../render/types.js";
import { mouthMode } from "../mouth/anchor.js";
import { createMouthState, type MouthShapesInput } from "../mouth/state.js";
import { easeDim } from "../render/frame.js";
import type { FrameClock } from "../render/types.js";
import { advanceFrame } from "../react/loop.js";

/** Tracks emotion changes on the driver clock; returns the drive's `mood` for this frame. */
export function moodFader(): (emotion: Emotion, t: number, reducedMotion: boolean) => Drive["mood"] {
  let shown: Emotion | undefined;
  let fade: { from: Emotion; start: number } | undefined;
  return (emotion, t, reducedMotion) => {
    if (shown !== undefined && emotion !== shown) fade = { from: shown, start: t };
    shown = emotion;
    if (fade === undefined || reducedMotion || fade.from === emotion) {
      fade = undefined;
      return undefined;
    }
    const mix = (t - fade.start) / MOOD_FADE_S;
    if (!(mix < 1)) {
      fade = undefined;
      return undefined;
    }
    return { from: fade.from, mix: Math.max(0, mix) };
  };
}

/** The rig dressed by the look, recomputed only when either changes. */
export function dresser(): (rig: Rig, look: Look) => Rig {
  let last: { rig: Rig; look: Look; dressed: Rig } | undefined;
  return (rig, look) => {
    if (last === undefined || last.rig !== rig || last.look !== look) last = { rig, look, dressed: applyLook(rig, look) };
    return last.dressed;
  };
}

export interface FrameBodyInputs {
  rig: Rig;
  look: Look;
  /** Seconds since the previous frame; the driver clamps it. */
  dt: number;
  level: number;
  gaze: Gaze;
  reducedMotion: boolean;
  /** Present only on the frame a gesture starts. */
  gesture?: Gesture;
  /** A layer name, present only on the frame its signature act starts (tiger L1). */
  act?: string;
  lookAt?: LookAtPoint;
  /** Overrides the driver (tests, screenshots). */
  drive?: Drive;
  /** Target eyes-only dim, 0..1 (default 0). */
  dim?: number;
  /** A caller's mouth mix (visemes); only a rig with `mouth` reads it. Absent = the level drive. */
  mouth?: MouthShapesInput;
  /** The rig's images (face-control): sockets are measured and dead patches found from them. */
  assets?: RigAssets;
}

/** How a frame body reads images (face-control, render/inspect.ts). */
export interface FrameBodyOptions {
  /** Loads a socket mask missing from the assets. */
  loadAsset?: AssetLoader;
  /** Offscreen surfaces for reading pixels (tests pass stubs). */
  surface?: SurfaceFactory;
}

/** What one frame hands to `renderer.draw(poses, look, clock)`. */
export interface FrameOutput {
  poses: LayerPose[];
  clock: FrameClock;
  /** The driver's clock after this frame, seconds. */
  t: number;
}

/** `state` with `spring` (or without the key when undefined). */
function withSpring(state: DriverState, spring: SpringState | undefined): DriverState {
  const next: DriverState = { ...state };
  if (spring === undefined) delete next.spring;
  else next.spring = spring;
  return next;
}

/** The rig with its dead patches dropped, recomputed only when the rig or the dead set changes. */
function trimmer(): (rig: Rig, dead: ReadonlySet<string>) => Rig {
  let last: { rig: Rig; dead: ReadonlySet<string>; trimmed: Rig } | undefined;
  return (rig, dead) => {
    if (last === undefined || last.rig !== rig || last.dead !== dead) last = { rig, dead, trimmed: withoutDeadPatches(rig, dead) };
    return last.trimmed;
  };
}

/** A frame body with its own driver state, seeded with `seed`. */
export function createFrameBody(seed: number, options: FrameBodyOptions = {}): (inputs: FrameBodyInputs) => FrameOutput {
  const dress = dresser();
  const trim = trimmer();
  const fadeMood = moodFader();
  let state = initialState(seed);
  let dimShown = 0;
  let act: ActCue | undefined;
  const stepMouth = createMouthState();
  let inspector: { assets: RigAssets; inspect: RigInspector } | undefined;
  const inspect = (assets: RigAssets | undefined): RigInspector | undefined => {
    if (assets === undefined) return undefined;
    if (inspector?.assets !== assets) {
      inspector?.inspect.dispose();
      inspector = { assets, inspect: createRigInspector(assets, options.loadAsset, options.surface) };
    }
    return inspector.inspect;
  };
  return (p) => {
    const face = faceOf(p.rig, p.look);
    const irises = hasIris(p.rig);
    const driverFace: DriverFace = { drift: face.motion.drift, ...(irises ? { eyes: { saccadeRate: face.gaze.saccadeRate, habits: face.gaze.habits } } : {}) };
    const mode = mouthMode(p.rig.mouth);
    const emotionStrength = face.mouth.emotion;
    const mouth =
      mode !== "drawn" && mode !== "warp"
        ? undefined
        : stepMouth({ emotion: p.look.emotion, level: p.level, reducedMotion: p.reducedMotion, dt: p.dt, emotionStrength, ...(p.mouth === undefined ? {} : { input: p.mouth }) });
    const jawLevel = mode === "warp" && p.mouth === undefined ? p.level : (mouth?.level ?? p.level);
    const before = state.t;
    const next = advanceFrame(state, {
      dt: p.dt,
      level: jawLevel,
      gaze: p.gaze,
      reducedMotion: p.reducedMotion,
      ...(p.gesture === undefined ? {} : { gesture: p.gesture }),
      ...(p.lookAt === undefined ? {} : { lookAt: p.lookAt }),
      ...(p.drive === undefined ? {} : { drive: p.drive }),
      face: driverFace,
    });
    state = next.state;
    const mood = fadeMood(p.look.emotion, state.t, p.reducedMotion);
    if (p.act !== undefined) act = { layer: p.act, startedAt: state.t };
    if (act !== undefined && !(state.t - act.startedAt < ACT_S_MAX)) act = undefined;
    const moved = p.drive !== undefined || mood === undefined ? next.drive : { ...next.drive, mood };
    const acted = p.drive !== undefined || act === undefined ? moved : { ...moved, act };
    const inspected = inspect(p.assets);
    const rig = inspected === undefined ? p.rig : trim(p.rig, inspected.deadLayers(p.rig));
    const sockets = irises ? inspected?.sockets(p.rig) : undefined;
    const dressed = dress(rig, p.look);
    // Secondary motion (perfection-pass V1): the springs follow this frame's head and act; off under
    // reduced motion, at strength 0, and for a `drive` override (screenshots stay exact).
    const springing = p.drive === undefined && !p.reducedMotion && springStrength(dressed, p.look) > 0;
    const spring = stepSpring(state.spring, state.t - before, springing ? springTargetOf(dressed, p.look, acted, { face }) : undefined);
    if (spring !== state.spring) state = withSpring(state, spring);
    const lag = springLag(spring);
    const drive = lag === undefined ? acted : { ...acted, spring: lag };
    const poses = poseLayers(dressed, p.look, drive, { face, ...(sockets === undefined ? {} : { sockets }) });
    dimShown = easeDim(dimShown, p.dim ?? 0, p.dt, p.reducedMotion);
    const clock: FrameClock = {
      t: p.drive?.t ?? state.t,
      reducedMotion: p.reducedMotion,
      ...(dimShown > 0 ? { dim: dimShown } : {}),
      ...(mouth?.pose === undefined ? {} : { mouth: mouth.pose }),
      ...(drive.mood === undefined ? {} : { mood: drive.mood }),
    };
    return { poses, clock, t: state.t };
  };
}
