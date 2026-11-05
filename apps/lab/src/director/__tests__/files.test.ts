import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../contract.js";
import { repliesOf } from "../recordFixture.js";
import { parseTimelineEvent } from "../timeline.js";
import { decodeWav, encodeWav, pcmDurationMs } from "../voice/wav.js";

describe("wav", () => {
  it("round-trips 16-bit mono PCM", () => {
    const pcm = Buffer.from([1, 0, 255, 127, 0, 128]);
    expect(decodeWav(encodeWav(pcm, 24000))).toEqual({ sampleRate: 24000, pcm });
    expect(pcmDurationMs(Buffer.alloc(48000), 24000)).toBe(1000);
    expect(() => decodeWav(Buffer.from("nope"))).toThrow("RIFF");
  });
});

describe("timeline events", () => {
  it("accepts every kind and rejects junk", () => {
    const good: TimelineEvent[] = [
      { t: 1, kind: "say", id: "a", text: "x" },
      { t: 1, kind: "viseme", id: "a", v: "PP", startMs: 0, endMs: 10 },
      { t: 1, kind: "scene", op: "light", cue: "dim" },
      { t: 1, kind: "scene", op: "poll", action: "open", question: "q", options: ["a", "b"] },
      { t: 1, kind: "gesture", value: "nod" },
    ];
    for (const e of good) expect(parseTimelineEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
    expect(parseTimelineEvent({ t: 1, kind: "viseme", id: "a", v: "XX", startMs: 0, endMs: 1 })).toBeUndefined();
    expect(parseTimelineEvent({ t: 1, kind: "scene", op: "light", cue: "disco" })).toBeUndefined();
    expect(parseTimelineEvent({ kind: "say", id: "a", text: "x" })).toBeUndefined();
  });
});

describe("fixture from a timeline", () => {
  it("attributes queued output to the turn whose play mark precedes it", () => {
    const chat = (id: string): { id: string; user: string; text: string; atMs: number } => ({ id, user: "u", text: "t", atMs: 0 });
    const events: TimelineEvent[] = [
      { t: 0, kind: "turn", turn: 1, chat: chat("c1") },
      { t: 1, kind: "mark", name: "play:1" },
      { t: 2, kind: "turn", turn: 2, chat: chat("c2") },
      { t: 3, kind: "emotion", value: "grim" },
      { t: 3, kind: "say", id: "s1", text: "first" },
      { t: 4, kind: "mark", name: "play:2" },
      { t: 5, kind: "gesture", value: "nod" },
      { t: 5, kind: "say", id: "s2", text: "second" },
    ];
    expect(repliesOf(events)).toEqual({
      c1: { line: "first", emotion: "grim", answeredId: "c1" },
      c2: { line: "second", emotion: "neutral", gesture: "nod", answeredId: "c2" },
    });
  });
});
