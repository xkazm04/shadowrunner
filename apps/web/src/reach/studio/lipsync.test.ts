// The studio's lip-sync (perfection-pass task 4, requirement 4.3): a drawn or warp mouth is shaped
// from the line's track every frame, ahead of the player's own draw; any other rig is left to the
// loudness jaw; Record sets each frame's shapes just before its renderFrame. Fakes for the player,
// the frames and the audio graph.
import { mixSpans, restWeights, type MouthTrack } from "@sr/avatar/core";
import { describe, expect, it, vi } from "vitest";
import { lipSync, monoOf, trackOfLine, trackShaper } from "./lipsync";
import { playLine, type LineContext } from "./recorder";

/** Open wide from 0.1 s to 0.3 s of a 0.5 s line. */
const track: MouthTrack = { durationS: 0.5, at: (t) => mixSpans([{ shape: "openWide", startMs: 100, endMs: 300 }], t * 1000) };
const lip = { track, reducedMotion: () => false };

function fakePlayer(mode: "drawn" | "warp" | "still" | undefined, log: string[] = []) {
  return {
    log,
    setMouthShapes: vi.fn((...args: unknown[]) => log.push(args[0] === undefined ? "shapes off" : "shapes")),
    mouthMode: () => mode,
    start: vi.fn(() => log.push("player start")),
    stop: vi.fn(() => log.push("player stop")),
  };
}

function fakeFrames(log: string[]) {
  const pending = new Map<number, (now: number) => void>();
  let next = 1;
  return {
    pending,
    request: vi.fn((callback: (now: number) => void) => {
      log.push("frame requested");
      pending.set(next, callback);
      return next++;
    }),
    cancel: vi.fn((handle: number) => pending.delete(handle)),
    run(now: number) {
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback(now);
    },
  };
}

describe("trackShaper", () => {
  it.each(["drawn", "warp"] as const)("shapes a %s mouth from the track at the line's clock, the jaw read ahead", (mode) => {
    const player = fakePlayer(mode);
    const shaper = trackShaper(player, lip, () => 0.2);
    shaper.frame(1 / 30);
    const [shapes, options] = player.setMouthShapes.mock.calls[0] ?? [];
    expect(shapes).toEqual(track.at(0.2));
    expect(options).toHaveProperty("jaw");
    shaper.clear();
    expect(player.setMouthShapes).toHaveBeenLastCalledWith(undefined);
  });

  it.each(["still", undefined] as const)("leaves a rig whose mouth mode is %s to the loudness jaw", (mode) => {
    const player = fakePlayer(mode);
    const shaper = trackShaper(player, lip, () => 0.2);
    shaper.frame(1 / 30);
    shaper.clear();
    expect(player.setMouthShapes).not.toHaveBeenCalled();
  });

  it("under reduced motion sends one soft half-open shape, never the track's", () => {
    const player = fakePlayer("warp");
    const shaper = trackShaper(player, { track, reducedMotion: () => true }, () => 0.2);
    for (let k = 0; k < 30; k += 1) shaper.frame(1 / 30);
    const shapes = player.setMouthShapes.mock.calls.at(-1)?.[0] as ReturnType<typeof restWeights>;
    expect(shapes.openWide).toBe(0);
    expect(shapes.openMid).toBeGreaterThan(0.45);
  });
});

describe("lipSync (Preview)", () => {
  it("runs its frame before the player's: stops the loop, asks for a frame, starts the loop again", () => {
    const log: string[] = [];
    const player = fakePlayer("drawn", log);
    const frames = fakeFrames(log);
    const stop = lipSync(player, lip, () => 0.2, frames);
    expect(log).toEqual(["player stop", "frame requested", "player start"]);
    frames.run(16);
    frames.run(32);
    expect(player.setMouthShapes).toHaveBeenCalledTimes(2);
    stop();
    expect(frames.pending.size).toBe(0);
    expect(player.setMouthShapes).toHaveBeenLastCalledWith(undefined);
  });

  it("does nothing for a jaw-only rig", () => {
    const log: string[] = [];
    const player = fakePlayer(undefined, log);
    lipSync(player, lip, () => 0.2, fakeFrames(log))();
    expect(log).toEqual([]);
  });
});

describe("playLine's clock and the line's track", () => {
  it("counts seconds on the audio clock from the line's start", () => {
    let now = 3;
    const source = { buffer: null, onended: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const context = {
      destination: {},
      get currentTime() {
        return now;
      },
      createBufferSource: () => source,
      createMediaStreamDestination: () => ({}),
    } as object as LineContext;
    const playback = playLine(context, { duration: 1 } as AudioBuffer, { attachAudio: vi.fn() });
    now = 3.25;
    expect(playback.clock()).toBeCloseTo(0.25, 9);
  });

  it("mixes channels down and analyses a decoded buffer; a silent one is all rest", () => {
    const left = new Float32Array([0.5, -0.5]);
    const right = new Float32Array([0.1, 0.1]);
    const stereo = { numberOfChannels: 2, length: 2, sampleRate: 16000, getChannelData: (c: number) => (c === 0 ? left : right) };
    expect([...monoOf(stereo)]).toEqual([expect.closeTo(0.3, 6), expect.closeTo(-0.2, 6)]);
    const silent = new Float32Array(16000);
    const line = trackOfLine({ numberOfChannels: 1, length: silent.length, sampleRate: 16000, getChannelData: () => silent }, "Hello.");
    expect(line?.durationS).toBe(1);
    expect(line?.at(0.5)).toEqual(restWeights());
  });
});
