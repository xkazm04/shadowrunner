// L2's pure parts: the mix split between the set's art and L1's fallback drawing, and the
// manifest check the page applies to var/lab/mouths/<character>/manifest.json.
import type { AvatarPlayer } from "@sr/avatar/core";
import { describe, expect, it } from "vitest";
import type { LipContext } from "../../../types.js";
import { createL2, MORPH_REFUSAL, splitMix } from "../../l2.js";
import { readManifest } from "../set.js";
import { restWeights, type MouthShape } from "../shapes.js";

describe("L2 mix split", () => {
  it("normalises the art's shapes and hands the missing ones to L1", () => {
    const w = { ...restWeights(), rest: 0.2, round: 0.5, closed: 0.3 };
    const split = splitMix(w, new Set<MouthShape>(["rest", "round"]));
    expect(split.artShare).toBeCloseTo(0.7, 9);
    expect(split.art[0]?.[0]).toBe("round");
    expect(split.art.reduce((a, [, x]) => a + x, 0)).toBeCloseTo(1, 9);
    expect(split.proceduralShare).toBeCloseTo(0.3, 9);
    expect(split.procedural.closed).toBeCloseTo(0.3, 9);
    expect(split.procedural.round).toBe(0);
  });

  it("is all L1 until the art has loaded", () => {
    const split = splitMix({ ...restWeights(), rest: 0.4, openWide: 0.6 }, new Set());
    expect(split.artShare).toBe(0);
    expect(split.proceduralShare).toBeCloseTo(1, 9);
  });
});

describe("L2 on a morph rig (companion-lanes)", () => {
  it("refuses at creation with a sentence, before it looks for a mouth set", () => {
    const player = { mouthMode: () => "morph" as const } as Partial<AvatarPlayer> as AvatarPlayer;
    const ctx: LipContext = {
      character: "iris",
      player,
      audio: { context: {} as AudioContext, output: {} as GainNode, nowMs: () => 0, level: () => 0 },
      reducedMotion: false,
      addPainter: () => undefined,
    };
    expect(() => createL2(ctx)).toThrow(`Lip arm L2: iris: ${MORPH_REFUSAL}.`);
  });
});

describe("mouth set manifest", () => {
  const good = { character: "the-tallyman", crop: [414, 407, 199, 199], shapes: { rest: "rest.png", round: "round.png" }, source: "placeholder", generatedAt: "2026-11-05T00:00:00.000Z" };

  it("accepts the generator's manifest", () => {
    const m = readManifest(good);
    expect(typeof m).toBe("object");
    expect(typeof m === "object" ? m.shapes.round : undefined).toBe("round.png");
  });

  it("rejects what the page could not place or fetch", () => {
    expect(readManifest({ ...good, crop: [0, 0, 10, 12] })).toBe("crop must be a square");
    expect(readManifest({ ...good, shapes: { smile: "x.png" } })).toBe('unknown shape "smile"');
    expect(readManifest({ ...good, shapes: { rest: "../../etc/x.png" } })).toMatch(/must name a \.png/);
    expect(readManifest({ ...good, source: "dalle" })).toMatch(/source/);
  });

});
