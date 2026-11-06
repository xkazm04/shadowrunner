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
import { applyLook, MOOD_FADE_S, poseLayers, type Drive, type Emotion, type Gesture, type LayerPose, type Look, type Rig } from "@sr/rig";
import type { LookAtPoint } from "../driver/lookAt.js";
import { initialState, type Gaze } from "../driver/state.js";
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
  lookAt?: LookAtPoint;
  /** Overrides the driver (tests, screenshots). */
  drive?: Drive;
  /** Target eyes-only dim, 0..1 (default 0). */
  dim?: number;
  /** A caller's mouth mix (visemes); only a rig with `mouth` reads it. Absent = the level drive. */
  mouth?: MouthShapesInput;
}

/** What one frame hands to `renderer.draw(poses, look, clock)`. */
export interface FrameOutput {
  poses: LayerPose[];
  clock: FrameClock;
  /** The driver's clock after this frame, seconds. */
  t: number;
}

/** A frame body with its own driver state, seeded with `seed`. */
export function createFrameBody(seed: number): (inputs: FrameBodyInputs) => FrameOutput {
  const dress = dresser();
  const fadeMood = moodFader();
  let state = initialState(seed);
  let dimShown = 0;
  const stepMouth = createMouthState();
  return (p) => {
    const mode = mouthMode(p.rig.mouth);
    const mouth =
      mode !== "drawn" && mode !== "warp"
        ? undefined
        : stepMouth({ emotion: p.look.emotion, level: p.level, reducedMotion: p.reducedMotion, dt: p.dt, ...(p.mouth === undefined ? {} : { input: p.mouth }) });
    const jawLevel = mode === "warp" && p.mouth === undefined ? p.level : (mouth?.level ?? p.level);
    const next = advanceFrame(state, {
      dt: p.dt,
      level: jawLevel,
      gaze: p.gaze,
      reducedMotion: p.reducedMotion,
      ...(p.gesture === undefined ? {} : { gesture: p.gesture }),
      ...(p.lookAt === undefined ? {} : { lookAt: p.lookAt }),
      ...(p.drive === undefined ? {} : { drive: p.drive }),
    });
    state = next.state;
    const mood = fadeMood(p.look.emotion, state.t, p.reducedMotion);
    const drive = p.drive !== undefined || mood === undefined ? next.drive : { ...next.drive, mood };
    const poses = poseLayers(dress(p.rig, p.look), p.look, drive);
    dimShown = easeDim(dimShown, p.dim ?? 0, p.dt, p.reducedMotion);
    const clock: FrameClock = { t: p.drive?.t ?? state.t, reducedMotion: p.reducedMotion, ...(dimShown > 0 ? { dim: dimShown } : {}), ...(mouth?.pose === undefined ? {} : { mouth: mouth.pose }) };
    return { poses, clock, t: state.t };
  };
}
