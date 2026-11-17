// The `fhl/1` wire protocol (spec flashhead-live, design.md "Wire protocol"): the live server's
// JSON messages and its binary frames, typed and codec'd here, pure so the codec is table-tested
// against hand-built buffers. Every binary number is little-endian.
//   server -> out:     0x01 video  [tag u8][ptsMs f64][width u16][height u16][JPEG]
//                      0x04 matted [tag u8][ptsMs f64][width u16][height u16][rgbLength u32]
//                                  [colour JPEG (rgbLength)][greyscale alpha JPEG (the rest)]
//                      0x02 audio  [tag u8][ptsMs f64][sampleRate u32][PCM16LE mono]
//                      0x03 slide  [tag u8][index u32][image bytes]
//   control -> server: 0x10 mic    [tag u8][PCM16LE mono 16 kHz]
//                      0x13 slide  [tag u8][image bytes]

export const PROTO = "fhl/1";
export const DEFAULT_SERVER = "ws://127.0.0.1:8765/live";

export const TAG = { video: 0x01, audio: 0x02, slide: 0x03, matted: 0x04, mic: 0x10, slideUp: 0x13 } as const;

export type Role = "control" | "out";
export type UpscaleKind = "none" | "realesrgan" | "maxine" | "iris";
export const UPSCALE_KINDS: readonly UpscaleKind[] = ["none", "realesrgan", "maxine", "iris"];
export type Source = "text" | "mic";
/** Which idle the server shows: the pre-rendered loop or the live model (round 2). */
export type IdleKind = "loop" | "live";
/** Head motion and gaze glances (round 3). */
export type MotionLevel = "off" | "natural" | "lively";
export const MOTION_LEVELS: readonly MotionLevel[] = ["off", "natural", "lively"];
/** The text of the `line-end` the server sends for a cut line: out clients flush on it. */
export const STOPPED = "stopped";

export type ClientMessage =
  | { type: "hello"; role: Role }
  | { type: "say"; id: string; text: string }
  | { type: "chat"; id: string; text: string }
  | { type: "stop" }
  | { type: "source"; source: Source }
  | { type: "upscale"; kind: UpscaleKind }
  | { type: "matte"; on: boolean }
  | { type: "motion"; level: MotionLevel }
  | { type: "slide"; index: number };

export interface LiveState {
  type: "state";
  ready: boolean;
  model: string;
  fps: number;
  upscale: string;
  source: Source;
  queue: number;
  delayMs: number;
  size: number;
  /** Matting on (0x04 frames). False from a server that predates it. */
  matte: boolean;
  /** Null from a server that predates the idle loop. */
  idle: IdleKind | null;
  /** Null from a server that predates head motion (round 3). */
  motion: MotionLevel | null;
}

export type EventKind = "line-start" | "line-end" | "reply-text" | "slide" | "error";
export const EVENT_KINDS: readonly EventKind[] = ["line-start", "line-end", "reply-text", "slide", "error"];

export interface LiveEvent {
  type: "event";
  kind: EventKind;
  id: string | null;
  text: string | null;
  atMs: number;
}

export interface LiveTiming {
  type: "timing";
  id: string;
  firstFrameMs: number;
  chunkMs: number;
  upscaleMs: number | null;
}

export type ServerMessage = LiveState | LiveEvent | LiveTiming;

export interface VideoFrame {
  kind: "video";
  ptsMs: number;
  width: number;
  height: number;
  /** The JPEG bytes (a view into the received buffer). */
  jpeg: Uint8Array;
  /** 0x04 only: the greyscale alpha JPEG (255 = opaque), same width and height. */
  alpha?: Uint8Array;
}

export interface AudioChunk {
  kind: "audio";
  ptsMs: number;
  sampleRate: number;
  /** PCM16 samples as floats in [-1, 1). */
  samples: Float32Array;
}

export interface SlideImage {
  kind: "slide";
  index: number;
  /** The image bytes; empty means "no slide" to the out page. */
  image: Uint8Array;
}

export type Media = VideoFrame | AudioChunk | SlideImage;

const MEDIA_HEADER = 13; // tag + f64 + (u16 + u16 | u32)
const SLIDE_HEADER = 5; // tag + u32
const MATTED_HEADER = 17; // tag + f64 + u16 + u16 + u32

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const strOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/** A server text frame, validated; undefined for anything this client does not know. */
export function parseServerMessage(text: string): ServerMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const v = value;
  if (v.type === "state") {
    if (typeof v.ready !== "boolean" || !isNum(v.fps) || !isNum(v.queue) || !isNum(v.delayMs) || !isNum(v.size)) return undefined;
    if (v.source !== "text" && v.source !== "mic") return undefined;
    return {
      type: "state",
      ready: v.ready,
      model: typeof v.model === "string" ? v.model : "",
      fps: v.fps,
      upscale: typeof v.upscale === "string" ? v.upscale : "none",
      source: v.source,
      queue: v.queue,
      delayMs: v.delayMs,
      size: v.size,
      matte: v.matte === true,
      idle: v.idle === "loop" || v.idle === "live" ? v.idle : null,
      motion: MOTION_LEVELS.find((level) => level === v.motion) ?? null,
    };
  }
  if (v.type === "event") {
    const kind = EVENT_KINDS.find((k) => k === v.kind);
    if (kind === undefined || !strOrNull(v.id) || !strOrNull(v.text) || !isNum(v.atMs)) return undefined;
    return { type: "event", kind, id: v.id, text: v.text, atMs: v.atMs };
  }
  if (v.type === "timing") {
    if (typeof v.id !== "string" || !isNum(v.firstFrameMs) || !isNum(v.chunkMs)) return undefined;
    if (v.upscaleMs !== null && !isNum(v.upscaleMs)) return undefined;
    return { type: "timing", id: v.id, firstFrameMs: v.firstFrameMs, chunkMs: v.chunkMs, upscaleMs: v.upscaleMs };
  }
  return undefined;
}

export const encodeMessage = (message: ClientMessage): string => JSON.stringify(message);

/** A server binary frame; undefined for an unknown tag or a truncated header. */
export function decodeMedia(buffer: ArrayBuffer): Media | undefined {
  const view = new DataView(buffer);
  if (view.byteLength < 1) return undefined;
  const tag = view.getUint8(0);
  if (tag === TAG.video) {
    if (view.byteLength < MEDIA_HEADER) return undefined;
    return {
      kind: "video",
      ptsMs: view.getFloat64(1, true),
      width: view.getUint16(9, true),
      height: view.getUint16(11, true),
      jpeg: new Uint8Array(buffer, MEDIA_HEADER),
    };
  }
  if (tag === TAG.matted) {
    if (view.byteLength < MATTED_HEADER) return undefined;
    const rgbLength = view.getUint32(13, true);
    if (rgbLength > view.byteLength - MATTED_HEADER) return undefined;
    return {
      kind: "video",
      ptsMs: view.getFloat64(1, true),
      width: view.getUint16(9, true),
      height: view.getUint16(11, true),
      jpeg: new Uint8Array(buffer, MATTED_HEADER, rgbLength),
      alpha: new Uint8Array(buffer, MATTED_HEADER + rgbLength),
    };
  }
  if (tag === TAG.audio) {
    if (view.byteLength < MEDIA_HEADER) return undefined;
    const count = Math.floor((view.byteLength - MEDIA_HEADER) / 2);
    const samples = new Float32Array(count);
    // The samples start at an odd offset: read them through the DataView, not an Int16Array.
    for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(MEDIA_HEADER + 2 * i, true) / 32768;
    return { kind: "audio", ptsMs: view.getFloat64(1, true), sampleRate: view.getUint32(9, true), samples };
  }
  if (tag === TAG.slide) {
    if (view.byteLength < SLIDE_HEADER) return undefined;
    return { kind: "slide", index: view.getUint32(1, true), image: new Uint8Array(buffer, SLIDE_HEADER) };
  }
  return undefined;
}

/** Floats in [-1, 1] as PCM16 (clamped, rounded). */
export function toPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = Math.round(s < 0 ? s * 32768 : s * 32767);
  }
  return out;
}

/** A 0x10 mic frame: the tag, then PCM16LE mono 16 kHz samples. */
export function encodeMic(pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(1 + pcm.length * 2);
  const view = new DataView(buffer);
  view.setUint8(0, TAG.mic);
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(1 + 2 * i, pcm[i] ?? 0, true);
  return buffer;
}

/** A 0x13 slide frame: the tag, then the image bytes. */
export function encodeSlide(image: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(1 + image.byteLength);
  out[0] = TAG.slideUp;
  out.set(image, 1);
  return out.buffer;
}

/** Builders for the server's frames, for the tests (the e2e fake server writes its own, independently). */
export function encodeVideo(ptsMs: number, width: number, height: number, jpeg: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(MEDIA_HEADER + jpeg.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, TAG.video);
  view.setFloat64(1, ptsMs, true);
  view.setUint16(9, width, true);
  view.setUint16(11, height, true);
  out.set(jpeg, MEDIA_HEADER);
  return out.buffer;
}

export function encodeMatted(ptsMs: number, width: number, height: number, jpeg: Uint8Array, alpha: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(MATTED_HEADER + jpeg.byteLength + alpha.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, TAG.matted);
  view.setFloat64(1, ptsMs, true);
  view.setUint16(9, width, true);
  view.setUint16(11, height, true);
  view.setUint32(13, jpeg.byteLength, true);
  out.set(jpeg, MATTED_HEADER);
  out.set(alpha, MATTED_HEADER + jpeg.byteLength);
  return out.buffer;
}

export function encodeAudio(ptsMs: number, sampleRate: number, pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(MEDIA_HEADER + pcm.length * 2);
  const view = new DataView(buffer);
  view.setUint8(0, TAG.audio);
  view.setFloat64(1, ptsMs, true);
  view.setUint32(9, sampleRate, true);
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(MEDIA_HEADER + 2 * i, pcm[i] ?? 0, true);
  return buffer;
}

export function encodeSlideOut(index: number, image: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(SLIDE_HEADER + image.byteLength);
  new DataView(out.buffer).setUint32(1, index, true);
  out[0] = TAG.slide;
  out.set(image, SLIDE_HEADER);
  return out.buffer;
}

/** The server URL from `?server=` (ws: or wss: only), else the default. */
export function serverUrl(search: string): string {
  const raw = new URLSearchParams(search).get("server")?.trim();
  if (raw === undefined || raw === "") return DEFAULT_SERVER;
  try {
    const url = new URL(raw);
    return url.protocol === "ws:" || url.protocol === "wss:" ? url.toString() : DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}
