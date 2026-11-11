// The studio's lip-sync (perfection-pass task 4, requirement 4.3): the decoded line's mouth track
// (@sr/avatar's analyseSpeech, with the line's words) shapes the player's mouth every frame through
// `setMouthShapes`, on the line's own audio clock (`Playback.clock`). Preview runs it beside the
// player's loop (`lipSync`); Record steps it before each `renderFrame` (`trackShaper`, recorder.ts).
//
// Decisions:
// - Only a player whose rig moves its own mouth (mouthMode "drawn", "warp" or, companion-lanes, "morph")
//   is shaped; any other rig keeps the loudness jaw from the level tap that playLine attaches, as before.
// - Order in a frame matters (the shapes set must be the ones drawn): `lipSync` stops the player's
//   loop, registers its own frame callback, then starts the player again, so in every animation
//   frame the shapes are set first and the player draws them (callbacks run in the order they were
//   requested, and each loop re-requests in its own callback).
// - Reduced motion is the player's own reading (prefers-reduced-motion, the shell's data-motion):
//   one soft speaking shape while the line plays (@sr/avatar's createTrackMouth).
import { analyseSpeech, createTrackMouth, type AvatarPlayer, type MouthTrack } from "@sr/avatar/core";
import type { Frames } from "./recorder";

export type LipPlayer = Pick<AvatarPlayer, "setMouthShapes" | "mouthMode">;

export interface LipTrack {
  track: MouthTrack;
  reducedMotion(): boolean;
}

/** Whether the player draws or bends its own mouth and takes shapes. */
export function shapesMouth(player: LipPlayer): boolean {
  const mode = player.mouthMode?.();
  return (mode === "drawn" || mode === "warp" || mode === "morph") && player.setMouthShapes !== undefined;
}

/** The buffer's channels mixed down to one. */
export function monoOf(buffer: Pick<AudioBuffer, "numberOfChannels" | "length" | "getChannelData">): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i += 1) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / buffer.numberOfChannels;
  }
  return mono;
}

/** The line's track, or undefined when it cannot be analysed (the loudness jaw stays). */
export function trackOfLine(buffer: Pick<AudioBuffer, "numberOfChannels" | "length" | "getChannelData" | "sampleRate">, text: string): MouthTrack | undefined {
  try {
    const track = analyseSpeech(monoOf(buffer), buffer.sampleRate, { text });
    return track.durationS > 0 ? track : undefined;
  } catch {
    return undefined;
  }
}

/** Steps the player's shapes for the line at `clock()`; a no-op for a rig that does not shape its mouth. */
export function trackShaper(player: LipPlayer, lip: LipTrack, clock: () => number): { frame(dt: number): void; clear(): void } {
  const on = shapesMouth(player);
  const drive = createTrackMouth();
  return {
    frame(dt) {
      if (!on) return;
      const input = drive({ mouth: { track: lip.track, clock }, reducedMotion: lip.reducedMotion(), dt });
      player.setMouthShapes?.(input?.shapes, input?.jaw === undefined ? undefined : { jaw: input.jaw });
    },
    clear() {
      if (on) player.setMouthShapes?.(undefined);
    },
  };
}

/** Preview: shapes the player's mouth every animation frame, ahead of its own draw. Returns the stop. */
export function lipSync(player: LipPlayer & Pick<AvatarPlayer, "start" | "stop">, lip: LipTrack, clock: () => number, frames: Frames): () => void {
  if (!shapesMouth(player)) return () => undefined;
  return frameLoop(player, trackShaper(player, lip, clock), frames);
}

/**
 * Runs `step.frame(dt)` every animation frame ahead of the player's own draw (the order trick in
 * the header), until the returned stop, which also calls `step.clear()`. The studio's Preview of a
 * script (perfection-pass task 6) runs its director through it.
 */
export function frameLoop(player: Pick<AvatarPlayer, "start" | "stop">, step: { frame(dt: number): void; clear(): void }, frames: Frames): () => void {
  let last: number | undefined;
  let handle: number | undefined;
  const tick = (now: number): void => {
    step.frame(last === undefined ? 0 : Math.max(0, (now - last) / 1000));
    last = now;
    handle = frames.request(tick);
  };
  player.stop();
  handle = frames.request(tick);
  player.start();
  return () => {
    if (handle !== undefined) frames.cancel(handle);
    handle = undefined;
    step.clear();
  };
}
