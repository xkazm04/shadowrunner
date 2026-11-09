// The recorded shows of the whole cast (replay plane): one fictional show per seeded character, a
// cast voice for each, `recorded.json` equal to the voice clips on disk, and the engine endpoint answering
// each character from its own show. No network, no paid API.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { castVoice, CAST_VOICES, EMOTIONS, MAX_LINE_CHARS, VOICE_IDS, findRecording, type EngineRequest } from "@sr/engine";
import { handleReply } from "../engine/reply.js";
import { replayBank, replayShow, replayShowFor } from "../_lib/show.js";
import { handleVoice } from "../voice.js";

const ROOT = new URL("../../", import.meta.url);
const dirs = (path: string): string[] => readdirSync(new URL(path, ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

/** Malakor, the eight cast-forge characters and the five presets: everything the library seeds. */
const SEEDED = ["malakor", ...dirs("assets/characters/cast"), ...dirs("assets/characters/presets")].sort();

const request = (characterId: string, beat: number): EngineRequest => ({
  characterId,
  persona: { characterId, name: "X", bible: "b", voice: "clerk" },
  chat: [],
  beat,
});

describe("the cast's recorded shows", () => {
  it("covers every seeded character with a voice and a fictional show of its own", () => {
    expect(SEEDED).toHaveLength(14);
    expect(Object.keys(CAST_VOICES).sort()).toEqual(SEEDED);
    for (const slug of SEEDED) {
      const show = replayShowFor(slug);
      expect(show.characterId).toBe(slug);
      expect(show.fictional).toBe(true);
      expect(show.id).toBe(`${slug}-night`);
      expect(VOICE_IDS).toContain(castVoice(slug));
      expect(replayShowFor(`replay-${slug}`)).toBe(show);
    }
    expect(replayShowFor("malakor")).toBe(replayShow());
    expect(replayBank().shows).toHaveLength(SEEDED.length);
  });

  it("gives each character lines that are its own, short enough to speak, and answerable for visitors", () => {
    const seen = new Map<string, string>();
    for (const show of replayBank().shows) {
      expect(show.beats.some((b) => b.replyTo === undefined)).toBe(true);
      for (const beat of show.beats) {
        expect(beat.reply.line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
        expect(EMOTIONS).toContain(beat.reply.emotion);
        expect(beat.wav.startsWith(`${show.id}/`)).toBe(true);
        expect(beat.wav).toMatch(/\.m4a$/); // perfection-pass 10.3: voices ship as AAC
        expect(seen.get(beat.reply.line)).toBeUndefined();
        seen.set(beat.reply.line, show.id);
      }
      expect(show.audience.every((m) => m.fictional === true)).toBe(true);
    }
  });

  it("lists in recorded.json exactly the voice clips (.m4a) on disk, each belonging to a beat", () => {
    const files = dirs("assets/replay/shows").flatMap((d) => readdirSync(new URL(`assets/replay/shows/${d}/`, ROOT)).map((f) => `${d}/${f}`));
    const onDisk = files.filter((f) => f.endsWith(".m4a"));
    // A WAV stays only as a test's PCM source beside its clip (speech.test.ts reads b00.wav); it is never served.
    for (const wav of files.filter((f) => f.endsWith(".wav"))) expect(onDisk).toContain(wav.replace(/\.wav$/, ".m4a"));
    const listed = JSON.parse(readFileSync(new URL("assets/replay/shows/recorded.json", ROOT), "utf8")) as { recorded: string[] };
    expect([...listed.recorded].sort()).toEqual(onDisk.sort());
    const beats = new Set(replayBank().shows.flatMap((s) => s.beats.map((b) => b.wav)));
    for (const wav of listed.recorded) expect(beats.has(wav)).toBe(true);
  });

  it("answers each character from its own show on /api/engine/reply, with zero network calls", async () => {
    const never = () => {
      throw new Error("no network on replay");
    };
    for (const slug of SEEDED) {
      for (const id of [slug, `replay-${slug}`]) {
        const res = await handleReply(
          new Request("https://sr.test/api/engine/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request(id, 0)) }),
          { env: {}, fetch: never, quota: { checkAndCharge: never } },
        );
        expect(await res.json()).toEqual(replayShowFor(slug).beats[0]?.reply);
      }
    }
  });

  it("serves a recording for a line only where its WAV exists, in the voice it was rendered with", () => {
    const bank = replayBank();
    const malakor = replayShow();
    const line = malakor.beats[2]?.reply.line ?? "";
    expect(findRecording(bank, line, "clerk", "malakor")).toEqual({ wav: malakor.beats[2]?.wav, fallback: false });
    for (const slug of SEEDED.filter((s) => s !== "malakor")) {
      const own = replayShowFor(slug).beats[0]?.reply.line ?? "";
      // Today only Malakor's WAVs exist: every other character is caption-only until rendered.
      expect(findRecording(bank, own, castVoice(slug) ?? "clerk", slug)).toBeUndefined();
    }
    // Pretend one of the Tallyman's lines were recorded: it plays for him and for nobody else.
    const tally = replayShowFor("the-tallyman");
    const wav = tally.beats[0]?.wav ?? "";
    const withClip = { shows: bank.shows, recorded: new Set([...bank.recorded, wav]) };
    const text = tally.beats[0]?.reply.line ?? "";
    expect(findRecording(withClip, text, "clerk", "the-tallyman")).toEqual({ wav, fallback: false });
    expect(findRecording(withClip, text, "clerk", "replay-the-tallyman")).toEqual({ wav, fallback: false });
    expect(findRecording(withClip, text, "velvet", "the-tallyman")).toBeUndefined();
    expect(findRecording(withClip, "anything", "clerk", "the-redactor")).toBeUndefined();
  });

  it("makes /api/voice 404 for each non-Malakor character today and 303 for Malakor", async () => {
    const post = (payload: unknown) =>
      new Request("https://sr.test/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const deps = { env: {}, fetch: () => Promise.reject(new Error("no network")), quota: { checkAndCharge: () => Promise.reject(new Error("no charge")) } };
    for (const slug of SEEDED) {
      const text = replayShowFor(slug).beats[0]?.reply.line ?? "";
      const res = await handleVoice(post({ text, voice: castVoice(slug), characterId: slug }), deps);
      expect(res.status).toBe(slug === "malakor" ? 303 : 404);
    }
  });
});
