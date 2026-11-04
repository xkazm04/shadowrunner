import { describe, expect, it } from "vitest";
import { blobWithDuration, withWebmDuration } from "./webmDuration";

const hex = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(s.replace(/\s+/g, "").match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

// The head of a real Chrome MediaRecorder take (e2e run, 2026-11-04): EBML header, a Segment of
// unknown size, Info (TimecodeScale 1 ms, MuxingApp, WritingApp; no Duration), then Tracks.
const HEADER = "1a45dfa3 9f 4286810142f7810142f281044 2f381084282847765626d42878104428581 02";
const SEGMENT = "18538067 01ffffffffffffff";
const INFO = "1549a966 99 2ad7b1830f4240 4d80864368726f6d65 5741864368726f6d65";
const TRACKS = "1654ae6b 83 aabbcc";
const take = (): Uint8Array<ArrayBuffer> => hex(HEADER + SEGMENT + INFO + TRACKS);

function durationOf(bytes: Uint8Array): number | undefined {
  for (let i = 0; i + 11 <= bytes.length; i += 1) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88) return new DataView(bytes.buffer, bytes.byteOffset + i + 3, 8).getFloat64(0);
  }
  return undefined;
}

describe("withWebmDuration", () => {
  it("adds Duration (ms at a 1 ms TimecodeScale) to Info and grows Info's size, leaving the rest", () => {
    const before = take();
    const after = withWebmDuration(before, 15_660);
    expect(after.length).toBe(before.length + 11);
    expect(durationOf(after)).toBe(15_660);
    const info = after.indexOf(0x15);
    expect([...after.subarray(info, info + 5)]).toEqual([0x15, 0x49, 0xa9, 0x66, 0x80 | (0x19 + 11)]);
    expect([...after.subarray(after.length - hex(TRACKS).length)]).toEqual([...hex(TRACKS)]);
    expect(durationOf(before)).toBeUndefined();
  });

  it("overwrites a Duration already there", () => {
    const once = withWebmDuration(take(), 1000);
    const twice = withWebmDuration(once, 2500);
    expect(twice.length).toBe(once.length);
    expect(durationOf(twice)).toBe(2500);
  });

  it("scales by TimecodeScale", () => {
    const tenMs = hex(HEADER + SEGMENT + "1549a966 99 2ad7b183989680 4d80864368726f6d65 5741864368726f6d65" + TRACKS);
    expect(durationOf(withWebmDuration(tenMs, 1000))).toBe(100);
  });

  it("grows a known Segment size by the same amount", () => {
    const body = hex(INFO + TRACKS);
    const known = hex(HEADER + "18538067 " + (0x80 | body.length).toString(16) + " " + INFO + TRACKS);
    const after = withWebmDuration(known, 500);
    const seg = after.indexOf(0x18);
    expect(after[seg + 4]).toBe(0x80 | (body.length + 11));
  });

  it("returns the input untouched when it is not a WebM it understands", () => {
    for (const bad of [new Uint8Array([1, 2, 3]), hex(HEADER), hex(HEADER + SEGMENT + TRACKS), new Uint8Array()]) {
      expect(withWebmDuration(bad, 1000)).toBe(bad);
    }
    expect(withWebmDuration(take(), Number.NaN).length).toBe(take().length);
  });

  it("blobWithDuration keeps the type, and gives a non-WebM Blob back as it was", async () => {
    const blob = new Blob([take()], { type: "video/webm" });
    const patched = await blobWithDuration(blob, 3000);
    expect(patched.type).toBe("video/webm");
    expect(durationOf(new Uint8Array(await patched.arrayBuffer()))).toBe(3000);
    const junk = new Blob(["junk"]);
    expect(await blobWithDuration(junk, 3000)).toBe(junk);
  });
});
