// build-packs (avatar-pack design "Testing"): two cast folders into a temp dir twice give identical
// bytes, malakor is skipped, and every pack passes readPack.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPacks } from "./build-packs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FORGE = join(ROOT, "assets", "replay", "forge");
const CAST = ["lantern-warden", "moth-widow"];

describe("buildPacks", () => {
  let tmp;
  let forge;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "sr-build-packs-"));
    forge = join(tmp, "forge");
    for (const slug of CAST) cpSync(join(FORGE, slug), join(forge, slug), { recursive: true });
    // Not a rig at all: the build would fail on it if it were not skipped.
    mkdirSync(join(forge, "malakor"), { recursive: true });
    writeFileSync(join(forge, "malakor", "job.json"), "{}\n");
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("writes the same bytes twice, skips malakor, and every pack reads back", async () => {
    const first = await buildPacks(forge, join(tmp, "a"));
    const second = await buildPacks(forge, join(tmp, "b"));
    expect(first.map((entry) => entry.file)).toEqual(["lantern-warden.srpack", "moth-widow.srpack"]);
    expect(second).toEqual(first);
    expect(readdirSync(join(tmp, "a")).sort()).toEqual(["index.json", "lantern-warden.srpack", "moth-widow.srpack"]);
    expect(readFileSync(join(tmp, "a", "index.json")).equals(readFileSync(join(tmp, "b", "index.json")))).toBe(true);

    const { module: pack } = await runnerImport("/packages/pack/src/index.ts", { configFile: false, root: ROOT, logLevel: "warn" });
    for (const entry of first) {
      const bytes = readFileSync(join(tmp, "a", entry.file));
      expect(bytes.equals(readFileSync(join(tmp, "b", entry.file))), entry.file).toBe(true);
      expect(bytes.length).toBe(entry.bytes);
      const read = await pack.readPack(new Uint8Array(bytes));
      expect(read.ok, entry.file).toBe(true);
      if (!read.ok) continue;
      expect(read.pack.manifest).toMatchObject({ id: entry.id, name: entry.name, licence: "all-rights-reserved", author: "Shadowrunner cast", fictional: true });
      expect(read.pack.manifest.exportedAt).toBe("2026-11-04T00:00:00.000Z");
      for (const layer of read.pack.rig.layers) expect(Object.keys(read.pack.files)).toContain(layer.file);
    }
  });

  it("fails when a layer image is missing", async () => {
    const broken = join(tmp, "broken");
    cpSync(join(FORGE, CAST[0]), join(broken, CAST[0]), { recursive: true });
    const job = JSON.parse(readFileSync(join(broken, CAST[0], "job.json"), "utf8"));
    rmSync(join(broken, CAST[0], job.rig.layers[0].file));
    await expect(buildPacks(broken, join(tmp, "c"))).rejects.toThrow(/missing the layer image/);
  });
});
