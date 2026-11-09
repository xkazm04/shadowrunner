// Each script line decoded once (perfection-pass task 6): in order, cached by what makes the
// sound, the first failure named by its line, and nothing fetched after it.
import { describe, expect, it, vi } from "vitest";
import { CLIP_CACHE, decodeScript, NO_AUDIO, type ClipCache, type ClipDeps } from "./clips";
import type { ScriptLine } from "./script";

function deps(over: Partial<ClipDeps> = {}) {
  const fetchLine = vi.fn<ClipDeps["fetchLine"]>(async () => ({ ok: true as const, bytes: new ArrayBuffer(4) }));
  const decode = vi.fn(async () => ({ duration: 1 }) as AudioBuffer);
  const d: ClipDeps = { context: { decodeAudioData: decode }, keyOf: (line) => line.url ?? line.text, fetchLine, analyse: () => undefined, ...over };
  return { d, fetchLine, decode };
}

const lines: ScriptLine[] = [
  { text: "One", url: "/1.m4a" },
  { text: "Two", url: "/2.m4a", emotion: "grim" },
];

describe("decodeScript", () => {
  it("decodes every line in order and asks for nothing twice", async () => {
    const cache: ClipCache = new Map();
    const { d, fetchLine } = deps();
    const first = await decodeScript(lines, cache, d);
    expect(first.ok && first.decoded).toHaveLength(2);
    expect(fetchLine.mock.calls.map(([line]) => line.url)).toEqual(["/1.m4a", "/2.m4a"]);
    await decodeScript([lines[1] ?? lines[0] ?? { text: "" }, ...lines], cache, d);
    expect(fetchLine).toHaveBeenCalledTimes(2);
  });

  it("names the line that failed and fetches nothing after it", async () => {
    const { d, fetchLine } = deps();
    fetchLine.mockResolvedValueOnce({ ok: true, bytes: new ArrayBuffer(4) }).mockResolvedValueOnce({ ok: false, error: "That recorded line could not be loaded." });
    const result = await decodeScript([...lines, { text: "Three", url: "/3.m4a" }], new Map(), d);
    expect(result).toEqual({ ok: false, error: "Line 2: That recorded line could not be loaded." });
    expect(fetchLine).toHaveBeenCalledTimes(2);
  });

  it("says a clip that will not decode cannot be played (no line number for a one-line script)", async () => {
    const { d } = deps({ context: { decodeAudioData: async () => Promise.reject(new Error("EncodingError")) } });
    expect(await decodeScript([{ text: "One", url: "/1.m4a" }], new Map(), d)).toEqual({ ok: false, error: NO_AUDIO });
  });

  it("keeps the cache bounded", async () => {
    const cache: ClipCache = new Map();
    const { d } = deps();
    const many = Array.from({ length: CLIP_CACHE + 4 }, (_, i) => ({ text: `L${i}`, url: `/${i}` }));
    await decodeScript(many, cache, d);
    expect(cache.size).toBe(CLIP_CACHE);
    expect(cache.has("/0")).toBe(false);
  });
});
