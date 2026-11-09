// A clip's mouth track on its clock, per frame (perfection-pass task 4, requirement 4.2, 4.5): what
// AvatarCanvas hands its frame body as `mouth` while a `mouth` prop is set. React-free, so any
// frame loop (a player stepped by hand, the studio) can use it the same way.
//
// - Full motion: the shown mix is the track at the clip's time; the jaw's mix is read JAW_LEAD_MS
//   ahead, as the lab's lip arms do, because the jaw eases toward its target.
// - Reduced motion (the twin, as the lab's): no per-shape articulation. While the clip plays
//   (0 <= t < durationS) the mouth eases (REDUCED_EASE_MS) to one soft, half-open speaking shape,
//   and back to rest after it.
// - A clock that reads NaN (no media yet) gives no input: the level drive stays.
import { restWeights, type ShapeWeights } from "../mouth/shapes.js";
import { REDUCED_EASE_MS, type MouthShapesInput } from "../mouth/state.js";
import { JAW_LEAD_MS } from "../mouth/track.js";
import type { MouthTrack } from "./analyse.js";

/** A clip's track and the clip's clock (seconds into the clip, e.g. `audio.currentTime`). */
export interface ClipMouth {
  track: MouthTrack;
  clock: () => number;
}

export interface TrackFrame {
  mouth: ClipMouth | undefined;
  reducedMotion: boolean;
  /** Seconds since the previous frame. */
  dt: number;
}

/** Per mount: the frame body's `mouth` input for this frame, or undefined (the level drive). */
export function createTrackMouth(): (frame: TrackFrame) => MouthShapesInput | undefined {
  let soft = 0;
  return ({ mouth, reducedMotion, dt }) => {
    if (mouth === undefined) {
      soft = 0;
      return undefined;
    }
    const t = mouth.clock();
    if (!Number.isFinite(t)) return undefined;
    if (!reducedMotion) {
      soft = 0;
      return { shapes: mouth.track.at(t), jaw: mouth.track.at(t + JAW_LEAD_MS / 1000) };
    }
    const target = t >= 0 && t < mouth.track.durationS ? 1 : 0;
    const dtMs = Number.isFinite(dt) ? Math.max(0, dt) * 1000 : 0;
    soft += (target - soft) * (1 - Math.exp(-dtMs / REDUCED_EASE_MS));
    const shapes: ShapeWeights = restWeights();
    shapes.openMid = 0.5 * soft;
    shapes.rest = 1 - shapes.openMid;
    return { shapes };
  };
}
