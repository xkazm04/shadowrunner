import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { castBible, castSlug, castVoice, CAST_VOICES, findRecording, showOf, showRecording } from "./cast.js";
import type { ShowBeat, ShowScript } from "./types.js";
import { VOICE_IDS } from "./voices.js";
import { parseVoiceRequest } from "./validate.js";

const beat = (n: number, replyTo?: string): ShowBeat => ({
  at: n * 1000,
  ...(replyTo === undefined ? {} : { replyTo }),
  reply: { line: `line ${n}`, emotion: "neutral" },
  wav: `x-night/b0${n}.wav`,
});

const show = (slug: string): ShowScript => ({
  id: `${slug}-night`,
  characterId: slug,
  fictional: true,
  audience: [{ id: "a1", user: "U", text: "t", ts: 1, fictional: true }],
  beats: [beat(0), beat(1, "a1"), beat(2)].map((b) => ({ ...b, wav: `${slug}-night/${b.wav.split("/")[1]}` })),
});

describe("cast voices", () => {
  it("gives every cast member one of the five voices, and uses all five", () => {
    expect(new Set(Object.values(CAST_VOICES))).toEqual(new Set(VOICE_IDS));
    expect(castVoice("malakor")).toBe("clerk");
    expect(castVoice("replay-auntie-asp")).toBe(CAST_VOICES["auntie-asp"]);
    expect(castVoice("a-forged-one")).toBeUndefined();
    expect(castVoice("__proto__")).toBeUndefined();
  });

  it("strips the replay- prefix once and only at the start", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(castSlug(`replay-${s}`)).toBe(s);
        expect(castSlug(`x${s}`)).toBe(`x${s}`);
      }),
    );
  });
});

describe("findRecording", () => {
  const bank = (recorded: string[]) => ({ shows: [show("malakor"), show("the-tallyman")], recorded: new Set(recorded) });

  it("finds nothing when nothing is recorded (property: any text, any voice, any character)", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...VOICE_IDS), fc.option(fc.constantFrom("malakor", "the-tallyman", "forged"), { nil: undefined }), (text, voice, id) => {
        expect(findRecording(bank([]), text, voice, id)).toBeUndefined();
      }),
    );
  });

  it("plays only recorded clips, and only in the character's cast voice", () => {
    const b = bank(["malakor-night/b01.wav", "malakor-night/b02.wav"]);
    expect(findRecording(b, "line 1", "clerk", "malakor")).toEqual({ wav: "malakor-night/b01.wav", fallback: false });
    expect(findRecording(b, "line 0", "clerk", "malakor")).toEqual({ wav: "malakor-night/b02.wav", fallback: true });
    expect(findRecording(b, "line 1", "crypt", "malakor")).toBeUndefined();
    expect(findRecording(b, "line 1", "clerk", "the-tallyman")).toBeUndefined();
  });

  it("gives a forged or unnamed speaker only clips recorded in its own voice", () => {
    const b = bank(["malakor-night/b01.wav", "malakor-night/b02.wav"]);
    expect(findRecording(b, "line 1", "clerk")).toEqual({ wav: "malakor-night/b01.wav", fallback: false });
    expect(findRecording(b, "nope", "clerk", "forged")).toEqual({ wav: "malakor-night/b02.wav", fallback: true });
    for (const voice of VOICE_IDS.filter((v) => v !== "clerk")) expect(findRecording(b, "line 1", voice, "forged")).toBeUndefined();
  });

  it("showRecording trims the text and skips beats without a WAV", () => {
    expect(showRecording(show("malakor"), "  line 1 ", new Set(["malakor-night/b01.wav"]))).toEqual({ wav: "malakor-night/b01.wav", fallback: false });
    expect(showRecording(show("malakor"), "line 1", new Set())).toBeUndefined();
  });

  it("showOf matches a slug or a library id", () => {
    const shows = [show("malakor"), show("lot-ninety")];
    expect(showOf(shows, "replay-lot-ninety")?.characterId).toBe("lot-ninety");
    expect(showOf(shows, "nobody")).toBeUndefined();
  });
});

describe("castBible", () => {
  it("is the name, the hook and the character's own generic lines", () => {
    const bible = castBible("The Tallyman", "Counts the room.", show("the-tallyman"));
    expect(bible).toContain("# The Tallyman");
    expect(bible).toContain("Counts the room.");
    expect(bible).toContain("- line 0");
    expect(bible).not.toContain("- line 1");
    expect(castBible("X", "h", undefined)).toContain("# X");
  });
});

describe("parseVoiceRequest characterId", () => {
  it("carries a trimmed, bounded characterId and omits an empty or non-string one", () => {
    expect(parseVoiceRequest({ text: "a", voice: "rasp", characterId: " replay-reveille " })).toEqual({ text: "a", voice: "rasp", characterId: "replay-reveille" });
    expect(parseVoiceRequest({ text: "a", voice: "rasp", characterId: "x".repeat(200) })?.characterId).toHaveLength(64);
    for (const characterId of ["", "  ", 7, null]) expect(parseVoiceRequest({ text: "a", voice: "rasp", characterId })).toEqual({ text: "a", voice: "rasp" });
  });
});
