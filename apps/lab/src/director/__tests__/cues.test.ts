import { describe, expect, it } from "vitest";
import { CueStream, MAX_TAG_CHARS, parseTag, type CuePiece } from "../arms/control/cues.js";

/** Feeds `chunks` one by one and returns every piece, in order. */
function run(chunks: readonly string[]): CuePiece[] {
  const s = new CueStream();
  return [...chunks.flatMap((c) => s.push(c)), ...s.end()];
}

const says = (pieces: CuePiece[]): string[] => pieces.flatMap((p) => (p.type === "say" ? [p.text] : []));
const errors = (pieces: CuePiece[]): number => pieces.filter((p) => p.type === "error").length;

describe("parseTag", () => {
  it("reads emotion with and without intensity", () => {
    expect(parseTag("smug 0.7")).toEqual({ kind: "emotion", value: "smug", intensity: 0.7 });
    expect(parseTag(" Grim ")).toEqual({ kind: "emotion", value: "grim" });
    expect(parseTag("emotion amused 1")).toEqual({ kind: "emotion", value: "amused", intensity: 1 });
    expect(parseTag("smug 1.4")).toMatch(/intensity must be 0..1/);
    expect(parseTag("smug loud")).toMatch(/intensity/);
    expect(parseTag("smug 0.5 0.6")).toMatch(/one intensity/);
  });

  it("reads gestures, bare or prefixed", () => {
    expect(parseTag("gesture nod")).toEqual({ kind: "gesture", value: "nod" });
    expect(parseTag("gesture lean in")).toEqual({ kind: "gesture", value: "lean_in" });
    expect(parseTag("recoil")).toEqual({ kind: "gesture", value: "recoil" });
    expect(parseTag("gesture wave")).toMatch(/unknown gesture/);
  });

  it("reads every scene op, with or without the scene prefix", () => {
    expect(parseTag("scene light warm")).toEqual({ kind: "scene", args: { op: "light", cue: "warm" } });
    expect(parseTag("light blackout")).toEqual({ kind: "scene", args: { op: "light", cue: "blackout" } });
    expect(parseTag("candles burst")).toEqual({ kind: "scene", args: { op: "candles", action: "burst" } });
    expect(parseTag("caption whisper")).toEqual({ kind: "scene", args: { op: "caption", style: "whisper" } });
    expect(parseTag("card show census | Room 3 Census | 47 souls, 1 refusal")).toEqual({
      kind: "scene",
      args: { op: "card", action: "show", id: "census", title: "Room 3 Census", body: "47 souls, 1 refusal" },
    });
    expect(parseTag("card show census")).toEqual({ kind: "scene", args: { op: "card", action: "show", id: "census" } });
    expect(parseTag("card hide census")).toEqual({ kind: "scene", args: { op: "card", action: "hide", id: "census" } });
    expect(parseTag("poll open Count me? | yes | no")).toEqual({
      kind: "scene",
      args: { op: "poll", action: "open", question: "Count me?", options: ["yes", "no"] },
    });
    expect(parseTag("poll close")).toEqual({ kind: "scene", args: { op: "poll", action: "close" } });
  });

  it("rejects unknown and malformed tags with a reason", () => {
    for (const bad of ["", "dance", "light purple", "scene fog on", "card show two words", "card hide", "poll open Q? | only", "poll open", "candles"]) {
      expect(typeof parseTag(bad), bad).toBe("string");
    }
  });
});

describe("CueStream", () => {
  it("splits speech into sentences and places tags before the sentence they precede", () => {
    const pieces = run(["[smug 0.7] Name recorded. [gesture nod] [scene light warm] Do not wander off."]);
    expect(pieces).toEqual([
      { type: "cue", cue: { kind: "emotion", value: "smug", intensity: 0.7 } },
      { type: "say", text: "Name recorded." },
      { type: "cue", cue: { kind: "gesture", value: "nod" } },
      { type: "cue", cue: { kind: "scene", args: { op: "light", cue: "warm" } } },
      { type: "say", text: "Do not wander off." },
    ]);
  });

  it("emits a sentence as soon as it is complete, before the rest streams in", () => {
    const s = new CueStream();
    expect(s.push("[grim] One soul")).toEqual([{ type: "cue", cue: { kind: "emotion", value: "grim" } }]);
    expect(s.push(", counted. Two")).toEqual([{ type: "say", text: "One soul, counted." }]);
    expect(s.push(" more")).toEqual([]);
    expect(s.end()).toEqual([{ type: "say", text: "Two more" }]);
  });

  it("reassembles tags split across chunks at any point", () => {
    const text = "[delighted 0.9] Counted! [card show census | The Census | 12 souls] Sign here.";
    const whole = run([text]);
    for (let cut = 1; cut < text.length; cut += 1) {
      expect(run([text.slice(0, cut), text.slice(cut)]), `cut at ${cut}`).toEqual(whole);
    }
    expect(run(text.split(""))).toEqual(whole);
    expect(errors(whole)).toBe(0);
  });

  it("closes a sentence when a tag follows its terminator with no space", () => {
    expect(says(run(["Name recorded.[gesture nod]Next."]))).toEqual(["Name recorded.", "Next."]);
  });

  it("drops malformed and unknown tags, counts them, and never speaks their text", () => {
    const pieces = run(["[dance wildly] Count ", "this ] line. [smug [gesture nod] Done. [light purple]"]);
    expect(says(pieces)).toEqual(["Count this line.", "Done."]);
    expect(errors(pieces)).toBe(4); // unknown tag, stray ], unclosed "[smug ", bad light cue
    expect(pieces).toContainEqual({ type: "cue", cue: { kind: "gesture", value: "nod" } });
    for (const line of says(pieces)) expect(line).not.toMatch(/[[\]]|dance|purple|smug/);
  });

  it("emits a tag at turn end that has no sentence after it", () => {
    const pieces = run(["Goodnight.", " [candles dim]"]);
    expect(pieces).toEqual([
      { type: "say", text: "Goodnight." },
      { type: "cue", cue: { kind: "scene", args: { op: "candles", action: "dim" } } },
    ]);
  });

  it("drops a tag still open at turn end", () => {
    const pieces = run(["Goodnight. [light bl"]);
    expect(says(pieces)).toEqual(["Goodnight."]);
    expect(pieces.at(-1)).toMatchObject({ type: "error", reason: "tag open at turn end" });
  });

  it("gives up on a [ that never closes within the tag limit and keeps the speech", () => {
    const pieces = run([`[${"x".repeat(MAX_TAG_CHARS + 5)} end.`]);
    expect(errors(pieces)).toBe(1);
    expect(says(pieces)).toEqual([`${"x".repeat(MAX_TAG_CHARS + 5)} end.`]);
  });
});
