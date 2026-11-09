// Preview and Record (spec avatar-reach, design "Studio", requirements 4.3-4.4). One decoded line
// plays through an AudioBufferSourceNode into the speakers and the player's level tap (lip-sync);
// Record also routes it into a MediaStreamAudioDestinationNode and composites every frame (the
// background colour, then the transparent player canvas) into a second canvas whose
// captureStream(30) carries the video. MediaRecorder writes both tracks into one WebM.
//
// Decisions the spec leaves open:
// - While recording, the player's own loop is stopped and each frame is stepped with
//   `renderFrame(dt)` and copied at once, so a WebGL canvas is read before its buffer is cleared.
//   The loop restarts when the recording ends, however it ends. With a mouth track (perfection-pass
//   task 4) each frame's shapes are set just before its `renderFrame` (lipsync.ts).
// - The video is the player canvas's pixel size, rounded down to even numbers (codecs want them).
// - Progress is the time recorded over the line's duration plus the 0.5 s tail.
// - Browser APIs come in through small structural types, so the pipeline is tested with fakes.
import type { AvatarPlayer } from "@sr/avatar/core";
import { trackShaper, type LipTrack } from "./lipsync";
import { blobWithDuration } from "./webmDuration";

/** MediaRecorder types in order of preference (design "Studio"). */
export const RECORD_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] as const;
/** Seconds recorded after the line ends. */
export const TAIL_S = 0.5;
export const FPS = 30;

export const RECORD_FAILED = "The recording failed. Try again, or try another browser.";
export const NO_CANVAS = "This browser could not draw the video frame.";

export interface RecorderClass {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorderLike;
  isTypeSupported(type: string): boolean;
}

export interface MediaRecorderLike {
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  /** The event type differs across DOM libs (Event, ErrorEvent); the handler never reads it. */
  onerror: ((event: never) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
  readonly state: string;
}

/** The first type the browser records, or undefined. */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string | undefined {
  return RECORD_TYPES.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

export interface RecordWindow {
  MediaRecorder?: unknown;
  HTMLCanvasElement?: { prototype: object };
}

/** Requirement 4.4: MediaRecorder, canvas captureStream and a recordable WebM type all exist. */
export function canRecord(win: RecordWindow | undefined = typeof window === "undefined" ? undefined : window): boolean {
  const recorder = win?.MediaRecorder;
  const canvas = win?.HTMLCanvasElement?.prototype;
  if (typeof recorder !== "function" || canvas === undefined) return false;
  if (typeof (canvas as { captureStream?: unknown }).captureStream !== "function") return false;
  const supported = (recorder as { isTypeSupported?: unknown }).isTypeSupported;
  return typeof supported === "function" && pickMimeType((type) => supported.call(recorder, type) === true) !== undefined;
}

/** The audio graph a line needs (an AudioContext in the browser). */
export interface LineContext {
  readonly destination: AudioNode;
  /** The audio clock, seconds (an AudioContext's; a fake may leave it out: the wall clock stands in). */
  readonly currentTime?: number;
  createBufferSource(): AudioBufferSourceNode;
  createMediaStreamDestination(): MediaStreamAudioDestinationNode;
}

export type LipSync = Pick<AvatarPlayer, "attachAudio">;

export interface Playback {
  /** Resolves when the line has played out (or was stopped). */
  ended: Promise<void>;
  stop(): void;
  /** Seconds since the line started, on the audio clock (lip-sync, lipsync.ts). */
  clock(): number;
}

/** Plays `buffer` to the speakers (and `also`, when given) with the player's mouth on it. */
export function playLine(context: LineContext, buffer: AudioBuffer, player: LipSync, also?: AudioNode): Playback {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  if (also !== undefined) source.connect(also);
  player.attachAudio(source);
  let stopped = false;
  const audioStart = context.currentTime;
  const wallStart = performance.now();
  const ended = new Promise<void>((resolve) => {
    source.onended = () => {
      if (!stopped) player.attachAudio(undefined);
      stopped = true;
      resolve();
    };
  });
  source.start();
  return {
    ended,
    clock: () => (audioStart === undefined || context.currentTime === undefined ? (performance.now() - wallStart) / 1000 : context.currentTime - audioStart),
    stop() {
      if (stopped) return;
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    },
  };
}

export interface CaptureCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect" | "drawImage"> | null;
  captureStream(fps?: number): MediaStream;
}

export interface Frames {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export interface RecordJob {
  context: LineContext;
  buffer: AudioBuffer;
  player: Pick<AvatarPlayer, "attachAudio" | "renderFrame" | "start" | "stop" | "setMouthShapes" | "mouthMode">;
  /** The line's mouth track (lipsync.ts): shapes a drawn or warp mouth each recorded frame. */
  mouth?: LipTrack;
  /** The player's canvas (transparent). */
  source: CanvasImageSource & { width: number; height: number };
  /** The canvas the video is drawn into. */
  target: CaptureCanvas;
  /** A CSS colour under the character. */
  background: string;
  Recorder: RecorderClass;
  mimeType: string;
  frames: Frames;
  wait(ms: number): void | Promise<void>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class RecordError extends Error {}

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

/** Records one line as a WebM Blob. Rejects with a RecordError whose message is a sentence. */
export function recordLine(job: RecordJob): Promise<Blob> {
  const { player, target, source } = job;
  target.width = even(source.width);
  target.height = even(source.height);
  const g = target.getContext("2d");
  if (g === null) return Promise.reject(new RecordError(NO_CANVAS));

  const draw = (): void => {
    g.fillStyle = job.background;
    g.fillRect(0, 0, target.width, target.height);
    g.drawImage(source, 0, 0, target.width, target.height);
  };

  return new Promise<Blob>((resolve, reject) => {
    let video: MediaStream;
    let recorder: MediaRecorderLike;
    let audio: MediaStreamAudioDestinationNode;
    try {
      audio = job.context.createMediaStreamDestination();
      video = target.captureStream(FPS);
      for (const track of audio.stream.getAudioTracks()) video.addTrack(track);
      recorder = new job.Recorder(video, { mimeType: job.mimeType });
    } catch {
      reject(new RecordError(RECORD_FAILED));
      return;
    }
    const chunks: Blob[] = [];
    const total = job.buffer.duration + TAIL_S;
    let handle: number | undefined;
    let playback: Playback | undefined;
    let shaper: ReturnType<typeof trackShaper> | undefined;
    let settled = false;
    let failed = false;
    // The take's wall-clock length, written into the WebM (MediaRecorder leaves it out; webmDuration.ts).
    let startedAt: number | undefined;
    let stoppedAt: number | undefined;

    const cleanup = (): void => {
      if (handle !== undefined) job.frames.cancel(handle);
      handle = undefined;
      playback?.stop();
      shaper?.clear();
      player.attachAudio(undefined);
      for (const track of video.getTracks()) track.stop();
      job.signal?.removeEventListener("abort", abort);
      player.start();
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      stoppedAt = performance.now();
      cleanup();
      if (recorder.state !== "inactive") recorder.stop();
      else stopped();
    };
    const fail = (): void => {
      failed = true;
      finish();
    };
    function abort(): void {
      fail();
    }
    function stopped(): void {
      if (failed || chunks.length === 0) reject(new RecordError(RECORD_FAILED));
      else {
        const blob = new Blob(chunks, { type: "video/webm" });
        resolve(startedAt === undefined || stoppedAt === undefined ? blob : blobWithDuration(blob, stoppedAt - startedAt));
      }
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = fail;
    recorder.onstop = stopped;
    job.signal?.addEventListener("abort", abort);

    player.stop();
    player.renderFrame(0);
    draw();
    let elapsed = 0;
    let last: number | undefined;
    const tick = (now: number): void => {
      if (settled) return;
      const dt = last === undefined ? 0 : Math.max(0, (now - last) / 1000);
      last = now;
      elapsed += dt;
      shaper?.frame(dt);
      player.renderFrame(dt);
      draw();
      job.onProgress?.(Math.min(1, elapsed / total));
      handle = job.frames.request(tick);
    };
    try {
      recorder.start(1000);
      startedAt = performance.now();
      playback = playLine(job.context, job.buffer, player, audio);
      if (job.mouth !== undefined) shaper = trackShaper(player, job.mouth, playback.clock);
    } catch {
      fail();
      return;
    }
    handle = job.frames.request(tick);
    void playback.ended.then(async () => {
      if (settled) return;
      await job.wait(TAIL_S * 1000);
      job.onProgress?.(1);
      finish();
    });
  });
}
