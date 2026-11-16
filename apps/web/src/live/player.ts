// The out stream's player (spec flashhead-live, task 3.2): audio chunks are scheduled on a WebAudio
// clock at `pts + playoutDelay`, JPEG frames are decoded (createImageBitmap) and drawn on a canvas
// when their pts comes up on the same clock. Late frames are dropped; audio is never stretched, so
// it never drifts: a late chunk starts now with its late part skipped. Without audio (the control
// page's preview) or while the browser holds the AudioContext suspended, the wall clock runs
// the frames and the playhead carries over when the audio clock takes over.
import { audioStart, insertByPts, pickFrame, StreamClock, DEFAULT_DELAY_MS, FRAME_MS } from "./clock";
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
}

export interface PlayerEnv {
  decode: (jpeg: Uint8Array) => Promise<ImageBitmap>;
  createContext: () => AudioContext;
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
  /** From a click: resume the AudioContext. */
  resume(): Promise<void>;
  readonly stats: PlayerStats;
  dispose(): void;
}

export function browserPlayerEnv(): PlayerEnv {
  return {
    decode: (jpeg) => createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" })),
    createContext: () => new AudioContext(),
    wallNow: () => performance.now() / 1000,
    request: (cb) => window.requestAnimationFrame(cb),
    cancel: (handle) => window.cancelAnimationFrame(handle),
  };
}

interface Decoded {
  pts: number;
  bitmap: ImageBitmap;
}

export function createPlayer({ canvas, audio, delayMs = DEFAULT_DELAY_MS, env = browserPlayerEnv(), onGesture }: PlayerOptions): Player {
  const clock = new StreamClock(delayMs);
  const context = audio ? env.createContext() : undefined;
  const sources = new Set<AudioBufferSourceNode>();
  const stats: PlayerStats = { drawn: 0, dropped: 0, chunks: 0, lateChunks: 0, width: 0, height: 0 };
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
    for (const item of items) item.bitmap.close();
    stats.dropped += items.length;
  };

  const draw = (bitmap: ImageBitmap) => {
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    stats.width = bitmap.width;
    stats.height = bitmap.height;
    ctx2d?.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d?.drawImage(bitmap, 0, 0);
    stats.drawn += 1;
  };

  const tick = () => {
    frame = undefined;
    if (disposed) return;
    if (clock.anchored) {
      const picked = pickFrame(queue, clock.streamMs(now()));
      drop(picked.stale);
      if (picked.show !== undefined) {
        draw(picked.show.bitmap);
        picked.show.bitmap.close();
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

  function pushVideo(video: VideoFrame): void {
    observe(video.ptsMs);
    const mine = generation;
    void env.decode(video.jpeg).then(
      (bitmap) => {
        if (disposed || mine !== generation || video.ptsMs < clock.streamMs(now()) - FRAME_MS) {
          bitmap.close();
          stats.dropped += 1;
          return;
        }
        insertByPts(queue, { pts: video.ptsMs, bitmap });
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
    sources.add(source);
    source.start(start.at, start.offset);
    stats.chunks += 1;
  }

  const silence = () => {
    for (const source of sources) {
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
    async resume() {
      if (context === undefined || context.state !== "suspended") return;
      await context.resume().catch(() => undefined);
      report();
    },
    get stats() {
      return { ...stats };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) env.cancel(frame);
      for (const item of queue) item.bitmap.close();
      queue = [];
      silence();
      if (context !== undefined) {
        context.onstatechange = null;
        void context.close().catch(() => undefined);
      }
    },
  };
}
