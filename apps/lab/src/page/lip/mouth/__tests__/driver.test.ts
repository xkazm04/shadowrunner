// The shared lip driver body (L1/L2): it never attaches the audio, opens the jaw through setLevel
// per shape, follows the jaw's frame in the head's frame, and its reduced-motion twin eases to one
// soft shape. Geometry and colour derivations are pure and checked here too.
import type { AvatarPlayer, LayerFrame } from "@sr/avatar/core";
import { JAW_FLOOR } from "@sr/avatar/core";
import type { Layer } from "@sr/rig";
import { describe, expect, it, vi } from "vitest";
import type { LipContext, ScenePainter } from "../../../types.js";
import { deriveColours } from "../colours.js";
import { coverOf, createMouthDriver, jawLevel, levelWeights, type MouthFrame } from "../driver.js";
import { apply, invertAffine, mouthAnchor } from "../anchor.js";
import { mouthGeometry } from "../geometry.js";
import { restWeights } from "../shapes.js";

const head: Layer = { name: "head", z: 3, kind: "head", file: "head.png", bbox: [332, 1, 360, 642], anchor: [512, 634] };
const jaw: Layer = { name: "jaw", z: 4, kind: "jaw", file: "jaw.png", bbox: [448, 493, 130, 22], anchor: [513, 492], follow: "head", drop: 0.014 };

/** Head translated by (tx, ty) and scaled by k; the jaw the same plus `drop` rig px down. */
function frames(tx: number, ty: number, k: number, drop: number): LayerFrame[] {
  return [
    { layer: head, affine: [k, 0, 0, k, tx, ty], opacity: 1 },
    { layer: jaw, affine: [k, 0, 0, k, tx, ty + k * drop], opacity: 1 },
  ];
}

function fakeContext(f: () => LayerFrame[], reducedMotion = false) {
  const painters: ScenePainter[] = [];
  const levels: (number | undefined)[] = [];
  const player = {
    attachAudio: vi.fn(),
    setLevel: (l: number | undefined) => levels.push(l),
    layerFrames: f,
  } as Partial<AvatarPlayer> as AvatarPlayer;
  let clock = 0;
  const ctx: LipContext = {
    character: "the-tallyman",
    player,
    audio: { context: {} as AudioContext, output: {} as GainNode, nowMs: () => clock, level: () => 0.5 },
    reducedMotion,
    addPainter: (p) => painters.push(p),
  };
  const g = {
    canvas: { width: 1920, height: 1080 },
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : 128)) }),
  } as Partial<CanvasRenderingContext2D> as CanvasRenderingContext2D;
  return { ctx, painters, levels, player, g, setClock: (t: number) => (clock = t) };
}

describe("mouth geometry", () => {
  it("puts the mouth on the jaw's top edge, capped by the head's width", () => {
    const m = mouthGeometry(jaw, head);
    expect(m.cx).toBe(513);
    expect(m.lineY).toBe(493);
    expect(m.width).toBeCloseTo(130 * 0.85, 9);
    const skull = mouthGeometry({ bbox: [0, 0, 400, 100] }, { bbox: [0, 0, 400, 400] });
    expect(skull.width).toBeCloseTo(400 * 0.32, 9);
    expect(m.crop[2]).toBe(m.crop[3]);
    expect(m.crop.every(Number.isInteger)).toBe(true);
  });

  it("inverts affines", () => {
    const m = [1.2, 0.3, -0.3, 1.2, 40, -7] as const;
    const inv = invertAffine([...m]);
    expect(inv).toBeDefined();
    const [x, y] = apply(inv ?? [1, 0, 0, 1, 0, 0], ...apply([...m], 10, 20));
    expect(x).toBeCloseTo(10, 9);
    expect(y).toBeCloseTo(20, 9);
    expect(invertAffine([0, 0, 0, 0, 1, 1])).toBeUndefined();
  });

  it("anchors in the head's frame and measures the jaw's drop there", () => {
    const a = mouthAnchor(frames(100, 50, 1.5, 9));
    expect(a?.affine).toEqual([1.5, 0, 0, 1.5, 100, 50]);
    expect(a?.gap).toBeCloseTo(9, 9);
    expect(mouthAnchor([{ layer: head, affine: [1, 0, 0, 1, 0, 0], opacity: 1 }])).toBeUndefined();
  });
});

describe("mouth colours", () => {
  it("derives darker lips, a dark inside and bright teeth from the skin", () => {
    const c = deriveColours([120, 120, 120], [100, 100, 100]);
    expect(c.lip[0]).toBeLessThan(110);
    expect(c.inner[0]).toBeLessThan(20);
    expect(c.teeth[0]).toBeGreaterThan(180);
    expect(c.teeth[0]).toBeLessThanOrEqual(255);
  });
});

describe("mouth driver", () => {
  it("never attaches the audio, opens the jaw per shape and closes it in silence", () => {
    const { ctx, levels, player } = fakeContext(() => frames(0, 0, 1, 0));
    const d = createMouthDriver("L1", ctx, () => undefined);
    expect(player.attachAudio).toHaveBeenCalledWith(undefined);
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "aa", startMs: 0, endMs: 300 });
    d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 400 }, 1000);
    d.frame(1150);
    expect(levels.at(-1)).toBeCloseTo(jawLevel(0.9), 9);
    d.frame(2000);
    expect(levels.at(-1)).toBe(0);
    d.dispose();
    expect(levels.at(-1)).toBeUndefined();
  });

  it("paints the mix it scheduled, in the head's frame, after sampling the art", () => {
    const { ctx, painters, g } = fakeContext(() => frames(10, 20, 1, 4));
    const seen: MouthFrame[] = [];
    const d = createMouthDriver("L1", ctx, (_g, f) => seen.push(f));
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "oh", startMs: 0, endMs: 300 });
    d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 300 }, 0);
    d.frame(150);
    for (const p of painters) p(g, 150);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.weights.round).toBeCloseTo(1, 6);
    expect(seen[0]?.alpha).toBe(1);
    expect(seen[0]?.anchor.affine[4]).toBe(10);
    expect(seen[0]?.anchor.gap).toBeCloseTo(4, 9);
    expect(seen[0]?.colours.skinTop).toEqual([128, 128, 128]);
  });

  it("falls back to the speech level for a line without visemes", () => {
    const { ctx, levels } = fakeContext(() => frames(0, 0, 1, 0));
    const d = createMouthDriver("L1", ctx, () => undefined);
    d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 500 }, 0);
    d.frame(100);
    const expected = levelWeights(0.5);
    expect(expected.openMid).toBeGreaterThan(0.9);
    expect(levels.at(-1)).toBeGreaterThan(JAW_FLOOR);
  });

  it("reduced motion: one soft shape eased in while speaking, no articulation", () => {
    const { ctx, painters, g } = fakeContext(() => frames(0, 0, 1, 0), true);
    const seen: MouthFrame[] = [];
    const d = createMouthDriver("L1", ctx, (_g, f) => seen.push(f));
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "aa", startMs: 0, endMs: 900 });
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "PP", startMs: 900, endMs: 1000 });
    d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 1000 }, 0);
    for (let t = 0; t <= 960; t += 16) {
      d.frame(t);
      for (const p of painters) p(g, t);
    }
    const last = seen.at(-1);
    expect(last?.weights.openWide).toBe(0);
    expect(last?.weights.closed).toBe(0);
    expect(last?.weights.openMid).toBeGreaterThan(0.45);
    expect(seen[1]?.weights.openMid).toBeLessThan(0.1);
  });

  it("covers the art fully once rest is half gone", () => {
    expect(coverOf(restWeights())).toBe(0);
    expect(coverOf({ ...restWeights(), rest: 0.5, openMid: 0.5 })).toBe(1);
  });
});
