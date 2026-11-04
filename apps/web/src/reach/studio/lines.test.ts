// Studio lines (spec avatar-reach, design "Testing", studio row): the replay line list for cast and
// forged characters from the committed shows, the typed-line check, and both audio paths.
import { describe, expect, it, vi } from "vitest";
import { castShows } from "../../air/cast";
import type { Fetcher } from "../../app/plane";
import { checkLine, LINE_EMPTY, LINE_MISSING, LINE_TOO_LONG, liveAudio, MAX_LINE_CHARS, recordedAudio, replayLines, slugName, VOICE_FAILED } from "./lines";

describe("replayLines", () => {
  it("offers Malakor his own recorded lines, each with a bundled WAV", () => {
    const { lines, borrowedFrom } = replayLines({ id: "malakor", voice: "clerk" });
    expect(borrowedFrom).toBeUndefined();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.url).toMatch(/malakor-night\/b\d+\.wav$/);
      expect(line.text.length).toBeGreaterThan(0);
    }
    const show = castShows().find((s) => s.characterId === "malakor");
    expect(lines.map((l) => l.text)).toEqual(show?.beats.filter((b) => b.replyTo === undefined).map((b) => b.reply.line));
  });

  it("finds a cast pack's show by its replay- id and uses its own recordings first", () => {
    const shows = castShows();
    const own = replayLines({ id: "replay-the-tallyman", voice: "clerk" }, shows, (wav) => (wav.startsWith("the-tallyman-night/") ? `/x/${wav}` : undefined));
    expect(own.borrowedFrom).toBeUndefined();
    expect(own.lines.length).toBeGreaterThan(0);
    expect(own.lines.every((l) => l.url.startsWith("/x/the-tallyman-night/"))).toBe(true);
  });

  it("borrows lines recorded in the same voice when the character has none, and says whose", () => {
    const tallyman = replayLines({ id: "replay-the-tallyman", voice: "clerk" });
    expect(tallyman.borrowedFrom).toBe("malakor");
    expect(tallyman.lines.length).toBeGreaterThan(0);
    const forged = replayLines({ id: "my-ghost", voice: "clerk" });
    expect(forged.borrowedFrom).toBe("malakor");
  });

  it("has no list for a voice nobody recorded in", () => {
    expect(replayLines({ id: "replay-auntie-asp", voice: "velvet" })).toEqual({ lines: [] });
    expect(replayLines({ id: "my-ghost", voice: "crypt" })).toEqual({ lines: [] });
    // Malakor in another voice: his clips were rendered in clerk only.
    expect(replayLines({ id: "malakor", voice: "crypt" })).toEqual({ lines: [] });
  });

  it("names a borrowed show", () => {
    expect(slugName("the-tallyman")).toBe("The Tallyman");
    expect(slugName("malakor")).toBe("Malakor");
  });
});

describe("typed lines", () => {
  it("trims, refuses empty and over-long lines", () => {
    expect(checkLine("  Hello.  ")).toEqual({ ok: true, text: "Hello." });
    expect(checkLine("   ")).toEqual({ ok: false, error: LINE_EMPTY });
    expect(checkLine("x".repeat(MAX_LINE_CHARS))).toEqual({ ok: true, text: "x".repeat(MAX_LINE_CHARS) });
    expect(checkLine("x".repeat(MAX_LINE_CHARS + 1))).toEqual({ ok: false, error: LINE_TOO_LONG });
    expect(MAX_LINE_CHARS).toBe(300);
  });

  it("asks /api/voice for the line in the character's voice", async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } }));
    const result = await liveAudio(fetcher, " Good evening. ", { id: "replay-auntie-asp", name: "Auntie Asp", voice: "velvet" });
    expect(result.ok && result.bytes.byteLength).toBe(3);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/voice");
    expect(JSON.parse(String(init?.body))).toMatchObject({ text: "Good evening.", voice: "velvet", characterId: "replay-auntie-asp" });
  });

  it("turns voice failures into a sentence and never calls it for an empty line", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 429 }));
    expect(await liveAudio(fetcher, "Hi", { id: "a", name: "A", voice: "clerk" })).toEqual({ ok: false, error: VOICE_FAILED });
    expect(await liveAudio(fetcher, " ", { id: "a", name: "A", voice: "clerk" })).toEqual({ ok: false, error: LINE_EMPTY });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("recordedAudio", () => {
  it("reads the bundled WAV with no /api, and says when it cannot", async () => {
    const line = { text: "t", url: "/assets/b00.wav" };
    const ok = vi.fn(async () => new Response(new Uint8Array([9, 9])));
    expect(await recordedAudio(ok, line)).toMatchObject({ ok: true });
    expect(ok).toHaveBeenCalledWith("/assets/b00.wav");
    expect(await recordedAudio(async () => new Response("", { status: 404 }), line)).toEqual({ ok: false, error: LINE_MISSING });
    expect(
      await recordedAudio(async () => {
        throw new TypeError("offline");
      }, line),
    ).toEqual({ ok: false, error: LINE_MISSING });
  });
});
