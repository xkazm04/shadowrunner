import { describe, expect, it } from "vitest";
import { tabCaptureScript } from "../capture.js";
import { parseOverlordArgs } from "../run.js";
import { transcriptToTimeline } from "../transcript.js";

const transcript = [
  JSON.stringify({ type: "stream_start", ts_ms: 0 }),
  JSON.stringify({ type: "chat", ts_ms: 1500, msg: { id: "m1", ts_ms: 1500, viewer: { id: "v", name: "bonepicker42" }, text: "too early" } }),
  JSON.stringify({ type: "chat", ts_ms: 3600, msg: { id: "m2", ts_ms: 3600, viewer: { id: "v2", name: "Mossy" }, text: "hi??" } }),
  JSON.stringify({ type: "say", ts_ms: 6400, speaker: "malakor", text: "A new Thrall." }),
  "not json",
].join("\n");

describe("Overlord transcript -> timeline", () => {
  it("chat becomes turns and says become says, on the recording clock", () => {
    expect(transcriptToTimeline(transcript, 2000)).toEqual([
      { t: 1600, kind: "turn", turn: 1, chat: { id: "m2", user: "Mossy", text: "hi??", atMs: 1600 } },
      { t: 4400, kind: "say", id: "say-1", text: "A new Thrall." },
    ]);
  });
});

describe("overlord args", () => {
  it("needs a toml and defaults to haunt-01's length", () => {
    expect(() => parseOverlordArgs([])).toThrow(/--toml/);
    expect(parseOverlordArgs(["--toml", "x.toml"])).toMatchObject({ toml: "x.toml", seconds: 125, seed: 1031, headless: true, port: 7717, stagePort: 5178 });
    expect(() => parseOverlordArgs(["--toml", "x.toml", "--seconds", "400"])).toThrow(/sandbox/);
  });
});

describe("tab capture script", () => {
  it("records the tab with the page's own audio tap, and reports a normal browser", () => {
    const s = tabCaptureScript();
    expect(s).toContain("getDisplayMedia");
    expect(s).toContain("preferCurrentTab: true");
    expect(s).toContain("createMediaStreamDestination");
    expect(s).toContain('"webdriver"');
  });
});
