// avatar-pack task 1: readPack's error codes from crafted zips (in the documented check order),
// loadPack over a stub fetch, decodePackImages over a stubbed createImageBitmap, and the names.
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePackImages, loadPack, PACK_MAX_BYTES, packFileName, packReadme, readPack, writePack, type PackErrorCode, type PackResult } from "../index.js";
import { craft, packInput, readJson, writeJson } from "./fixtures.js";

const good = (): Promise<Uint8Array> => writePack(packInput());
const codeOf = (result: PackResult): PackErrorCode | "ok" => (result.ok ? "ok" : result.error.code);
const manifestEdit = (edit: (m: Record<string, unknown>) => void) => (entries: Record<string, Uint8Array>) => {
  const manifest = readJson(entries["pack.json"]);
  edit(manifest);
  entries["pack.json"] = writeJson(manifest);
};

describe("readPack errors", () => {
  it("too_large: over the byte limit, before anything else", async () => {
    expect(codeOf(await readPack(new Uint8Array(PACK_MAX_BYTES + 1)))).toBe("too_large");
  });

  it("not_a_pack: junk bytes, a zip without pack.json, bad JSON, another format", async () => {
    expect(codeOf(await readPack(new TextEncoder().encode("hello")))).toBe("not_a_pack");
    expect(codeOf(await readPack(zipSync({ "a.txt": new Uint8Array([1]) })))).toBe("not_a_pack");
    const pack = await good();
    expect(codeOf(await readPack(craft(pack, (e) => void (e["pack.json"] = new TextEncoder().encode("{")))))).toBe("not_a_pack");
    expect(codeOf(await readPack(craft(pack, manifestEdit((m) => void (m.format = "zip")))))).toBe("not_a_pack");
  });

  it("newer_version: a version past 1", async () => {
    const result = await readPack(craft(await good(), manifestEdit((m) => void (m.version = 2))));
    expect(codeOf(result)).toBe("newer_version");
  });

  it.each<[string, (m: Record<string, unknown>) => void]>([
    ["version 0", (m) => void (m.version = 0)],
    ["empty name", (m) => void (m.name = "")],
    ["unknown licence", (m) => void (m.licence = "MIT")],
    ["files not strings", (m) => void (m.files = [1])],
    ["no files", (m) => void delete m.files],
    ["null author", (m) => void (m.author = null)],
    ["bad source", (m) => void (m.source = "web")],
    ["id unlike the rig", (m) => void (m.id = "someone-else")],
  ])("bad_manifest: %s", async (_label, edit) => {
    expect(codeOf(await readPack(craft(await good(), manifestEdit(edit))))).toBe("bad_manifest");
  });

  it("bad_rig: missing or invalid rig.json, detail names the first error's path", async () => {
    const pack = await good();
    expect(codeOf(await readPack(craft(pack, (e) => void delete e["rig.json"])))).toBe("bad_rig");
    const result = await readPack(
      craft(pack, (e) => {
        const rig = readJson(e["rig.json"]);
        rig.width = -1;
        e["rig.json"] = writeJson(rig);
      }),
    );
    expect(codeOf(result)).toBe("bad_rig");
    expect(!result.ok && result.error.detail).toMatch(/width/);
  });

  it("bad_look: a look that does not read", async () => {
    const result = await readPack(craft(await good(), manifestEdit((m) => void (m.look = { emotion: "sad" }))));
    expect(codeOf(result)).toBe("bad_look");
  });

  it("missing_file: a layer image absent, detail is its name; an absent map or patch is fine", async () => {
    const pack = await good();
    const result = await readPack(craft(pack, (e) => void delete e["files/jaw.png"]));
    expect(result).toEqual({ ok: false, error: { code: "missing_file", detail: "jaw.png" } });
    const lean = await readPack(
      craft(pack, (e) => {
        delete e["files/head.regions.png"];
        delete e["files/head.joy.webp"];
        e["files/extra.png"] = new Uint8Array([7]);
      }),
    );
    expect(lean.ok && Object.keys(lean.pack.files).sort()).toEqual(["head.webp", "jaw.png", "torso.png"]);
  });

  it("reads a Blob and an ArrayBuffer the same as bytes", async () => {
    const pack = await good();
    expect(codeOf(await readPack(new Blob([pack as BlobPart])))).toBe("ok");
    expect(codeOf(await readPack(pack.slice().buffer))).toBe("ok");
  });
});

describe("loadPack", () => {
  const stub = (respond: () => Promise<Response>) => vi.fn<typeof fetch>(respond);

  it("fetches a URL: 2xx reads the pack, 404 and a thrown error are fetch_failed", async () => {
    const pack = await good();
    const ok = stub(async () => new Response(pack as BodyInit, { status: 200 }));
    expect(codeOf(await loadPack("https://example.test/a.srpack", { fetch: ok }))).toBe("ok");
    expect(ok).toHaveBeenCalledWith("https://example.test/a.srpack", undefined);
    const missing = await loadPack(new URL("https://example.test/b.srpack"), { fetch: stub(async () => new Response("no", { status: 404 })) });
    expect(missing).toEqual({ ok: false, error: { code: "fetch_failed", detail: "https://example.test/b.srpack: HTTP 404" } });
    const thrown = await loadPack("/packs/c.srpack", { fetch: stub(() => Promise.reject(new TypeError("offline"))) });
    expect(codeOf(thrown)).toBe("fetch_failed");
    expect(!thrown.ok && thrown.error.detail).toContain("offline");
  });

  it("passes the signal and reads a Blob without fetching", async () => {
    const signal = new AbortController().signal;
    const fetcher = stub(async () => new Response((await good()) as BodyInit, { status: 200 }));
    await loadPack("/p.srpack", { fetch: fetcher, signal });
    expect(fetcher).toHaveBeenCalledWith("/p.srpack", { signal });
    const unused = stub(async () => new Response(null, { status: 500 }));
    expect(codeOf(await loadPack(new Blob([(await good()) as BlobPart]), { fetch: unused }))).toBe("ok");
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("decodePackImages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes every file premultiplied, keyed by name", async () => {
    const decoded = (blob: Blob, options?: ImageBitmapOptions): ImageBitmap => ({ width: 1, height: 1, close: () => undefined, blob, options }) as ImageBitmap;
    const decode = vi.fn(async (blob: Blob, options?: ImageBitmapOptions) => decoded(blob, options));
    vi.stubGlobal("createImageBitmap", decode);
    const a = new Blob(["a"]);
    const b = new Blob(["b"]);
    const out = await decodePackImages({ "a.png": a, "b.webp": b });
    expect(Object.keys(out).sort()).toEqual(["a.png", "b.webp"]);
    expect(out["a.png"]).toMatchObject({ blob: a, options: { premultiplyAlpha: "premultiply" } });
    expect(decode).toHaveBeenCalledTimes(2);
    // companion-lanes: with the rig, a morph's motion image and sway map are decoded as data.
    const morph = { layer: "head", atlas: "a.png", flow: "b.webp", keys: [], eyes: [[0, 0], [1, 0]] as [[number, number], [number, number]], sway: { map: "c.png", amp: 1 } };
    const raw = await decodePackImages({ "a.png": a, "b.webp": b, "c.png": a }, { morph });
    expect(raw["a.png"]).toMatchObject({ options: { premultiplyAlpha: "premultiply" } });
    expect(raw["b.webp"]).toMatchObject({ options: { premultiplyAlpha: "none", colorSpaceConversion: "none" } });
    expect(raw["c.png"]).toMatchObject({ options: { premultiplyAlpha: "none", colorSpaceConversion: "none" } });
  });
});

describe("names and README", () => {
  it.each([
    ["Test Ghost", "test-ghost.srpack"],
    ["  Saint Cärdia!! ", "saint-cardia.srpack"],
    ["???", "character.srpack"],
    ["", "character.srpack"],
    ["a".repeat(80), `${"a".repeat(60)}.srpack`],
  ])("packFileName(%j) = %s", (name, want) => {
    expect(packFileName(name)).toBe(want);
  });

  it("the README names the character, licence, author and the fictional note", async () => {
    const result = await readPack(await good());
    if (!result.ok) throw new Error(result.error.detail);
    const text = packReadme(result.pack.manifest);
    expect(text).toContain("Test Ghost");
    expect(text).toContain("CC BY 4.0");
    expect(text).toContain("Author: Ada");
    expect(text).toContain("fictional");
    expect(text).toContain("pack-format.md");
  });
});
