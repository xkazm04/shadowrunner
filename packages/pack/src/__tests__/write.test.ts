// avatar-pack task 1: writePack -> readPack round trip, byte determinism, the container layout,
// data: layers moved to files/, and images the rig does not reference dropped.
import { serializeRig, validateRig } from "@sr/rig";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readPack, writePack } from "../index.js";
import { bytesFor, packInput, packRig, readJson } from "./fixtures.js";

const blobBytes = async (blob: Blob | undefined): Promise<Uint8Array> => new Uint8Array(await (blob ?? new Blob()).arrayBuffer());

describe("writePack", () => {
  it("round trips: read gives back the rig, look, voice and every image's bytes", async () => {
    const input = packInput();
    const result = await readPack(await writePack(input));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pack } = result;
    const checked = validateRig(input.rig);
    expect(checked.ok && pack.rig).toEqual(checked.ok && checked.value);
    expect(pack.look).toEqual(input.look);
    expect(pack.voice).toBe("crypt");
    expect(Object.keys(pack.files).sort()).toEqual(["head.joy.webp", "head.regions.png", "head.webp", "jaw.png", "torso.png"]);
    for (const [name, blob] of Object.entries(pack.files)) expect(await blobBytes(blob)).toEqual(bytesFor(name));
    expect(pack.files["head.webp"]?.type).toBe("image/webp");
    expect(pack.files["torso.png"]?.type).toBe("image/png");
  });

  it("writes the manifest with optional fields omitted, author trimmed, files sorted", async () => {
    const entries = unzipSync(await writePack(packInput()));
    expect(Object.keys(entries)).toEqual([
      "pack.json",
      "rig.json",
      "README.txt",
      "files/head.joy.webp",
      "files/head.regions.png",
      "files/head.webp",
      "files/jaw.png",
      "files/torso.png",
    ]);
    const text = new TextDecoder().decode(entries["pack.json"]);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "format": "srpack",');
    const manifest = readJson(entries["pack.json"]);
    expect(Object.keys(manifest)).toEqual(["format", "version", "app", "exportedAt", "id", "name", "look", "voice", "licence", "author", "source", "fictional", "createdAt", "files"]);
    expect(manifest).toMatchObject({ format: "srpack", version: 1, app: "shadowrunner", id: "test-ghost", name: "Test Ghost", author: "Ada", fictional: true });
    expect(manifest.files).toEqual(["head.joy.webp", "head.regions.png", "head.webp", "jaw.png", "torso.png"]);
    expect(new TextDecoder().decode(entries["rig.json"])).toBe(serializeRig(packRig()));
    expect(new TextDecoder().decode(entries["README.txt"])).toContain("Test Ghost");

    const { fictional, ...rig } = packRig();
    void fictional;
    const bare = readJson(unzipSync(await writePack(packInput({ rig, author: " ", createdAt: undefined })))["pack.json"]);
    expect(bare).not.toHaveProperty("author");
    expect(bare).not.toHaveProperty("fictional");
    expect(bare).not.toHaveProperty("createdAt");
    expect(JSON.stringify(bare)).not.toContain("null");
  });

  it("is byte-deterministic, stores entries uncompressed and stamps 2026-01-01 00:00", async () => {
    const a = await writePack(packInput());
    const b = await writePack(packInput());
    expect(a).toEqual(b);
    const view = new DataView(a.buffer, a.byteOffset, a.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // stored
    expect(view.getUint16(10, true)).toBe(0); // 00:00:00
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (1 << 5) | 1);
  });

  it("drops images the rig does not reference and keeps absent maps and patches absent", async () => {
    const input = packInput();
    const { ["head.regions.png"]: _map, ["head.joy.webp"]: _joy, ...files } = input.files;
    void _map;
    void _joy;
    const entries = unzipSync(await writePack({ ...input, files }));
    expect(Object.keys(entries).filter((k) => k.startsWith("files/"))).toEqual(["files/head.webp", "files/jaw.png", "files/torso.png"]);
    expect(readJson(entries["pack.json"]).files).toEqual(["head.webp", "jaw.png", "torso.png"]);
    const result = await readPack(await writePack({ ...input, files }));
    expect(result.ok && Object.keys(result.pack.files).sort()).toEqual(["head.webp", "jaw.png", "torso.png"]);
  });

  it("moves a data: layer image to files/<layer>.<ext> and rewrites the rig", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9]);
    const toUrl = (type: string, bytes: Uint8Array): string => `data:image/${type};base64,${btoa(String.fromCharCode(...bytes))}`;
    const base = packRig();
    const rig = {
      ...base,
      layers: base.layers.map((l) => (l.name === "jaw" ? { ...l, file: toUrl("png", png) } : l.name === "torso" ? { ...l, file: toUrl("webp", webp) } : l)),
    };
    const result = await readPack(await writePack(packInput({ rig })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.rig.layers.find((l) => l.name === "jaw")?.file).toBe("jaw.png");
    expect(result.pack.rig.layers.find((l) => l.name === "torso")?.file).toBe("torso.webp");
    expect(await blobBytes(result.pack.files["jaw.png"])).toEqual(png);
    expect(await blobBytes(result.pack.files["torso.webp"])).toEqual(webp);
    expect(result.pack.manifest.files).not.toContain("torso.png");
  });

  it("names a moved data: image apart from a file the rig already uses", async () => {
    const base = packRig();
    const url = `data:image/png;base64,${btoa("x")}`;
    const rig = { ...base, layers: base.layers.map((l) => (l.name === "torso" ? { ...l, name: "jaw2", file: url } : l.name === "jaw" ? { ...l, file: "jaw2.png" } : l)) };
    const result = await readPack(await writePack(packInput({ rig, files: { ...packInput().files, "jaw2.png": bytesFor("jaw2.png") } })));
    expect(result.ok && result.pack.rig.layers.map((l) => l.file)).toEqual(["jaw2-2.png", "head.webp", "jaw2.png"]);
  });

  it("throws when a layer image is missing (a caller bug)", async () => {
    const input = packInput();
    const { ["jaw.png"]: _jaw, ...files } = input.files;
    void _jaw;
    await expect(writePack({ ...input, files })).rejects.toThrow(/jaw\.png/);
  });
});
