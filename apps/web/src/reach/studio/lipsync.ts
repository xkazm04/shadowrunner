// The studio's lip-sync (perfection-pass task 4, requirement 4.3): the decoded line's mouth track
// (@sr/avatar's analyseSpeech, with the line's words) shapes the player's mouth every frame through
// the player, on the line's own audio clock (`Playback.clock`). Preview hands the player the track
// and clock (`lipSync`, `setClipMouth`), and the player's own loop steps it before each draw; Record
// steps it through `setMouthShapes` before each `renderFrame` (`trackShaper`, recorder.ts).
//
// Decisions:
// - Only a player whose rig moves its own mouth (mouthMode "drawn", "warp" or, companion-lanes, "morph")
//   is shaped; any other rig keeps the loudness jaw from the level tap that playLine attaches, as before.
// - Preview runs no loop of its own: the player is the one host loop (spec avatar-reach, "Player
//   core"), so the shapes drawn are always the frame's. `frameLoop` keeps the stop / request /
//   start order trick for the script director (StudioPage), which sets more than the mouth.
// - Reduced motion is the player's own reading (prefers-reduced-motion, the shell's data-motion):
//   one soft speaking shape while the line plays (@sr/avatar's createTrackMouth).
import { analyseSpeech, createTrackMouth, type AvatarPlayer, type AvatarPlayerInputs, type MouthTrack } from "@sr/avatar/core";
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

/** Preview: the player's own loop shapes its mouth from the line's track every frame. Returns the stop. */
export function lipSync(player: LipPlayer & Pick<AvatarPlayerInputs, "setClipMouth">, lip: Pick<LipTrack, "track">, clock: () => number): () => void {
  if (!shapesMouth(player)) return () => undefined;
  player.setClipMouth({ track: lip.track, clock });
  return () => player.setClipMouth(undefined);
}

/**
 * Runs `step.frame(dt)` every animation frame ahead of the player's own draw, until the returned
 * stop, which also calls `step.clear()`. Order trick: it stops the player's loop, requests its own
 * frame, then starts the player again, so in every animation frame the step runs first (callbacks
 * run in the order they were requested, and each loop re-requests in its own callback). The
 * studio's Preview of a script (perfection-pass task 6) runs its director through it.
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
