// Studio recorder (spec avatar-reach, design "Testing", studio row): canRecord branches, the type
// preference, and the record pipeline with a fake MediaRecorder, audio graph and canvas.
import { describe, expect, it, vi } from "vitest";
import {
  canRecord,
  FPS,
  NO_CANVAS,
  pickMimeType,
  playLine,
  RECORD_FAILED,
  RECORD_TYPES,
  recordLine,
  type CaptureCanvas,
  type LineContext,
  type MediaRecorderLike,
  type RecordJob,
} from "./recorder";

describe("canRecord", () => {
  const recorder = (types: readonly string[]) => Object.assign(function MediaRecorder() {}, { isTypeSupported: (t: string) => types.includes(t) });
  const canvas = (capture: boolean) => ({ prototype: capture ? { captureStream() {} } : {} });

  it("needs MediaRecorder, canvas captureStream and a WebM type", () => {
    expect(canRecord({ MediaRecorder: recorder(["video/webm"]), HTMLCanvasElement: canvas(true) })).toBe(true);
    expect(canRecord({ HTMLCanvasElement: canvas(true) })).toBe(false);
    expect(canRecord({ MediaRecorder: recorder(["video/webm"]), HTMLCanvasElement: canvas(false) })).toBe(false);
    expect(canRecord({ MediaRecorder: recorder(["video/mp4"]), HTMLCanvasElement: canvas(true) })).toBe(false);
    expect(canRecord({ MediaRecorder: {}, HTMLCanvasElement: canvas(true) })).toBe(false);
    expect(canRecord(undefined)).toBe(false);
  });

  it("prefers vp9, then vp8, then plain WebM", () => {
    expect(pickMimeType(() => true)).toBe(RECORD_TYPES[0]);
    expect(pickMimeType((t) => t !== RECORD_TYPES[0])).toBe("video/webm;codecs=vp8,opus");
    expect(pickMimeType((t) => t === "video/webm")).toBe("video/webm");
    expect(pickMimeType(() => false)).toBeUndefined();
    expect(
      pickMimeType(() => {
        throw new Error("no");
      }),
    ).toBeUndefined();
  });
});

interface FakeSource {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  connected: unknown[];
  connect(node: unknown): void;
  start(): void;
  stop(): void;
}

function fakeGraph() {
  const sources: FakeSource[] = [];
  const audioTrack = { kind: "audio", stop: vi.fn() };
  const destination = { stream: { getAudioTracks: () => [audioTrack] } };
  const context = {
    destination: { name: "speakers" },
    createBufferSource() {
      const source: FakeSource = {
        buffer: null,
        onended: null,
        connected: [],
        connect(node) {
          source.connected.push(node);
        },
        start: vi.fn(),
        stop() {
          source.onended?.();
        },
      };
      sources.push(source);
      return source;
    },
    createMediaStreamDestination: () => destination,
  };
  return { context: context as object as LineContext, sources, destination, audioTrack };
}

function fakePlayer() {
  return { attachAudio: vi.fn(), renderFrame: vi.fn(), start: vi.fn(), stop: vi.fn() };
}

function fakeRecorderClass(log: string[]) {
  const made: FakeRecorder[] = [];
  class FakeRecorder implements MediaRecorderLike {
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: ((event: Event) => void) | null = null;
    onerror: ((event: never) => void) | null = null;
    state = "inactive";
    readonly options: MediaRecorderOptions | undefined;
    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
      this.options = options;
      made.push(this);
    }
    static isTypeSupported = () => true;
    start(): void {
      log.push("start");
      this.state = "recording";
    }
    stop(): void {
      log.push("stop");
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["frames"], { type: "video/webm" }) } as BlobEvent);
      this.onstop?.(new Event("stop"));
    }
  }
  return { Recorder: FakeRecorder, made };
}

function fakeCanvas(log: string[], context = true) {
  const videoTrack = { kind: "video", stop: vi.fn() };
  const tracks: unknown[] = [videoTrack];
  const g = {
    fillStyle: "",
    fillRect: () => log.push(`fill ${g.fillStyle}`),
    drawImage: () => log.push("draw"),
  };
  const target = {
    width: 0,
    height: 0,
    getContext: () => (context ? g : null),
    captureStream: vi.fn(() => ({ addTrack: (t: unknown) => tracks.push(t), getTracks: () => tracks })),
  };
  return { target: target as object as CaptureCanvas & { captureStream: ReturnType<typeof vi.fn> }, tracks, videoTrack };
}

function frames() {
  let pending: ((now: number) => void) | undefined;
  let now = 0;
  return {
    request: (cb: (now: number) => void) => {
      pending = cb;
      return 1;
    },
    cancel: vi.fn(() => {
      pending = undefined;
    }),
    /** Runs one frame `ms` later. */
    step(ms: number) {
      now += ms;
      const cb = pending;
      pending = undefined;
      cb?.(now);
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function job(overrides: Partial<RecordJob> = {}) {
  const log: string[] = [];
  const graph = fakeGraph();
  const player = fakePlayer();
  const canvas = fakeCanvas(log);
  const rec = fakeRecorderClass(log);
  const clock = frames();
  const progress: number[] = [];
  const waits: number[] = [];
  const full: RecordJob = {
    context: graph.context,
    buffer: { duration: 2 } as AudioBuffer,
    player,
    source: { width: 641, height: 480 } as object as RecordJob["source"],
    target: canvas.target,
    background: "#102030",
    Recorder: rec.Recorder,
    mimeType: "video/webm;codecs=vp9,opus",
    frames: clock,
    wait: (ms) => {
      waits.push(ms);
    },
    onProgress: (p) => progress.push(p),
    ...overrides,
  };
  return { full, log, graph, player, canvas, rec, clock, progress, waits };
}

describe("playLine", () => {
  it("plays to the speakers with the mouth on the same node, and lets go when it ends", async () => {
    const graph = fakeGraph();
    const player = fakePlayer();
    const playback = playLine(graph.context, { duration: 1 } as AudioBuffer, player);
    const source = graph.sources[0];
    expect(source?.connected).toEqual([graph.context.destination]);
    expect(player.attachAudio).toHaveBeenCalledWith(source);
    expect(source?.start).toHaveBeenCalled();
    playback.stop();
    await playback.ended;
    expect(player.attachAudio).toHaveBeenLastCalledWith(undefined);
  });
});

describe("recordLine", () => {
  it("composites background + character, records video and audio, stops after the tail", async () => {
    const t = job();
    const result = recordLine(t.full);
    expect(t.canvas.target.width).toBe(640);
    expect(t.canvas.target.height).toBe(480);
    expect(t.canvas.target.captureStream).toHaveBeenCalledWith(FPS);
    expect(t.canvas.tracks).toContain(t.graph.audioTrack);
    expect(t.rec.made[0]?.options).toEqual({ mimeType: "video/webm;codecs=vp9,opus" });
    expect(t.player.stop).toHaveBeenCalled();
    expect(t.log.slice(0, 3)).toEqual(["fill #102030", "draw", "start"]);
    expect(t.graph.sources[0]?.connected).toEqual([t.graph.context.destination, t.graph.destination]);

    t.clock.step(0);
    t.clock.step(1250);
    expect(t.player.renderFrame).toHaveBeenLastCalledWith(1.25);
    expect(t.progress.at(-1)).toBeCloseTo(1.25 / 2.5);

    t.graph.sources[0]?.onended?.();
    await flush();
    const blob = await result;
    expect(t.waits).toEqual([500]);
    expect(t.progress.at(-1)).toBe(1);
    expect(blob.type).toBe("video/webm");
    expect(await blob.text()).toBe("frames");
    expect(t.log.at(-1)).toBe("stop");
    expect(t.canvas.videoTrack.stop).toHaveBeenCalled();
    expect(t.player.start).toHaveBeenCalled();
    expect(t.player.attachAudio).toHaveBeenLastCalledWith(undefined);
  });

  it("with a mouth track, sets each frame's shapes just before its renderFrame, and clears them at the end", async () => {
    const order: string[] = [];
    const player = {
      ...fakePlayer(),
      renderFrame: vi.fn(() => order.push("render")),
      setMouthShapes: vi.fn((shapes: unknown) => order.push(shapes === undefined ? "shapes off" : "shapes")),
      mouthMode: () => "warp" as const,
    };
    const track = { durationS: 2, at: () => ({ rest: 0, openWide: 1, openMid: 0, round: 0, closed: 0, teeth: 0, tongue: 0, narrow: 0 }) };
    const t = job({ player, mouth: { track, reducedMotion: () => false } });
    const result = recordLine(t.full);
    order.length = 0;
    t.clock.step(0);
    t.clock.step(33);
    expect(order).toEqual(["shapes", "render", "shapes", "render"]);
    t.graph.sources[0]?.onended?.();
    await flush();
    await result;
    expect(order.at(-1)).toBe("shapes off");
  });

  it("rejects with a sentence when aborted, and restarts the player", async () => {
    const abort = new AbortController();
    const t = job({ signal: abort.signal });
    const result = recordLine(t.full);
    abort.abort();
    await expect(result).rejects.toThrow(RECORD_FAILED);
    expect(t.player.start).toHaveBeenCalled();
    expect(t.clock.cancel).toHaveBeenCalled();
  });

  it("rejects when the canvas has no 2D context or the recorder will not start", async () => {
    const log: string[] = [];
    await expect(recordLine(job({ target: fakeCanvas(log, false).target }).full)).rejects.toThrow(NO_CANVAS);
    const Broken = Object.assign(
      function Broken() {
        throw new Error("NotSupportedError");
      },
      { isTypeSupported: () => true },
    );
    await expect(recordLine(job({ Recorder: Broken as object as RecordJob["Recorder"] }).full)).rejects.toThrow(RECORD_FAILED);
  });

  it("rejects when the recorder errors", async () => {
    const t = job();
    const result = recordLine(t.full);
    t.rec.made[0]?.onerror?.(new Event("error") as never);
    await expect(result).rejects.toThrow(RECORD_FAILED);
  });
});
