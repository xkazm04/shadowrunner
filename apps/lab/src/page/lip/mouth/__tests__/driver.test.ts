// The shared lip driver body (L1/L2): it never attaches the audio, hands the player the scheduled
// shape mix (at the frame's time, the jaw's a little ahead), falls back to the speech level without
// visemes, eases to one soft shape under reduced motion, and on a rig without Rig.mouth moves only
// the jaw; a warp rig takes shapes, a "still" rig only the jaw. The player draws the mouth (@sr/avatar, tested there); the painter seam is L2's.
import type { AvatarPlayer, LayerFrame, MouthMode, MouthPose, MouthShapesInput, ShapeWeights } from "@sr/avatar/core";
import { blendParams, jawLevel, restWeights, SHAPE_PARAMS } from "@sr/avatar/core";
import type { Layer, RigMouth } from "@sr/rig";
import { describe, expect, it, vi } from "vitest";
import type { LipContext, ScenePainter } from "../../../types.js";
import { apply, invertAffine, mouthAnchor } from "../anchor.js";
import { createMouthDriver, type MouthFrame } from "../driver.js";
import { mouthGeometry, OPEN_OF_WIDTH } from "../geometry.js";

const head: Layer = { name: "head", z: 3, kind: "head", file: "head.png", bbox: [332, 1, 360, 642], anchor: [512, 634] };
const jaw: Layer = { name: "jaw", z: 4, kind: "jaw", file: "jaw.png", bbox: [448, 493, 130, 22], anchor: [513, 492], follow: "head", drop: 0.014 };
const measured: RigMouth = { cx: 520, lineY: 505, width: 70 };

/** Head translated by (tx, ty) and scaled by k; the jaw the same plus `drop` rig px down. */
function frames(tx: number, ty: number, k: number, drop: number): LayerFrame[] {
  return [
    { layer: head, affine: [k, 0, 0, k, tx, ty], opacity: 1 },
    { layer: jaw, affine: [k, 0, 0, k, tx, ty + k * drop], opacity: 1 },
  ];
}

function harness(o: { reducedMotion?: boolean; mouth?: RigMouth | null; level?: number; frames?: () => LayerFrame[]; mode?: MouthMode } = {}) {
  const painters: ScenePainter[] = [];
  const levels: (number | undefined)[] = [];
  const shapes: ({ shapes: ShapeWeights; options?: Omit<MouthShapesInput, "shapes"> } | undefined)[] = [];
  let pose: MouthPose | undefined;
  const player = {
    attachAudio: vi.fn(),
    setLevel: (l: number | undefined) => levels.push(l),
    setMouthShapes: (s: ShapeWeights | undefined, options?: Omit<MouthShapesInput, "shapes">) => shapes.push(s === undefined ? undefined : { shapes: s, ...(options === undefined ? {} : { options }) }),
    mouth: () => pose,
    layerFrames: o.frames ?? (() => frames(0, 0, 1, 0)),
    ...(o.mode === undefined ? {} : { mouthMode: () => o.mode }),
  } as Partial<AvatarPlayer> as AvatarPlayer;
  const mouth = o.mouth === null ? undefined : (o.mouth ?? measured);
  const ctx: LipContext = {
    character: "the-tallyman",
    ...(mouth === undefined ? {} : { mouth }),
    player,
    audio: { context: {} as AudioContext, output: {} as GainNode, nowMs: () => 0, level: () => o.level ?? 0.5 },
    reducedMotion: o.reducedMotion ?? false,
    addPainter: (p) => painters.push(p),
  };
  const setPose = (p: MouthPose | undefined): void => {
    pose = p;
  };
  return { ctx, painters, levels, shapes, player, setPose };
}

const speak = (d: ReturnType<typeof createMouthDriver>, v: "aa" | "oh" | "PP", durationMs = 400, startMs = 1000): void => {
  d.onViseme({ t: 0, kind: "viseme", id: "u", v, startMs: 0, endMs: durationMs - 100 });
  d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs }, startMs);
};

describe("mouth geometry (L2's crop, the lab's anchor)", () => {
  it("puts the mouth on the jaw's top edge, capped by the head's width", () => {
    const m = mouthGeometry(jaw, head);
    expect(m.cx).toBe(513);
    expect(m.lineY).toBe(493);
    expect(m.width).toBeCloseTo(130 * 0.85, 9);
    expect(mouthGeometry({ bbox: [0, 0, 400, 100] }, { bbox: [0, 0, 400, 400] }).width).toBeCloseTo(400 * 0.32, 9);
    expect(m.crop[2]).toBe(m.crop[3]);
    expect(m.crop.every(Number.isInteger)).toBe(true);
  });

  it("anchors in the head's frame on the measured mouth and measures the jaw's drop there", () => {
    const a = mouthAnchor(frames(100, 50, 1.5, 9), measured);
    expect(a?.affine).toEqual([1.5, 0, 0, 1.5, 100, 50]);
    expect(a?.gap).toBeCloseTo(9, 9);
    expect(a?.geometry.cx).toBe(520);
    expect(a?.geometry.maxOpen).toBeCloseTo(70 * OPEN_OF_WIDTH, 9);
    expect(mouthAnchor([{ layer: head, affine: [1, 0, 0, 1, 0, 0], opacity: 1 }])).toBeUndefined();
    const inv = invertAffine([1.2, 0.3, -0.3, 1.2, 40, -7]);
    expect(apply(inv ?? [1, 0, 0, 1, 0, 0], ...apply([1.2, 0.3, -0.3, 1.2, 40, -7], 10, 20))[0]).toBeCloseTo(10, 9);
  });
});

describe("mouth driver", () => {
  it("never attaches the audio; hands the player each shape and its jaw mix, rest in silence", () => {
    const h = harness();
    const d = createMouthDriver("L1", h.ctx);
    expect(h.player.attachAudio).toHaveBeenCalledWith(undefined);
    speak(d, "aa");
    d.frame(1150);
    expect(h.shapes.at(-1)?.shapes.openWide).toBeCloseTo(1, 6);
    expect(h.shapes.at(-1)?.options?.jaw?.openWide).toBeCloseTo(1, 6);
    expect(h.levels).toHaveLength(0);
    d.frame(2000);
    expect(h.shapes.at(-1)?.shapes).toEqual(restWeights());
    d.dispose();
    expect(h.shapes.at(-1)).toBeUndefined();
    expect(h.levels.at(-1)).toBeUndefined();
  });

  it("reads the mix at the frame's time (drawn in the same frame) and the jaw JAW_LEAD_MS ahead", () => {
    const h = harness();
    const d = createMouthDriver("L1", h.ctx);
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "PP", startMs: 0, endMs: 100 });
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "aa", startMs: 100, endMs: 400 });
    d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 500 }, 0);
    d.frame(20);
    d.frame(40);
    const ahead = h.shapes.at(-1);
    expect(ahead?.shapes.closed).toBeGreaterThan(0.5);
    d.frame(250);
    expect(h.shapes.at(-1)?.shapes.openWide).toBeCloseTo(1, 6);
    // The jaw mix is read JAW_LEAD_MS further ahead, so it is at least as open as the shown one.
    expect(blendParams(ahead?.options?.jaw ?? restWeights()).jaw).toBeGreaterThanOrEqual(blendParams(ahead?.shapes ?? restWeights()).jaw);
  });

  it("falls back to the speech level for a line without visemes", () => {
    const h = harness({ level: 0.5 });
    const d = createMouthDriver("L1", h.ctx);
    d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 500 }, 0);
    d.frame(100);
    expect(h.shapes.at(-1)?.shapes.openMid).toBeGreaterThan(0.9);
  });

  it("reduced motion: one soft shape eased in while speaking, no articulation", () => {
    const h = harness({ reducedMotion: true });
    const d = createMouthDriver("L1", h.ctx);
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "aa", startMs: 0, endMs: 900 });
    d.onViseme({ t: 0, kind: "viseme", id: "u", v: "PP", startMs: 900, endMs: 1000 });
    d.onAudio({ t: 0, kind: "audio", id: "u", sampleRate: 24000, pcmRef: "audio/u.wav", durationMs: 1000 }, 0);
    for (let t = 0; t <= 960; t += 16) d.frame(t);
    const last = h.shapes.at(-1)?.shapes;
    expect(last?.openWide).toBe(0);
    expect(last?.closed).toBe(0);
    expect(last?.openMid).toBeGreaterThan(0.45);
    expect(h.shapes[1]?.shapes.openMid).toBeLessThan(0.1);
  });

  it("a rig without Rig.mouth draws no mouth: only the jaw opens, per shape, through setLevel", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = harness({ mouth: null });
    const d = createMouthDriver("L1", h.ctx);
    expect(warn).toHaveBeenCalledOnce();
    speak(d, "aa");
    d.frame(1150);
    expect(h.shapes).toHaveLength(0);
    expect(h.levels.at(-1)).toBeCloseTo(jawLevel(SHAPE_PARAMS.openWide.jaw), 9);
    d.frame(2000);
    expect(h.levels.at(-1)).toBe(0);
    warn.mockRestore();
  });

  it("a painter (L2) gets the mix the player drew, the player's alpha and the head's frame", () => {
    const h = harness({ frames: () => frames(10, 20, 1, 4) });
    const seen: MouthFrame[] = [];
    const d = createMouthDriver("L2", h.ctx, { paint: (_g, f) => seen.push(f), drawn: (w) => ({ ...w, round: 0 }) });
    speak(d, "oh", 300, 0);
    d.frame(130);
    d.frame(150);
    h.setPose({ params: SHAPE_PARAMS.round, alpha: 1, lips: 1 });
    const g = {} as CanvasRenderingContext2D;
    for (const p of h.painters) p(g, 150);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.weights).toBe(h.shapes.at(-1)?.shapes);
    expect(seen[0]?.weights.round).toBeCloseTo(1, 6);
    expect(seen[0]?.alpha).toBe(1);
    expect(seen[0]?.anchor.affine[4]).toBe(10);
    expect(seen[0]?.anchor.gap).toBeCloseTo(4, 9);
    expect(h.shapes.at(-1)?.options?.drawn?.round).toBe(0);
  });
  it("a warp rig takes the shapes; a \"still\" rig moves only the jaw", () => {
    const w = harness({ mode: "warp" });
    const dw = createMouthDriver("L1", w.ctx);
    speak(dw, "aa");
    dw.frame(1150);
    expect(w.shapes.at(-1)?.shapes.openWide).toBeCloseTo(1, 6);
    expect(w.levels).toHaveLength(0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const s = harness({ mode: "still" });
    const ds = createMouthDriver("L1", s.ctx);
    expect(warn).toHaveBeenCalledOnce();
    speak(ds, "aa");
    ds.frame(1150);
    expect(s.shapes).toHaveLength(0);
    expect(s.levels.at(-1)).toBeCloseTo(jawLevel(SHAPE_PARAMS.openWide.jaw), 9);
    warn.mockRestore();
  });
});
