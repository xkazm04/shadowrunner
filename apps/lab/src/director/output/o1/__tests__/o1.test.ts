import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../../../contract.js";
import { captureScript, CHUNK_BINDING } from "../capture.js";
import { clusterTimecode, findCluster, InitSegment, vintLength } from "../ebml.js";
import { publishArgs, sinkArgs } from "../ffmpeg.js";
import { concatList } from "../join.js";
import { loopPeriod, loopTimeline } from "../loop.js";

/** EBML header stand-in + Tracks bytes, then a Cluster (unknown size) with Timecode `tc` (2 bytes). */
function stream(tc: number): Uint8Array {
  const header = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 1, 2, 3, 4, 0x16, 0x54, 0xae, 0x6b, 0x81, 0x00];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x82, tc >> 8, tc & 0xff, 0xa3, 0x81, 0x00];
  return Uint8Array.from([...header, ...cluster]);
}

describe("O1 Matroska framing", () => {
  it("reads vint lengths", () => {
    expect(vintLength(0x81)).toBe(1);
    expect(vintLength(0x40)).toBe(2);
    expect(vintLength(0x01)).toBe(8);
    expect(vintLength(0x00)).toBe(0);
  });

  it("finds a Cluster by structure and reads its timecode", () => {
    const bytes = stream(301);
    const at = findCluster(bytes);
    expect(at).toBe(15);
    expect(clusterTimecode(bytes, at)).toBe(301);
  });

  it("rejects a Cluster id that is not followed by a Timecode", () => {
    const bytes = Uint8Array.from([0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00, 0x00, 0x00]);
    expect(findCluster(bytes)).toBe(-1);
  });

  it("keeps the init segment across chunks and notes the first Cluster's time", () => {
    const bytes = stream(0);
    const init = new InitSegment();
    expect(init.push(bytes.subarray(0, 10))).toBeUndefined();
    const header = init.push(bytes.subarray(10));
    expect(header?.length).toBe(15);
    expect(init.firstClusterMs).toBe(0);
  });
});

describe("O1 ffmpeg settings", () => {
  it("publishes H.264 + AAC with a 2 s keyframe and untouched frame timing", () => {
    const args = publishArgs(1935, { encoder: "libx264", videoKbps: 6000, audioKbps: 160, keyframeS: 2 }).join(" ");
    expect(args).toContain("-c:v libx264");
    expect(args).toContain("expr:gte(t,n_forced*2)");
    expect(args).toContain("-fps_mode passthrough");
    expect(args).toContain("-c:a aac");
    expect(args).toMatch(/rtmp:\/\/127\.0\.0\.1:1935\/live\/lab$/);
  });

  it("the sink only listens on loopback and copies", () => {
    const args = sinkArgs(1935, "x.flv").join(" ");
    expect(args).toContain("-listen 1 -i rtmp://127.0.0.1:1935/live/lab -c copy");
  });

  it("joins segments on the recorder clock, keeping the outage as a gap", () => {
    const list = concatList([
      { file: "C:/r/run.part1.flv", startMs: 0 },
      { file: "C:/r/run.part2.flv", startMs: 301841 },
    ]);
    expect(list).toBe("ffconcat version 1.0\nfile 'run.part1.flv'\nduration 301.841\nfile 'run.part2.flv'\n");
  });

  it("the init script reaches the director through the chunk binding", () => {
    const script = captureScript();
    expect(script).toContain(CHUNK_BINDING);
    expect(script).toContain("videoKeyFrameIntervalDuration");
  });
});

describe("loop", () => {
  const events: TimelineEvent[] = [
    { t: 100, kind: "turn", turn: 1, chat: { id: "c1", user: "u", text: "hi", atMs: 100 } },
    { t: 110, kind: "mark", name: "play:1" },
    { t: 500, kind: "say", id: "say-c1", text: "Counted." },
    { t: 900, kind: "audio", id: "say-c1", sampleRate: 24000, pcmRef: "audio/say-c1.wav", durationMs: 1000 },
    { t: 910, kind: "viseme", id: "say-c1", v: "aa", startMs: 0, endMs: 100 },
  ];

  it("a period is the last audio's end plus a pause", () => {
    expect(loopPeriod(events)).toBe(1900 + 3000);
  });

  it("copies shift t, renumber turns and play marks, and suffix ids; pcmRef is shared", () => {
    const out = loopTimeline(events, 2);
    expect(out).toHaveLength(10);
    const second = out.slice(5);
    expect(second[0]).toEqual({ t: 5000, kind: "turn", turn: 2, chat: { id: "c1~1", user: "u", text: "hi", atMs: 5000 } });
    expect(second[1]).toEqual({ t: 5010, kind: "mark", name: "play:2" });
    expect(second[3]).toMatchObject({ kind: "audio", id: "say-c1~1", pcmRef: "audio/say-c1.wav" });
    expect(new Set(out.filter((e) => e.kind === "audio").map((e) => (e.kind === "audio" ? e.id : ""))).size).toBe(2);
  });
});
