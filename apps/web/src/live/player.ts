// The out stream's player (spec flashhead-live, task 3.2): audio chunks are scheduled on a WebAudio
// clock at `pts + playoutDelay`, JPEG frames are decoded (createImageBitmap) and drawn on a canvas
// when their pts comes up on the same clock. Late frames are dropped; audio is never stretched, so
// it never drifts: a late chunk starts now with its late part skipped. Without audio (the control
// page's preview) or while the browser holds the AudioContext suspended, the wall clock runs
// the frames and the playhead carries over when the audio clock takes over.
// Round 2: a matted frame (0x04) decodes its colour and alpha JPEGs side by side and is drawn
// through the compositor (composite.ts); `flush()` (the server's stop marker, or the control
// page's own Stop) drops every scheduled audio chunk and every queued or decoding frame.
import { audioStart, insertByPts, pickFrame, StreamClock, DEFAULT_DELAY_MS, FRAME_MS } from "./clock";
import { createCompositor, type CompositeKind, type Compositor } from "./composite";
import type { AudioChunk, VideoFrame } from "./protocol";

export interface PlayerStats {
  /** Frames drawn. */
  drawn: number;
  /** Frames dropped (late on arrival or skipped over). */
  dropped: number;
  /** Audio chunks scheduled (and of those, started late). */
  chunks: number;
  lateChunks: number;
  width: number;
  height: number;
  /** Flushes done (stop marker or local Stop). */
  flushes: number;
  /** How far ahead (ms) the scheduled audio runs past the audio clock now; 0 when nothing is scheduled. */
  audioAheadMs: number;
  /** Main-thread time to put one frame on the canvas (composite included), ms, over the last frames. */
  drawP50: number;
  drawP95: number;
  /** Decode time of one frame (both JPEGs for a matted one, in parallel, off the main thread), ms. */
  decodeP95: number;
  /** How the last matted frame was composited; undefined before the first one. */
  composite: CompositeKind | undefined;
}

export interface PlayerEnv {
  decode: (jpeg: Uint8Array) => Promise<ImageBitmap>;
  createContext: () => AudioContext;
  /** The alpha compositor, made on the first matted frame. */
  compositor?: () => Compositor;
  wallNow: () => number;
  request: (cb: () => void) => number;
  cancel: (handle: number) => void;
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  /** Play the audio (the out page) or not (the preview). */
  audio: boolean;
  delayMs?: number;
  env?: PlayerEnv;
  /** The AudioContext is suspended until a click (`true`) or running (`false`). */
  onGesture?: (needed: boolean) => void;
}

export interface Player {
  push(media: VideoFrame | AudioChunk): void;
  /** A new connection: forget the anchor and what is queued. */
  reset(): void;
  /** Stop: drop every scheduled audio chunk and every queued or decoding frame; keep the clock. */
  flush(): void;
  /** From a click: resume the AudioContext. */
  resume(): Promise<void>;
  readonly stats: PlayerStats;
  dispose(): void;
}

export function browserPlayerEnv(): PlayerEnv {
  return {
    decode: (jpeg) => createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" })),
    createContext: () => new AudioContext(),
    compositor: createCompositor,
    wallNow: () => performance.now() / 1000,
    request: (cb) => window.requestAnimationFrame(cb),
    cancel: (handle) => window.cancelAnimationFrame(handle),
  };
}

interface Decoded {
  pts: number;
  bitmap: ImageBitmap;
  alpha?: ImageBitmap;
}

const WINDOW = 120;

/** The last WINDOW samples and their quantiles. */
class Samples {
  private readonly values: number[] = [];
  add(value: number): void {
    this.values.push(value);
    if (this.values.length > WINDOW) this.values.shift();
  }
  quantile(q: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((x, y) => x - y);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  }
}

const release = (item: Decoded) => {
  item.bitmap.close();
  item.alpha?.close();
};

export function createPlayer({ canvas, audio, delayMs = DEFAULT_DELAY_MS, env = browserPlayerEnv(), onGesture }: PlayerOptions): Player {
  const clock = new StreamClock(delayMs);
  const context = audio ? env.createContext() : undefined;
  /** Each scheduled source and the audio-clock time (s) it ends. */
  const sources = new Map<AudioBufferSourceNode, number>();
  const stats = { drawn: 0, dropped: 0, chunks: 0, lateChunks: 0, width: 0, height: 0, flushes: 0 };
  const drawMs = new Samples();
  const decodeMs = new Samples();
  let compositor: Compositor | undefined;
  let queue: Decoded[] = [];
  let generation = 0;
  let onAudioClock = false;
  let frame: number | undefined;
  let disposed = false;
  const ctx2d = canvas.getContext("2d");

  /** The local clock (s): WebAudio's while it runs, else the wall clock; a switch keeps the playhead. */
  const now = (): number => {
    const running = context !== undefined && context.state === "running";
    if (running !== onAudioClock) {
      const before = onAudioClock && context !== undefined ? context.currentTime : env.wallNow();
      onAudioClock = running;
      clock.rebase(before, running && context !== undefined ? context.currentTime : env.wallNow());
    }
    return onAudioClock && context !== undefined ? context.currentTime : env.wallNow();
  };

  const report = () => onGesture?.(context !== undefined && context.state === "suspended");
  if (context !== undefined) {
    context.onstatechange = report;
    report();
  }

  const drop = (items: readonly Decoded[]) => {
    for (const item of items) release(item);
    stats.dropped += items.length;
  };

  const draw = ({ bitmap, alpha }: Decoded) => {
    const started = env.wallNow();
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    stats.width = bitmap.width;
    stats.height = bitmap.height;
    if (ctx2d === null) return;
    if (alpha !== undefined && env.compositor !== undefined) {
      compositor ??= env.compositor();
      compositor.draw(ctx2d, bitmap, alpha);
    } else {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(bitmap, 0, 0);
    }
    drawMs.add((env.wallNow() - started) * 1000);
    stats.drawn += 1;
  };

  const tick = () => {
    frame = undefined;
    if (disposed) return;
    if (clock.anchored) {
      const picked = pickFrame(queue, clock.streamMs(now()));
      drop(picked.stale);
      if (picked.show !== undefined) {
        draw(picked.show);
        release(picked.show);
      }
      queue = picked.rest;
    }
    frame = env.request(tick);
  };
  frame = env.request(tick);

  const observe = (pts: number) => {
    if (clock.observe(pts, now())) {
      // Re-anchored (a restart or a skip): what was queued or is decoding belongs to the old timeline.
      generation += 1;
      drop(queue);
      queue = [];
    }
  };

  /** Both JPEGs of a matted frame decode in parallel; an empty alpha draws the frame opaque. */
  const decodeFrame = async (video: VideoFrame): Promise<Decoded> => {
    const matted = video.alpha !== undefined && video.alpha.byteLength > 0 ? video.alpha : undefined;
    const results = await Promise.allSettled([env.decode(video.jpeg), matted === undefined ? undefined : env.decode(matted)]);
    const [color, alpha] = results.map((r) => (r.status === "fulfilled" ? r.value : undefined));
    if (color === undefined || (matted !== undefined && alpha === undefined)) {
      color?.close();
      alpha?.close();
      throw new Error("decode failed");
    }
    return alpha === undefined ? { pts: video.ptsMs, bitmap: color } : { pts: video.ptsMs, bitmap: color, alpha };
  };

  function pushVideo(video: VideoFrame): void {
    observe(video.ptsMs);
    const mine = generation;
    const started = env.wallNow();
    void decodeFrame(video).then(
      (decoded) => {
        decodeMs.add((env.wallNow() - started) * 1000);
        if (disposed || mine !== generation || video.ptsMs < clock.streamMs(now()) - FRAME_MS) {
          release(decoded);
          stats.dropped += 1;
          return;
        }
        insertByPts(queue, decoded);
      },
      () => {
        stats.dropped += 1;
      },
    );
  }

  function pushAudio(chunk: AudioChunk): void {
    observe(chunk.ptsMs);
    if (context === undefined || context.state !== "running" || chunk.samples.length === 0) return;
    const buffer = context.createBuffer(1, chunk.samples.length, chunk.sampleRate);
    buffer.copyToChannel(new Float32Array(chunk.samples), 0);
    const start = audioStart(clock.playAt(chunk.ptsMs), context.currentTime, buffer.duration);
    if (start === undefined) {
      stats.lateChunks += 1;
      return;
    }
    if (start.offset > 0) stats.lateChunks += 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => sources.delete(source);
    sources.set(source, start.at + buffer.duration - start.offset);
    source.start(start.at, start.offset);
    stats.chunks += 1;
  }

  const silence = () => {
    for (const source of sources.keys()) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    sources.clear();
  };

  return {
    push(media) {
      if (disposed) return;
      if (media.kind === "video") pushVideo(media);
      else pushAudio(media);
    },
    reset() {
      generation += 1;
      clock.reset();
      drop(queue);
      queue = [];
      silence();
    },
    flush() {
      generation += 1;
      drop(queue);
      queue = [];
      silence();
      stats.flushes += 1;
    },
    async resume() {
      if (context === undefined || context.state !== "suspended") return;
      await context.resume().catch(() => undefined);
      report();
    },
    get stats(): PlayerStats {
      const at = context?.currentTime ?? 0;
      const ends = [...sources.values()];
      const ahead = ends.length === 0 ? 0 : Math.max(0, (Math.max(...ends) - at) * 1000);
      const composite = compositor?.kind;
      return { ...stats, audioAheadMs: ahead, drawP50: drawMs.quantile(0.5), drawP95: drawMs.quantile(0.95), decodeP95: decodeMs.quantile(0.95), composite };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) env.cancel(frame);
      for (const item of queue) release(item);
      queue = [];
      silence();
      compositor?.dispose();
      if (context !== undefined) {
        context.onstatechange = null;
        void context.close().catch(() => undefined);
      }
    },
  };
}
