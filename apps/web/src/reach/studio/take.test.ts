// A script as one take (perfection-pass task 6, requirement 6.2): whole-sample offsets, a mix
// that holds every line's samples exactly at its offset (property), cues in the pauses, and the
// director that fires them and shapes the mouth from each line's own track on its own clock.
import { mixSpans, restWeights, type MouthTrack } from "@sr/avatar/core";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { buildTake, directTake, lineAt, mixTake, planTake, takeCues, type Clip } from "./take";

function clip(samples: number[][], sampleRate = 8000): Clip {
  const data = samples.map((s) => Float32Array.from(s));
  return { numberOfChannels: data.length, length: data[0]?.length ?? 0, sampleRate, getChannelData: (c) => data[c] ?? new Float32Array() };
}

const context = { createBuffer: (channels: number, length: number, sampleRate: number) => clip(Array.from({ length: channels }, () => new Array<number>(length).fill(0)), sampleRate) };

describe("planTake", () => {
  it("lays lines end to end with whole-sample pauses", () => {
    const plan = planTake([100, 50, 25], 0.01, 1000);
    expect(plan.starts).toEqual([0, 110, 170]);
    expect(plan.startsS).toEqual([0, 0.11, 0.17]);
    expect(plan.endsS).toEqual([0.1, 0.16, 0.195]);
    expect(plan.length).toBe(195);
  });

  it("puts the last of eight real-length lines exactly where its samples are (no drift)", () => {
    // Malakor's eight standalone clips (s) at 48 kHz, the default 350 ms pause.
    const seconds = [15.68, 15.12, 14.14, 12.84, 13.66, 8.8, 12.04, 11.7];
    const rate = 48000;
    const plan = planTake(
      seconds.map((s) => Math.round(s * rate)),
      0.35,
      rate,
    );
    const last = plan.starts.length - 1;
    // The mouth track's start (seconds) and the audio's first sample of line 8 are one instant.
    expect((plan.startsS[last] ?? 0) * rate).toBe(plan.starts[last]);
    expect(plan.durationS).toBeCloseTo(seconds.reduce((a, b) => a + b, 0) + 7 * 0.35, 6);
  });
});

describe("mixTake", () => {
  it("holds every line's samples at its offset, silence between (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 40 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 30 }),
        fc.boolean(),
        (lines, pause, stereo) => {
          const clips = lines.map((l, i) => clip(stereo && i % 2 === 0 ? [l, l.map((v) => -v)] : [l], 100));
          const plan = planTake(
            clips.map((c) => c.length),
            pause / 100,
            100,
          );
          const mix = mixTake(context, clips, plan);
          expect(mix.length).toBe(plan.length);
          const used = new Set<number>();
          clips.forEach((c, i) => {
            const start = plan.starts[i] ?? 0;
            for (let ch = 0; ch < mix.numberOfChannels; ch += 1) {
              const want = c.getChannelData(Math.min(ch, c.numberOfChannels - 1));
              const got = mix.getChannelData(ch).subarray(start, start + c.length);
              expect([...got]).toEqual([...want]);
            }
            for (let k = 0; k < c.length; k += 1) used.add(start + k);
          });
          for (let k = 0; k < mix.length; k += 1) if (!used.has(k)) expect(mix.getChannelData(0)[k]).toBe(0);
        },
      ),
    );
  });
});

describe("takeCues", () => {
  it("sets line 1's mood at once, later moods as the pause before them starts, gestures on the line's first sample", () => {
    const plan = planTake([100, 100, 100], 0.05, 1000);
    const cues = takeCues([{ emotion: "smug", gesture: "nod" }, {}, { emotion: "grim", gesture: "flare" }], plan, "neutral");
    expect(cues).toEqual([
      { atS: 0, emotion: "smug" },
      { atS: 0, gesture: "nod" },
      { atS: 0.1, emotion: "neutral" },
      { atS: 0.25, emotion: "grim" },
      { atS: 0.3, gesture: "flare" },
    ]);
  });
});

describe("directTake", () => {
  /** Open wide from 0.1 s to 0.3 s of a 0.5 s line. */
  const track: MouthTrack = { durationS: 0.5, at: (t) => mixSpans([{ shape: "openWide", startMs: 100, endMs: 300 }], t * 1000) };

  function player(mode: "drawn" | "warp" | "still" = "warp") {
    return { setEmotion: vi.fn(), gesture: vi.fn(), setMouthShapes: vi.fn(), mouthMode: () => mode };
  }

  it("fires each cue once when its time comes", () => {
    let t = 0;
    const p = player("still");
    const director = directTake(p, [{ atS: 0, emotion: "smug" }, { atS: 0, gesture: "nod" }, { atS: 1, emotion: "grim" }], [], () => false, () => t);
    director.frame(0);
    director.frame(0.03);
    expect(p.setEmotion.mock.calls).toEqual([["smug"]]);
    expect(p.gesture.mock.calls).toEqual([["nod"]]);
    t = 1.2;
    director.frame(0.03);
    expect(p.setEmotion.mock.calls).toEqual([["smug"], ["grim"]]);
    expect(p.setMouthShapes).not.toHaveBeenCalled();
  });

  it("shapes line 2's mouth on its own clock, and rests in the pause", () => {
    let t = 0;
    const p = player();
    const mouths = [
      { track, startS: 0 },
      { track, startS: 0.85 },
    ];
    const director = directTake(p, [], mouths, () => false, () => t);
    t = 0.2;
    director.frame(0.03);
    expect(p.setMouthShapes.mock.calls.at(-1)?.[0]).toEqual(track.at(0.2));
    t = 0.65; // the pause: line 1 is over
    director.frame(0.03);
    expect(p.setMouthShapes.mock.calls.at(-1)?.[0]).toEqual(restWeights());
    t = 0.85 + 0.2;
    director.frame(0.03);
    expect(p.setMouthShapes.mock.calls.at(-1)?.[0]).toEqual(track.at(0.2));
    director.clear();
    expect(p.setMouthShapes).toHaveBeenLastCalledWith(undefined);
  });

  it("leaves a line without a track to the loudness jaw", () => {
    const p = player();
    directTake(p, [], [{ track: undefined, startS: 0 }], () => false, () => 0.2).frame(0.03);
    expect(p.setMouthShapes).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("picks the line by the time a jaw lead ahead", () => {
    const mouths = [
      { track, startS: 0 },
      { track, startS: 1 },
    ];
    expect(lineAt(mouths, 0.5)).toBe(0);
    expect(lineAt(mouths, 1)).toBe(1);
    expect(lineAt(mouths, -1)).toBe(0);
  });
});

describe("buildTake", () => {
  it("mixes, cues and places each line's track, or says the script is too long", () => {
    const track: MouthTrack = { durationS: 0.2, at: () => restWeights() };
    const decoded = [
      { buffer: clip([[0.1, 0.2]], 10), track },
      { buffer: clip([[0.3]], 10), track: undefined },
    ];
    const built = buildTake(context, [{ emotion: "smug" }, {}], decoded, { pauseMs: 100, lookEmotion: "neutral", maxS: 10 });
    expect(built.ok && [...built.take.mix.getChannelData(0)]).toEqual([expect.closeTo(0.1, 6), expect.closeTo(0.2, 6), 0, expect.closeTo(0.3, 6)]);
    expect(built.ok && built.take.mouths).toEqual([
      { track, startS: 0 },
      { track: undefined, startS: 0.3 },
    ]);
    const long = buildTake(context, [{}, {}], decoded, { pauseMs: 100, lookEmotion: "neutral", maxS: 0.2 });
    expect(long).toEqual({ ok: false, error: expect.stringContaining("at most 0.2 s") });
  });
});
