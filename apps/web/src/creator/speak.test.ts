import { describe, expect, it } from "vitest";
import { lineAt, linesOf, loadLines } from "./speak";

describe("speak a line", () => {
  it("offers the committed show's standalone lines, each with a WAV", async () => {
    const lines = await loadLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.url).toMatch(/\.wav$/);
      expect(line.reply.line.length).toBeGreaterThan(0);
    }
  });

  it("skips lines that answer a viewer, and refuses a show that does not validate", () => {
    const beat = (wav: string, replyTo?: string) => ({ at: 0, wav, reply: { line: wav, emotion: "grim" }, ...(replyTo ? { replyTo } : {}) });
    const show = { id: "s", characterId: "c", fictional: true, audience: [{ id: "a01", user: "Moth", text: "hi", ts: 0, fictional: true }], beats: [beat("s/a.wav"), beat("s/b.wav", "a01")] };
    expect(linesOf(show, (w) => `/${w}`).map((l) => l.url)).toEqual(["/s/a.wav"]);
    expect(linesOf({ ...show, fictional: false }, (w) => w)).toEqual([]);
  });

  it("cycles through the lines", () => {
    const lines = [1, 2, 3].map((n) => ({ url: `${n}`, reply: { line: `${n}`, emotion: "grim" as const } }));
    expect([0, 1, 2, 3, 4].map((n) => lineAt(lines, n)?.url)).toEqual(["1", "2", "3", "1", "2"]);
    expect(lineAt([], 0)).toBeUndefined();
  });
});
