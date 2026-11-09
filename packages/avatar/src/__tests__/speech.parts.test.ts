// The lip-sync parts (perfection-pass task 4): spelling to shapes, the text aligner, the per-frame
// drive (jaw lead, the reduced-motion twin) and the moved scheduler's span mix.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MOUTH_SHAPES, restWeights, type MouthShape } from "../mouth/shapes.js";
import { REDUCED_EASE_MS } from "../mouth/state.js";
import { BLEND_MS, createVisemeTrack, JAW_LEAD_MS, mixSpans } from "../mouth/track.js";
import { alignShapes, MAX_CELLS } from "../speech/align.js";
import type { MouthTrack } from "../speech/analyse.js";
import { createTrackMouth } from "../speech/drive.js";
import { textShapes, wordShapes } from "../speech/letters.js";

const SHAPES = MOUTH_SHAPES.length;

describe("spelling to shapes", () => {
  it("closes on p/b/m, bites on f/v, shows the tongue on th/t/d/n/l, rounds on oo/w/r", () => {
    expect(wordShapes("bob")).toEqual(["closed", "round", "closed"]);
    expect(wordShapes("five")).toEqual(["teeth", "openWide", "teeth"]);
    expect(wordShapes("thin")).toEqual(["tongue", "narrow", "tongue"]);
    expect(wordShapes("moon")).toEqual(["closed", "round", "tongue"]);
    expect(wordShapes("made")).toEqual(["closed", "openMid", "tongue"]);
    expect(wordShapes("the")).toEqual(["tongue", "openMid"]);
  });

  it("counts doubled letters once and merges neighbouring repeats", () => {
    expect(wordShapes("pepper")).toEqual(["closed", "openMid", "closed", "round"]);
    for (const word of ["mississippi", "bookkeeper", "sweet"]) {
      const shapes = wordShapes(word);
      for (let k = 1; k < shapes.length; k += 1) expect(shapes[k]).not.toBe(shapes[k - 1]);
    }
  });

  it("reads a line as words, dropping punctuation and keeping digits as one word", () => {
    expect(textShapes("Bob, sit!  7")).toEqual([["closed", "round", "closed"], ["narrow", "tongue"], wordShapes("number")]);
    expect(textShapes(" ... ")).toEqual([]);
  });
});

/** Log posteriors that say `shape` for each frame of `plan` (others far less likely). */
function posteriorsFor(plan: readonly MouthShape[]): Float32Array {
  const out = new Float32Array(plan.length * SHAPES).fill(Math.log(0.02));
  plan.forEach((shape, t) => (out[t * SHAPES + MOUTH_SHAPES.indexOf(shape)] = Math.log(0.86)));
  return out;
}

const run = (shape: MouthShape, n: number): MouthShape[] => Array.from({ length: n }, () => shape);

describe("alignShapes", () => {
  it("lays the text's shapes where the audio says them, with the pauses as rest", () => {
    const plan = [...run("rest", 10), ...run("closed", 6), ...run("openWide", 14), ...run("rest", 12), ...run("narrow", 9), ...run("tongue", 7), ...run("rest", 10)];
    const aligned = alignShapes(posteriorsFor(plan), [["closed", "openWide"], ["narrow", "tongue"]]);
    expect(aligned).toBeDefined();
    const got = [...(aligned ?? [])].map((k) => MOUTH_SHAPES[k]);
    const agree = got.filter((shape, t) => shape === plan[t]).length / plan.length;
    expect(agree).toBeGreaterThan(0.95);
  });

  it("keeps the text's order whatever the audio says (only the timing comes from the audio)", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...MOUTH_SHAPES), { minLength: 20, maxLength: 120 }), (plan) => {
        const words: MouthShape[][] = [["closed", "openWide"], ["round"], ["narrow", "tongue", "openMid"]];
        const aligned = alignShapes(posteriorsFor(plan), words);
        const order = [...(aligned ?? [])].map((k) => MOUTH_SHAPES[k]).filter((shape, t, all) => shape !== "rest" && shape !== all[t - 1]);
        expect(order).toEqual(words.flat());
      }),
    );
  });

  it("gives up (the caller keeps the audio's reading) with no shapes or past MAX_CELLS", () => {
    expect(alignShapes(posteriorsFor(run("rest", 10)), [])).toBeUndefined();
    const frames = Math.ceil(MAX_CELLS / 6) + 1; // 6 states: rest, four shapes, rest
    expect(alignShapes(new Float32Array(frames * SHAPES), [["closed", "round", "tongue", "narrow"]])).toBeUndefined();
  });
});

/** A track that is open wide from 0.1 s to 0.2 s of a 0.5 s clip. */
const wide: MouthTrack = {
  durationS: 0.5,
  at: (t) => mixSpans([{ shape: "openWide", startMs: 100, endMs: 200 }], t * 1000),
};

describe("createTrackMouth", () => {
  it("shows the track at the clip's time and opens the jaw for JAW_LEAD_MS ahead", () => {
    const drive = createTrackMouth();
    let now = 0.1 - BLEND_MS / 2000 - JAW_LEAD_MS / 2000;
    const input = drive({ mouth: { track: wide, clock: () => now }, reducedMotion: false, dt: 1 / 60 });
    expect(input?.shapes).toEqual(wide.at(now));
    expect(input?.jaw).toEqual(wide.at(now + JAW_LEAD_MS / 1000));
    expect(input?.jaw?.openWide ?? 0).toBeGreaterThan(input?.shapes.openWide ?? 1);
    now = 0.15;
    expect(drive({ mouth: { track: wide, clock: () => now }, reducedMotion: false, dt: 1 / 60 })?.shapes.openWide).toBe(1);
  });

  it("gives no input without a track or before the clock reads (the level drive stays)", () => {
    const drive = createTrackMouth();
    expect(drive({ mouth: undefined, reducedMotion: false, dt: 0.016 })).toBeUndefined();
    expect(drive({ mouth: { track: wide, clock: () => Number.NaN }, reducedMotion: false, dt: 0.016 })).toBeUndefined();
  });

  it("reduced motion: one soft half-open shape while the clip plays, eased in and out over REDUCED_EASE_MS", () => {
    const drive = createTrackMouth();
    let t = 0;
    const mouth = { track: wide, clock: () => t };
    const step = (): number => drive({ mouth, reducedMotion: true, dt: 0.01 })?.shapes.openMid ?? NaN;
    const seen: number[] = [];
    for (; t < 0.5; t += 0.01) seen.push(step());
    // Eases toward 0.5 (never articulates: openWide and the other shapes stay 0).
    expect(seen[0]).toBeGreaterThan(0);
    const held = seen.at(-1) ?? 0;
    expect(held).toBeCloseTo(0.5 * (1 - Math.exp(-500 / REDUCED_EASE_MS)), 2);
    for (let k = 1; k < seen.length; k += 1) expect(seen[k] ?? 0).toBeGreaterThanOrEqual(seen[k - 1] ?? 0);
    t = 0.6;
    const after = drive({ mouth, reducedMotion: true, dt: 0.01 });
    expect(after?.shapes.openWide).toBe(0);
    expect(after?.shapes.openMid).toBeCloseTo(held * Math.exp(-10 / REDUCED_EASE_MS), 6);
  });
});

describe("the scheduler, moved from the lab", () => {
  it("takes the eight shapes as visemes when no map is given", () => {
    const track = createVisemeTrack();
    track.addViseme("u", "round", 0, 200);
    track.startUtterance("u", 1000, 200);
    expect(track.weights(1100).round).toBe(1);
    expect(track.weights(900)).toEqual(restWeights());
  });

  it("mixSpans: a span's weight under 1 leaves the rest to rest, and the mix sums to 1", () => {
    const half = mixSpans([{ shape: "openWide", startMs: 0, endMs: 100, weight: 0.4 }], 50);
    expect(half.openWide).toBeCloseTo(0.4, 9);
    expect(half.rest).toBeCloseTo(0.6, 9);
    const over = mixSpans(
      [
        { shape: "round", startMs: 0, endMs: 100 },
        { shape: "closed", startMs: 90, endMs: 200 },
      ],
      100,
    );
    expect(MOUTH_SHAPES.reduce((s, k) => s + over[k], 0)).toBeCloseTo(1, 9);
  });
});
