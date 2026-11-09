// The player a preset-size take is recorded from (perfection-pass task 6, requirement 6.3).
//
// Decision: a second player on its own offscreen canvas, not the on-screen one resized. The
// on-screen canvas is CSS-sized to the stage; giving its drawing buffer 1080x1920 for the take
// would stretch what the user watches and then have to be put back. The take player is sized to
// the rig's rect in the preset frame (aspect.ts `placeRig`) with `resize(w, h, 1)` (a preset is
// device pixels: the screen's DPR must not multiply it) and disposed after the take.
//
// The on-screen player mirrors the take: the recorder drives a fan of both, so the same seed,
// step, mood, gesture and mouth reach both and the user sees the take as it is recorded, at the
// stage's size. Its loop is stopped for the take and restarted after, as with an "as shown" take.
// The mirror draws every MIRROR_EVERY-th frame: rendering is the take's bottleneck where WebGL
// is software (measured in headless Chromium, 1080x1080 take + 690 px stage: 15.0 frames/s with
// a full-rate mirror, 17.7 at half rate, 22.2 with none; the encoder alone keeps 30 at 1080x1920).
import { createAvatarPlayer, type AvatarPlayer, type AvatarPlayerOptions } from "@sr/avatar/core";
import { placeRig, type Rect } from "./aspect";

export type FanPlayer = Pick<AvatarPlayer, "attachAudio" | "renderFrame" | "start" | "stop" | "setMouthShapes" | "mouthMode" | "setEmotion" | "gesture">;

/** The on-screen mirror draws every MIRROR_EVERY-th take frame (with the time of the skipped ones). */
export const MIRROR_EVERY = 2;

/** One player's calls made on both; `start` restarts only the on-screen loop (the take player has none). */
export function fan(take: FanPlayer, screen: FanPlayer, every = MIRROR_EVERY): FanPlayer {
  let skipped = 0;
  let owed = 0;
  return {
    attachAudio(source, options) {
      take.attachAudio(source, options);
      screen.attachAudio(source, options);
    },
    renderFrame(dt) {
      take.renderFrame(dt);
      owed += dt;
      skipped += 1;
      if (skipped < every) return;
      screen.renderFrame(owed);
      skipped = 0;
      owed = 0;
    },
    start: () => screen.start(),
    stop() {
      take.stop();
      screen.stop();
    },
    setMouthShapes(shapes, options) {
      take.setMouthShapes?.(shapes, options);
      screen.setMouthShapes?.(shapes, options);
    },
    mouthMode: () => take.mouthMode?.(),
    setEmotion(emotion) {
      take.setEmotion(emotion);
      screen.setEmotion(emotion);
    },
    gesture(gesture) {
      take.gesture(gesture);
      screen.gesture(gesture);
    },
  };
}

export interface TakeStage {
  /** The fan of the take player and the on-screen one. */
  player: FanPlayer;
  /** The take player's canvas, the video's source. */
  source: HTMLCanvasElement;
  /** Where the source goes in the frame. */
  place: Rect;
  dispose(): void;
}

/** A take player for a `frame`-sized video, mirrored on `screen`; undefined when it cannot draw. */
export function takeStage(
  screen: FanPlayer,
  options: Pick<AvatarPlayerOptions, "rig" | "look" | "assets" | "reducedMotion">,
  frame: { width: number; height: number },
  canvas: HTMLCanvasElement,
  make: (canvas: HTMLCanvasElement, options: AvatarPlayerOptions) => AvatarPlayer = createAvatarPlayer,
): TakeStage | undefined {
  const place = placeRig(options.rig, frame);
  let take: AvatarPlayer;
  try {
    take = make(canvas, { ...options, autoSize: false });
  } catch {
    return undefined;
  }
  take.resize(place.width, place.height, 1);
  return { player: fan(take, screen), source: canvas, place, dispose: () => take.dispose() };
}
