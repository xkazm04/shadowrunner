// A script as one take (perfection-pass task 6, requirement 6.2): the lines' decoded clips laid
// end to end with a pause between them, mixed into ONE audio buffer, plus what the face does when:
// each line's mood, gesture and mouth track on that buffer's clock.
//
// Decisions:
// - Offsets are whole samples, computed before any seconds: line i starts at the sum of the
//   earlier lines' lengths plus i pauses (each rounded to samples once). Its start in seconds is
//   that sample count over the rate, so the mouth track and the audio share one timeline exactly;
//   one source plays the mix, so there is one clock and nothing to drift between lines.
// - The clips were decoded by the same AudioContext (decodeAudioData resamples to its rate). A mono
//   clip in a stereo mix is copied to every channel.
// - Mood: line 0's at the take's start; line i's at the start of the pause before it, so the
//   crossfade (MOOD_FADE_S, 0.25 s) runs while the mouth rests. A line without a mood uses the
//   look's. Gesture: at the line's first sample.
// - The mouth: each line's own track on its own clock (take clock minus the line's start). The
//   line is chosen by the time JAW_LEAD_MS ahead, so the jaw opens into a line as it does in one.
//   Between lines the track reads rest (outside its clip) and the reduced-motion twin closes.
import { createTrackMouth, JAW_LEAD_MS, type AvatarPlayer, type MouthTrack } from "@sr/avatar/core";
import type { Emotion, Gesture } from "@sr/rig";
import { shapesMouth, type LipPlayer } from "./lipsync";

export interface Clip {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface MixContext<B extends Clip = Clip> {
  createBuffer(channels: number, length: number, sampleRate: number): B;
}

export interface TakePlan {
  sampleRate: number;
  /** Each line's first sample in the mix. */
  starts: number[];
  /** Each line's first sample, seconds (starts / sampleRate). */
  startsS: number[];
  /** Each line's end, seconds. */
  endsS: number[];
  /** The mix's length, samples. */
  length: number;
  durationS: number;
}

/** Where each line goes: `lengths` in samples, `pauseS` between consecutive lines. */
export function planTake(lengths: readonly number[], pauseS: number, sampleRate: number): TakePlan {
  const pause = Math.max(0, Math.round(pauseS * sampleRate));
  const starts: number[] = [];
  let at = 0;
  lengths.forEach((length, i) => {
    if (i > 0) at += pause;
    starts.push(at);
    at += length;
  });
  return {
    sampleRate,
    starts,
    startsS: starts.map((s) => s / sampleRate),
    endsS: starts.map((s, i) => (s + (lengths[i] ?? 0)) / sampleRate),
    length: at,
    durationS: at / sampleRate,
  };
}

/** The clips mixed into one buffer at the plan's sample offsets. */
export function mixTake<B extends Clip>(context: MixContext<B>, clips: readonly Clip[], plan: TakePlan): B {
  const channels = Math.max(1, ...clips.map((clip) => clip.numberOfChannels));
  const mix = context.createBuffer(channels, Math.max(1, plan.length), plan.sampleRate);
  for (let c = 0; c < channels; c += 1) {
    const out = mix.getChannelData(c);
    clips.forEach((clip, i) => {
      const data = clip.getChannelData(Math.min(c, clip.numberOfChannels - 1));
      out.set(data.subarray(0, Math.max(0, Math.min(data.length, out.length - (plan.starts[i] ?? 0)))), plan.starts[i] ?? 0);
    });
  }
  return mix;
}

export interface Cue {
  atS: number;
  emotion?: Emotion;
  gesture?: Gesture;
}

/** What the face does when (see the header): sorted by time. */
export function takeCues(lines: readonly { emotion?: Emotion; gesture?: Gesture }[], plan: TakePlan, lookEmotion: Emotion): Cue[] {
  const cues: Cue[] = [];
  lines.forEach((line, i) => {
    const moodAt = i === 0 ? 0 : (plan.endsS[i - 1] ?? 0);
    cues.push({ atS: moodAt, emotion: line.emotion ?? lookEmotion });
    if (line.gesture !== undefined) cues.push({ atS: plan.startsS[i] ?? 0, gesture: line.gesture });
  });
  return cues.sort((a, b) => a.atS - b.atS);
}

export type DirectedPlayer = LipPlayer & Pick<AvatarPlayer, "setEmotion" | "gesture">;

export interface LineMouth {
  track: MouthTrack | undefined;
  startS: number;
}

/** The index of the line whose mouth plays at take time `tS` (the last one started by `tS`). */
export function lineAt(lines: readonly LineMouth[], tS: number): number {
  let at = 0;
  lines.forEach((line, i) => {
    if (line.startS <= tS) at = i;
  });
  return at;
}

/**
 * The take's director on `clock` (seconds into the mix): each frame fires the cues that are due
 * and shapes the mouth from the current line's track. `clear` lets go of the mouth.
 */
export function directTake(
  player: DirectedPlayer,
  cues: readonly Cue[],
  lines: readonly LineMouth[],
  reducedMotion: () => boolean,
  clock: () => number,
): { frame(dt: number): void; clear(): void } {
  const shaping = shapesMouth(player);
  const drive = createTrackMouth();
  let next = 0;
  return {
    frame(dt) {
      const t = clock();
      while (next < cues.length && (cues[next]?.atS ?? Infinity) <= t) {
        const cue = cues[next];
        next += 1;
        if (cue?.emotion !== undefined) player.setEmotion(cue.emotion);
        if (cue?.gesture !== undefined) player.gesture(cue.gesture);
      }
      if (!shaping) return;
      const line = lines[lineAt(lines, t + JAW_LEAD_MS / 1000)];
      const track = line?.track;
      const start = line?.startS ?? 0;
      const input = drive({ mouth: track === undefined ? undefined : { track, clock: () => clock() - start }, reducedMotion: reducedMotion(), dt });
      player.setMouthShapes?.(input?.shapes, input?.jaw === undefined ? undefined : { jaw: input.jaw });
    },
    clear() {
      if (shaping) player.setMouthShapes?.(undefined);
    },
  };
}

export interface TakeLine {
  emotion?: Emotion;
  gesture?: Gesture;
}

export interface DecodedLine<B extends Clip = Clip> {
  buffer: B;
  track: MouthTrack | undefined;
}

export interface BuiltTake<B extends Clip> {
  mix: B;
  plan: TakePlan;
  cues: Cue[];
  mouths: LineMouth[];
}

/** The script's sentence when its take runs past `maxS` seconds. */
export const tooLong = (seconds: number, maxS: number): string =>
  `This script runs ${Math.ceil(seconds)} s; a take is at most ${maxS} s. Remove a line or shorten the pause.`;

/** The whole take from the decoded lines (same order as `lines`), or the sentence that says why not. */
export function buildTake<B extends Clip>(
  context: MixContext<B>,
  lines: readonly TakeLine[],
  decoded: readonly DecodedLine[],
  options: { pauseMs: number; lookEmotion: Emotion; maxS: number },
): { ok: true; take: BuiltTake<B> } | { ok: false; error: string } {
  const sampleRate = decoded[0]?.buffer.sampleRate ?? 48000;
  const plan = planTake(
    decoded.map((line) => line.buffer.length),
    options.pauseMs / 1000,
    sampleRate,
  );
  if (plan.durationS > options.maxS) return { ok: false, error: tooLong(plan.durationS, options.maxS) };
  return {
    ok: true,
    take: {
      mix: mixTake(
        context,
        decoded.map((line) => line.buffer),
        plan,
      ),
      plan,
      cues: takeCues(lines, plan, options.lookEmotion),
      mouths: decoded.map((line, i) => ({ track: line.track, startS: plan.startsS[i] ?? 0 })),
    },
  };
}
