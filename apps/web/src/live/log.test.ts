import { describe, expect, it } from "vitest";
import { addLine, addTurn, HISTORY_CAP, lineLengthMs, looseError, updateChat, updateLines, type ChatTurn, type LineRecord } from "./log";
import { parseLiveParams, outUrl } from "./params";
import type { ServerMessage } from "./protocol";

const ev = (kind: "line-start" | "line-end" | "reply-text" | "error", id: string | null, text: string | null = null, atMs = 0): ServerMessage => ({
  type: "event",
  kind,
  id,
  text,
  atMs,
});

describe("lines", () => {
  const sent: LineRecord = { id: "a", text: "Hello", origin: "line", status: "sent" };

  it("follows a line by id through start, timing and end", () => {
    let lines = addLine([], sent);
    lines = updateLines(lines, ev("line-start", "a", null, 1000));
    expect(lines[0]?.status).toBe("speaking");
    lines = updateLines(lines, { type: "timing", id: "a", firstFrameMs: 812, chunkMs: 410, upscaleMs: null });
    lines = updateLines(lines, ev("line-end", "a", null, 3400));
    lines = updateLines(lines, ev("line-end", "zzz", null, 9999));
    expect(lines[0]).toMatchObject({ status: "done", startMs: 1000, endMs: 3400, firstFrameMs: 812, upscaleMs: null });
    expect(lineLengthMs(lines[0] ?? sent)).toBe(2400);
  });

  it("marks a refused line and caps the history, newest first", () => {
    expect(updateLines([sent], ev("error", "a", "mic is on"))[0]).toMatchObject({ status: "error", error: "mic is on" });
    let lines: LineRecord[] = [];
    for (let i = 0; i < HISTORY_CAP + 5; i += 1) lines = addLine(lines, { ...sent, id: `l${i}` });
    expect(lines).toHaveLength(HISTORY_CAP);
    expect(lines[0]?.id).toBe(`l${HISTORY_CAP + 4}`);
  });
});

describe("chat", () => {
  const turn: ChatTurn = { id: "c1", text: "Who are you?", reply: [], status: "waiting" };

  it("adds reply-text by id, and a null-id reply to the latest turn", () => {
    let turns = addTurn([], turn);
    turns = updateChat(turns, ev("reply-text", "c1", "I am Iris."));
    turns = updateChat(turns, ev("reply-text", null, "I keep the cellar."));
    expect(turns[0]).toMatchObject({ status: "replying", reply: ["I am Iris.", "I keep the cellar."] });
    expect(updateChat(turns, ev("line-end", "c1"))[0]?.status).toBe("done");
  });
});

describe("looseError", () => {
  it("surfaces errors no known line claims", () => {
    expect(looseError(ev("error", null, "maxine unavailable"), () => false)).toBe("maxine unavailable");
    expect(looseError(ev("error", "a", "x"), (id) => id === "a")).toBeUndefined();
    expect(looseError(ev("line-end", null), () => false)).toBeUndefined();
  });
});

describe("parseLiveParams", () => {
  it("reads out, corner and slides with safe defaults", () => {
    expect(parseLiveParams("")).toEqual({ out: false, server: "ws://127.0.0.1:8765/live", corner: "br", slides: true });
    expect(parseLiveParams("?out=1&corner=TL&slides=0&server=ws://127.0.0.1:8790/live")).toEqual({
      out: true,
      server: "ws://127.0.0.1:8790/live",
      corner: "tl",
      slides: false,
    });
    expect(parseLiveParams("?out=yes&corner=middle").corner).toBe("br");
    expect(parseLiveParams("?out=yes").out).toBe(false);
  });

  it("builds the OBS URL with the server only when it is not the default", () => {
    const def = "ws://127.0.0.1:8765/live";
    expect(outUrl("http://localhost:5173/", def, def)).toBe("http://localhost:5173/live?out=1");
    expect(outUrl("http://localhost:5173", "ws://127.0.0.1:8790/live", def)).toBe(
      "http://localhost:5173/live?out=1&server=ws%3A%2F%2F127.0.0.1%3A8790%2Flive",
    );
  });
});
