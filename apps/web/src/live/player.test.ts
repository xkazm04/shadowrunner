// The player's round-2 rules with every browser piece faked: a matted frame is decoded as two
// JPEGs and drawn through the compositor, and `flush()` stops every scheduled audio source and
// drops every queued or still-decoding frame while the clock keeps running.
import { describe, expect, it, vi } from "vitest";
import type { Compositor } from "./composite";
import { createPlayer, type PlayerEnv } from "./player";
import type { AudioChunk, VideoFrame } from "./protocol";

interface FakeBitmap {
  width: number;
  height: number;
  tag: number;
  closed: boolean;
  close(): void;
}

function harness() {
  const ctx2d = { clearRect: vi.fn(), drawImage: vi.fn(), canvas: { width: 0, height: 0 } };
  const canvas = { width: 0, height: 0, getContext: () => ctx2d } as object as HTMLCanvasElement;
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = [];
  const audio = {
    state: "running",
    currentTime: 0,
    destination: {},
    onstatechange: null,
    createBuffer: (_channels: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: () => undefined }),
    createBufferSource: () => {
      const source = { buffer: null, connect: () => undefined, start: vi.fn(), stop: vi.fn(), onended: null };
      sources.push(source);
      return source;
    },
    close: () => Promise.resolve(),
  };
  const bitmaps: FakeBitmap[] = [];
  const draws: [number, number][] = [];
  const compositor: Compositor = { kind: "webgl", draw: (_ctx, color, alpha) => draws.push([(color as object as FakeBitmap).tag, (alpha as object as FakeBitmap).tag]), dispose: () => undefined };
  let tick: (() => void) | undefined;
  const env: PlayerEnv = {
    decode: (jpeg) => {
      const bitmap: FakeBitmap = { width: 1024, height: 1024, tag: jpeg[0] ?? -1, closed: false, close: () => (bitmap.closed = true) };
      bitmaps.push(bitmap);
      return Promise.resolve(bitmap as object as ImageBitmap);
    },
    createContext: () => audio as object as AudioContext,
    compositor: () => compositor,
    wallNow: () => audio.currentTime,
    request: (cb) => {
      tick = cb;
      return 1;
    },
    cancel: () => undefined,
  };
  const player = createPlayer({ canvas, audio: true, delayMs: 250, env });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { player, audio, sources, bitmaps, draws, ctx2d, settle, step: () => tick?.() };
}

const matted = (ptsMs: number, colour: number, alpha: number): VideoFrame => ({
  kind: "video",
  ptsMs,
  width: 1024,
  height: 1024,
  jpeg: new Uint8Array([colour]),
  alpha: new Uint8Array([alpha]),
});
const tone = (ptsMs: number, seconds: number): AudioChunk => ({ kind: "audio", ptsMs, sampleRate: 24000, samples: new Float32Array(24000 * seconds) });

describe("player, matted frames", () => {
  it("decodes both JPEGs and draws them through the compositor", async () => {
    const h = harness();
    h.player.push(matted(0, 7, 9));
    await h.settle();
    h.audio.currentTime = 0.3; // playhead 50 ms: frame 0 is due
    h.step();
    expect(h.draws).toEqual([[7, 9]]);
    expect(h.ctx2d.drawImage).not.toHaveBeenCalled();
    expect(h.bitmaps.every((b) => b.closed)).toBe(true);
    expect(h.player.stats).toMatchObject({ drawn: 1, width: 1024, height: 1024, composite: "webgl" });
  });

  it("draws a frame with an empty alpha opaque, without the compositor", async () => {
    const h = harness();
    h.player.push({ ...matted(0, 7, 9), alpha: new Uint8Array(0) });
    await h.settle();
    h.audio.currentTime = 0.3;
    h.step();
    expect(h.draws).toEqual([]);
    expect(h.ctx2d.drawImage).toHaveBeenCalledTimes(1);
    expect(h.player.stats.composite).toBeUndefined();
  });
});

describe("player, flush", () => {
  it("stops every scheduled audio chunk and drops queued and decoding frames, keeping the clock", async () => {
    const h = harness();
    h.player.push(tone(0, 1));
    h.player.push(matted(400, 1, 2));
    await h.settle();
    expect(h.player.stats.audioAheadMs).toBeCloseTo(1250);
    h.player.push(matted(440, 3, 4)); // still decoding when the flush lands
    h.player.flush();
    await h.settle();
    expect(h.sources[0]?.stop).toHaveBeenCalledTimes(1);
    expect(h.player.stats).toMatchObject({ audioAheadMs: 0, flushes: 1, dropped: 2 });
    expect(h.bitmaps.every((b) => b.closed)).toBe(true);
    h.audio.currentTime = 1;
    h.step();
    expect(h.draws).toEqual([]);

    // The clock was kept: what comes after the flush plays on the same timeline.
    h.player.push(matted(800, 5, 6));
    await h.settle();
    h.audio.currentTime = 1.1;
    h.step();
    expect(h.draws).toEqual([[5, 6]]);
  });
});
