// Playable (spec avatar-reach, design "Playable" / "Testing"): slug vs URL, the pack / file /
// library paths, and every failure as a sentence. fetch and createImageBitmap are stubbed; the
// library is the in-memory twin.
import { writePack } from "@sr/pack";
import { defaultLook } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryLibrary, type CharacterRecord, type LibraryStore } from "../creator/library/libraryStore";
import { testRig } from "../creator/testFixtures";
import { castFirst, castSlugOf, DAMAGED_RECORD, loadCastIndex, loadPlayable, NOT_IN_LIBRARY, packUrlOf, UNDECODABLE } from "./playable";

const lib = vi.hoisted(() => ({ store: undefined as LibraryStore | undefined }));

vi.mock("../creator/library/libraryStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../creator/library/libraryStore")>();
  return { ...actual, openLibrary: async () => lib.store ?? actual.memoryLibrary() };
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function record(id = "ghost"): CharacterRecord {
  const rig = testRig(id, "Test Ghost");
  const assets: Record<string, Blob> = {};
  for (const layer of rig.layers) assets[layer.file] = new Blob([PNG], { type: "image/png" });
  return { id, rig, assets, look: { ...defaultLook(rig), emotion: "smug" }, voice: "velvet", createdAt: "2026-11-01T00:00:00.000Z" };
}

async function packBytes(voice = "velvet", author?: string): Promise<Uint8Array<ArrayBuffer>> {
  const r = record();
  return new Uint8Array(await writePack({ rig: r.rig, look: r.look, voice, files: r.assets, licence: "CC-BY-4.0", ...(author === undefined ? {} : { author }) }));
}

let fetched: string[];
let bitmaps: number;

function serve(routes: Record<string, () => Response>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    const route = routes[url];
    return route === undefined ? new Response("missing", { status: 404 }) : route();
  });
}

beforeEach(() => {
  fetched = [];
  bitmaps = 0;
  lib.store = undefined;
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close: () => undefined, n: ++bitmaps }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("packUrlOf", () => {
  it.each([
    ["the-tallyman", "/packs/the-tallyman.srpack"],
    ["saint-cardia2", "/packs/saint-cardia2.srpack"],
    ["https://example.com/a.srpack", "https://example.com/a.srpack"],
    ["/packs/the-tallyman.srpack", "/packs/the-tallyman.srpack"],
    ["The-Tallyman", "The-Tallyman"],
  ])("%s -> %s", (pack, url) => {
    expect(packUrlOf(pack)).toBe(url);
  });
});

describe("loadPlayable", () => {
  it("loads a cast slug from /packs/<slug>.srpack, decoding every image", async () => {
    const bytes = await packBytes("velvet", "Ada");
    serve({ "/packs/ghost.srpack": () => new Response(bytes) });
    const result = await loadPlayable({ pack: "ghost" });
    expect(fetched).toEqual(["/packs/ghost.srpack"]);
    if (!result.ok) throw new Error(result.error);
    const { playable } = result;
    expect(playable).toMatchObject({ id: "ghost", name: "Test Ghost", voice: "velvet", licence: "CC-BY-4.0", author: "Ada" });
    expect(playable.look.emotion).toBe("smug");
    expect(Object.keys(playable.assets).sort()).toEqual(playable.rig.layers.map((l) => l.file).sort());
    expect(bitmaps).toBe(playable.rig.layers.length);
  });

  it("loads a pack URL as given, and falls back to the default voice for an unknown one", async () => {
    const bytes = await packBytes("someone-else");
    serve({ "https://cdn.example/x.srpack": () => new Response(bytes) });
    const result = await loadPlayable({ pack: "https://cdn.example/x.srpack" });
    expect(result.ok && result.playable.voice).toBe("crypt");
    expect(result.ok && "author" in result.playable).toBe(false);
  });

  it("loads an uploaded file without fetching", async () => {
    serve({});
    const result = await loadPlayable({ file: new Blob([await packBytes()]) });
    expect(result.ok && result.playable.id).toBe("ghost");
    expect(fetched).toEqual([]);
  });

  it.each([
    ["a 404", () => serve({}), { pack: "nobody" }, "That pack could not be fetched."],
    ["not a pack", () => serve({ "/packs/junk.srpack": () => new Response("hello") }), { pack: "junk" }, "That file is not a Shadowrunner pack."],
    ["a network error", () => vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline"))), { pack: "ghost" }, "That pack could not be fetched."],
  ])("answers %s with the import sentence", async (_label, arrange, source, sentence) => {
    arrange();
    expect(await loadPlayable(source)).toEqual({ ok: false, error: sentence });
  });

  it("answers images that will not decode with a sentence", async () => {
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("bad png")));
    expect(await loadPlayable({ file: new Blob([await packBytes()]) })).toEqual({ ok: false, error: UNDECODABLE });
  });

  it("loads a library character by id", async () => {
    lib.store = memoryLibrary();
    await lib.store.put(record("ghost"));
    const result = await loadPlayable({ character: "ghost" });
    if (!result.ok) throw new Error(result.error);
    expect(result.playable).toMatchObject({ id: "ghost", name: "Test Ghost", voice: "velvet" });
    expect(result.playable.licence).toBeUndefined();
    expect(Object.keys(result.playable.assets)).toHaveLength(result.playable.rig.layers.length);
  });

  it("answers a missing or damaged library character with a sentence", async () => {
    lib.store = memoryLibrary();
    expect(await loadPlayable({ character: "nobody" })).toEqual({ ok: false, error: NOT_IN_LIBRARY });
    const broken = record("broken");
    await lib.store.put({ ...broken, assets: {} });
    expect(await loadPlayable({ character: "broken" })).toEqual({ ok: false, error: DAMAGED_RECORD });
  });
});

describe("castSlugOf", () => {
  it("names the pack by its file, not its id, so the player url reaches the built file", () => {
    const entry = { id: "replay-the-tallyman", name: "The Tallyman", file: "the-tallyman.srpack", bytes: 1 };
    expect(castSlugOf(entry)).toBe("the-tallyman");
    expect(packUrlOf(castSlugOf(entry))).toBe(`/packs/${entry.file}`);
  });
});

describe("loadCastIndex", () => {
  it("reads /packs/index.json, dropping malformed entries", async () => {
    const good = { id: "the-tallyman", name: "The Tallyman", file: "the-tallyman.srpack", bytes: 1234 };
    serve({ "/packs/index.json": () => Response.json([good, { id: 3 }, null]) });
    expect(await loadCastIndex()).toEqual([good]);
    expect(fetched).toEqual(["/packs/index.json"]);
  });

  it("lists the cast first and the companions after it, marked (companion-lanes 5.3: never in the cast's list)", async () => {
    const bun = { id: "bun", name: "Bun", file: "bun.srpack", bytes: 1 };
    const iris = { id: "iris", name: "Iris", file: "iris.srpack", bytes: 1 };
    const asp = { id: "replay-auntie-asp", name: "Auntie Asp", file: "auntie-asp.srpack", bytes: 1 };
    const tally = { id: "replay-the-tallyman", name: "The Tallyman", file: "the-tallyman.srpack", bytes: 1 };
    serve({ "/packs/index.json": () => Response.json([bun, iris, asp, tally]) });
    expect(await loadCastIndex()).toEqual([asp, tally, { ...bun, companion: true }, { ...iris, companion: true }]);
    expect(castFirst([tally, asp])).toEqual([tally, asp]);
  });

  it.each([
    ["a 404", () => serve({})],
    ["not JSON", () => serve({ "/packs/index.json": () => new Response("<html>") })],
    ["not a list", () => serve({ "/packs/index.json": () => Response.json({ packs: [] }) })],
    ["a network error", () => vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")))],
  ])("is [] on %s", async (_label, arrange) => {
    arrange();
    expect(await loadCastIndex()).toEqual([]);
  });
});
