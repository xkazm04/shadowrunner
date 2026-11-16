import { describe, expect, it } from "vitest";
import {
  decodeMedia,
  DEFAULT_SERVER,
  encodeAudio,
  encodeMessage,
  encodeMatted,
  encodeMic,
  encodeSlide,
  encodeSlideOut,
  encodeVideo,
  parseServerMessage,
  serverUrl,
  toPcm16,
} from "./protocol";

/** Bytes written by hand, little-endian, exactly as design.md lays them out. */
function bytes(...parts: (number[] | { f64: number } | { u16: number } | { u32: number } | { i16: number[] })[]): ArrayBuffer {
  const out: number[] = [];
  for (const part of parts) {
    if (Array.isArray(part)) out.push(...part);
    else if ("f64" in part) {
      const b = new DataView(new ArrayBuffer(8));
      b.setFloat64(0, part.f64, true);
      out.push(...new Uint8Array(b.buffer));
    } else if ("u16" in part) out.push(part.u16 & 0xff, part.u16 >> 8);
    else if ("u32" in part) out.push(part.u32 & 0xff, (part.u32 >> 8) & 0xff, (part.u32 >> 16) & 0xff, (part.u32 >>> 24) & 0xff);
    else for (const s of part.i16) out.push(s & 0xff, (s >> 8) & 0xff);
  }
  return new Uint8Array(out).buffer;
}

describe("decodeMedia", () => {
  it("reads a 0x01 video frame: f64 pts, u16 width, u16 height, then the JPEG", () => {
    const buffer = bytes([0x01], { f64: 1240 }, { u16: 512 }, { u16: 1024 }, [0xff, 0xd8, 0xff, 0xd9]);
    const media = decodeMedia(buffer);
    expect(media).toMatchObject({ kind: "video", ptsMs: 1240, width: 512, height: 1024 });
    expect(media?.kind === "video" && [...media.jpeg]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("reads a 0x04 matted frame: f64 pts, u16 width, u16 height, u32 rgbLength, colour JPEG, then the alpha JPEG", () => {
    const buffer = bytes([0x04], { f64: 4000 }, { u16: 1024 }, { u16: 1024 }, { u32: 3 }, [0xff, 0xd8, 0x01], [0xff, 0xd8, 0x02, 0x03]);
    const media = decodeMedia(buffer);
    expect(media).toMatchObject({ kind: "video", ptsMs: 4000, width: 1024, height: 1024 });
    expect(media?.kind === "video" && [...media.jpeg]).toEqual([0xff, 0xd8, 0x01]);
    expect(media?.kind === "video" && media.alpha !== undefined && [...media.alpha]).toEqual([0xff, 0xd8, 0x02, 0x03]);
  });

  it("refuses a 0x04 frame whose rgbLength runs past the message or whose header is cut", () => {
    expect(decodeMedia(bytes([0x04], { f64: 0 }, { u16: 8 }, { u16: 8 }, { u32: 5 }, [1, 2, 3, 4]))).toBeUndefined();
    expect(decodeMedia(bytes([0x04], { f64: 0 }, { u16: 8 }, { u16: 8 }, [0, 0]))).toBeUndefined();
    // rgbLength may take the whole rest: an empty alpha is still a frame (the player draws it opaque).
    const all = decodeMedia(bytes([0x04], { f64: 0 }, { u16: 8 }, { u16: 8 }, { u32: 2 }, [7, 8]));
    expect(all?.kind === "video" && all.alpha?.byteLength).toBe(0);
  });

  it("leaves a 0x01 frame without alpha", () => {
    const media = decodeMedia(bytes([0x01], { f64: 0 }, { u16: 4 }, { u16: 4 }, [1]));
    expect(media?.kind === "video" && media.alpha).toBeUndefined();
  });

  it("reads a 0x02 audio chunk: f64 pts, u32 rate, then PCM16LE at an odd offset", () => {
    const buffer = bytes([0x02], { f64: 40.5 }, { u32: 24000 }, { i16: [0, 16384, -32768, 32767] });
    const media = decodeMedia(buffer);
    expect(media).toMatchObject({ kind: "audio", ptsMs: 40.5, sampleRate: 24000 });
    expect(media?.kind === "audio" && [...media.samples]).toEqual([0, 0.5, -1, 32767 / 32768]);
  });

  it("reads a 0x03 slide: u32 index, then the image bytes (empty allowed)", () => {
    const media = decodeMedia(bytes([0x03], { u32: 7 }, [0x89, 0x50]));
    expect(media).toMatchObject({ kind: "slide", index: 7 });
    expect(media?.kind === "slide" && [...media.image]).toEqual([0x89, 0x50]);
    const empty = decodeMedia(bytes([0x03], { u32: 0 }));
    expect(empty?.kind === "slide" && empty.image.byteLength).toBe(0);
  });

  it("refuses unknown tags, empty buffers and truncated headers", () => {
    expect(decodeMedia(new ArrayBuffer(0))).toBeUndefined();
    expect(decodeMedia(bytes([0x7f], { f64: 0 }, { u32: 0 }))).toBeUndefined();
    expect(decodeMedia(bytes([0x01], { f64: 0 }, { u16: 512 }))).toBeUndefined();
    expect(decodeMedia(bytes([0x02], { f64: 0 }))).toBeUndefined();
    expect(decodeMedia(bytes([0x03], [0, 0]))).toBeUndefined();
  });

  it("round-trips the server-side builders the fake server uses", () => {
    const jpeg = new Uint8Array([1, 2, 3]);
    expect(decodeMedia(encodeVideo(80, 512, 512, jpeg))).toMatchObject({ kind: "video", ptsMs: 80, width: 512, height: 512 });
    const audio = decodeMedia(encodeAudio(120, 16000, new Int16Array([-2, 3])));
    expect(audio?.kind === "audio" && [...audio.samples].map((s) => Math.round(s * 32768))).toEqual([-2, 3]);
    expect(new Uint8Array(encodeSlideOut(2, jpeg))).toEqual(new Uint8Array(bytes([0x03], { u32: 2 }, [1, 2, 3])));
    const matted = decodeMedia(encodeMatted(160, 1024, 1024, jpeg, new Uint8Array([9, 9])));
    expect(matted).toMatchObject({ kind: "video", ptsMs: 160, width: 1024, height: 1024 });
    expect(matted?.kind === "video" && [[...matted.jpeg], [...(matted.alpha ?? [])]]).toEqual([[1, 2, 3], [9, 9]]);
  });
});

describe("client frames", () => {
  it("writes 0x10 mic frames as the tag then PCM16LE", () => {
    expect(new Uint8Array(encodeMic(new Int16Array([1, -1, 0x1234])))).toEqual(new Uint8Array(bytes([0x10], { i16: [1, -1, 0x1234] })));
  });

  it("writes 0x13 slide frames as the tag then the image bytes", () => {
    expect([...new Uint8Array(encodeSlide(new Uint8Array([0xff, 0xd8])))]).toEqual([0x13, 0xff, 0xd8]);
  });

  it("clamps and rounds floats into PCM16", () => {
    expect([...toPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });

  it("writes JSON messages as they are", () => {
    expect(JSON.parse(encodeMessage({ type: "hello", role: "out" }))).toEqual({ type: "hello", role: "out" });
    expect(JSON.parse(encodeMessage({ type: "say", id: "a", text: "Hi" }))).toEqual({ type: "say", id: "a", text: "Hi" });
    expect(JSON.parse(encodeMessage({ type: "matte", on: true }))).toEqual({ type: "matte", on: true });
  });
});

describe("parseServerMessage", () => {
  it("reads state, event and timing, keeping null values", () => {
    const state = { type: "state", ready: true, model: "lite", fps: 25, upscale: "none", source: "text", queue: 0, delayMs: 250, size: 512, matte: true, idle: "loop" };
    expect(parseServerMessage(JSON.stringify(state))).toEqual(state);
    // A round-1 server sends neither key: matte off, idle unknown.
    const v1 = { type: "state", ready: true, model: "lite", fps: 25, upscale: "none", source: "text", queue: 0, delayMs: 250, size: 512 };
    expect(parseServerMessage(JSON.stringify(v1))).toMatchObject({ matte: false, idle: null });
    expect(parseServerMessage(JSON.stringify({ ...state, idle: "nap" }))).toMatchObject({ idle: null });
    const event = { type: "event", kind: "slide", id: null, text: "2", atMs: 4000 };
    expect(parseServerMessage(JSON.stringify(event))).toEqual(event);
    const timing = { type: "timing", id: "line-1", firstFrameMs: 812, chunkMs: 410, upscaleMs: null };
    expect(parseServerMessage(JSON.stringify(timing))).toEqual(timing);
  });

  it("drops what it does not know or what is malformed", () => {
    expect(parseServerMessage("not json")).toBeUndefined();
    expect(parseServerMessage("[]")).toBeUndefined();
    expect(parseServerMessage(JSON.stringify({ type: "hello" }))).toBeUndefined();
    expect(parseServerMessage(JSON.stringify({ type: "event", kind: "dance", id: null, text: null, atMs: 0 }))).toBeUndefined();
    expect(parseServerMessage(JSON.stringify({ type: "state", ready: true, fps: 25, queue: 0, delayMs: 250, size: 512, source: "radio" }))).toBeUndefined();
    expect(parseServerMessage(JSON.stringify({ type: "timing", id: "a", firstFrameMs: 1, chunkMs: 1, upscaleMs: "x" }))).toBeUndefined();
  });
});

describe("serverUrl", () => {
  it("takes ?server= when it is a ws: or wss: URL, else the default", () => {
    expect(serverUrl("")).toBe(DEFAULT_SERVER);
    expect(serverUrl("?server=ws://127.0.0.1:8790/live")).toBe("ws://127.0.0.1:8790/live");
    expect(serverUrl("?server=wss://example.test/live")).toBe("wss://example.test/live");
    expect(serverUrl("?server=http://127.0.0.1:8790/live")).toBe(DEFAULT_SERVER);
    expect(serverUrl("?server=%%%")).toBe(DEFAULT_SERVER);
  });
});
