// The viseme scheduler on the audio clock (WP3 acceptance): a span's shape is dominant within one
// frame of its start, the blend is continuous, silence returns to rest within 100 ms.
import { describe, expect, it } from "vitest";
import { VISEMES, type Viseme } from "../../../../contract.js";
import { blendParams, dominant, MOUTH_SHAPES, VISEME_SHAPE } from "../shapes.js";
import { BLEND_MS, createVisemeTrack, spanWeight } from "../track.js";

const FRAME_MS = 1000 / 60;
const sum = (w: Record<string, number>): number => Object.values(w).reduce((a, b) => a + b, 0);

/** A line at audio time 1000 ms: aa 0-120, PP 120-200, ou 200-330, FF 330-345 (short), then silence. */
function line() {
  const track = createVisemeTrack();
  const spans: [Viseme, number, number][] = [
    ["aa", 0, 120],
    ["PP", 120, 200],
    ["ou", 200, 330],
    ["FF", 330, 360],
  ];
  for (const [v, s, e] of spans) track.addViseme("u1", v, s, e);
  track.startUtterance("u1", 1000, 400);
  return { track, spans };
}

describe("viseme track", () => {
  it("groups all fifteen Oculus visemes into the eight shapes", () => {
    for (const v of VISEMES) expect(MOUTH_SHAPES).toContain(VISEME_SHAPE[v]);
    expect(new Set(Object.values(VISEME_SHAPE)).size).toBe(8);
  });

  it("makes each span's shape dominant within one frame of its start", () => {
    const { track, spans } = line();
    for (const [v, s] of spans) {
      const w = track.weights(1000 + s + FRAME_MS);
      expect(dominant(w), `${v} at +${s}`).toBe(VISEME_SHAPE[v]);
    }
  });

  it("is a partition of unity at every instant and never jumps (continuous blend)", () => {
    const { track } = line();
    let prev = track.weights(900);
    for (let t = 900; t <= 1600; t += 1) {
      const w = track.weights(t);
      expect(sum(w)).toBeCloseTo(1, 9);
      for (const shape of MOUTH_SHAPES) {
        // smoothstep over BLEND_MS: the steepest slope is 1.5 / BLEND_MS per ms.
        expect(Math.abs(w[shape] - prev[shape]), `${shape} at ${t}`).toBeLessThanOrEqual((1.5 / BLEND_MS) * 2 + 1e-9);
      }
      prev = w;
    }
  });

  it("blends neighbouring shapes over ~BLEND_MS rather than cutting", () => {
    const { track } = line();
    const at = track.weights(1000 + 120);
    expect(at.openWide).toBeCloseTo(0.5, 6);
    expect(at.closed).toBeCloseTo(0.5, 6);
    const before = track.weights(1000 + 120 - BLEND_MS / 2 - 1);
    expect(before.closed).toBe(0);
    const after = track.weights(1000 + 120 + BLEND_MS / 2 + 1);
    expect(after.openWide).toBe(0);
  });

  it("returns to rest within 100 ms of the last span", () => {
    const { track } = line();
    expect(track.weights(1000 + 360 + 100).rest).toBe(1);
    expect(track.weights(1000 + 360 + BLEND_MS / 2).rest).toBe(1);
  });

  it("holds visemes until their utterance's audio start is known", () => {
    const track = createVisemeTrack();
    track.addViseme("u2", "oh", 0, 200);
    expect(track.weights(50).rest).toBe(1);
    track.startUtterance("u2", 5000, 200);
    expect(dominant(track.weights(5100))).toBe("round");
  });

  it("reports speech: silent, with visemes, or unmarked (no visemes)", () => {
    const track = createVisemeTrack();
    track.startUtterance("a", 0, 500);
    expect(track.speech(100)).toBe("unmarked");
    track.addViseme("a", "aa", 0, 100);
    expect(track.speech(100)).toBe("visemes");
    expect(track.speech(600)).toBe("silent");
  });

  it("ignores empty or inverted spans", () => {
    const track = createVisemeTrack();
    track.addViseme("a", "aa", 100, 100);
    track.addViseme("a", "aa", 200, 150);
    track.startUtterance("a", 0, 500);
    expect(track.weights(120).rest).toBe(1);
    expect(spanWeight({ startMs: 5, endMs: 5 }, 5)).toBe(0);
  });

  it("blends shape params linearly and falls back to rest on no weight", () => {
    expect(blendParams({}).open).toBe(0);
    const half = blendParams({ rest: 0.5, openWide: 0.5 });
    expect(half.open).toBeCloseTo(0.5, 9);
    expect(half.jaw).toBeCloseTo(0.45, 9);
  });
});
