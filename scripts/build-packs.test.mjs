// build-packs (avatar-pack design "Testing"): two cast folders into a temp dir twice give identical
// bytes, malakor is skipped, and every pack passes readPack. companion-lanes: the companion jobs
// (assets/replay/companions) pack beside the cast with their morph files and their own voices.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPacks, COMPANION_VOICES } from "./build-packs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FORGE = join(ROOT, "assets", "replay", "forge");
const CAST = ["lantern-warden", "moth-widow"];
const COMPANIONS_SRC = join(ROOT, "assets", "replay", "companions");
const COMPANIONS = ["bun", "iris"];
const packModule = async () => (await runnerImport("/packages/pack/src/index.ts", { configFile: false, root: ROOT, logLevel: "warn" })).module;

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
      // The web's packUrlOf(castSlugOf(entry)) is `/packs/<file minus extension>.srpack`: it must be this file, whatever the id.
      expect(`${entry.file.replace(/.srpack$/, "")}.srpack`).toBe(entry.file);
      expect(readdirSync(join(tmp, "a"))).toContain(entry.file);
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

  it("packs the companions beside the cast, with their morph files and companion voices", async () => {
    const companions = join(tmp, "companions");
    for (const slug of COMPANIONS) cpSync(join(COMPANIONS_SRC, slug), join(companions, slug), { recursive: true });
    const index = await buildPacks(forge, join(tmp, "d"), companions);
    expect(index.map((entry) => entry.file)).toEqual(["bun.srpack", "iris.srpack", "lantern-warden.srpack", "moth-widow.srpack"]);
    const again = await buildPacks(forge, join(tmp, "e"), companions);
    expect(again).toEqual(index);
    const pack = await packModule();
    for (const slug of COMPANIONS) {
      const bytes = readFileSync(join(tmp, "d", `${slug}.srpack`));
      expect(bytes.equals(readFileSync(join(tmp, "e", `${slug}.srpack`))), slug).toBe(true);
      const read = await pack.readPack(new Uint8Array(bytes));
      expect(read.ok, slug).toBe(true);
      if (!read.ok) continue;
      const { rig, manifest, files } = read.pack;
      expect(manifest).toMatchObject({ id: slug, fictional: true, author: "Shadowrunner companions" });
      expect(read.pack.voice).toBe(COMPANION_VOICES[slug]);
      expect(rig.morph).toBeDefined();
      for (const name of [rig.morph.atlas, rig.morph.flow, rig.morph.sway?.map].filter(Boolean)) expect(Object.keys(files), `${slug} ${name}`).toContain(name);
    }
    // Neither joins the Halloween cast's voices.
    const { module: engine } = await runnerImport("/packages/engine/src/index.ts", { configFile: false, root: ROOT, logLevel: "warn" });
    for (const slug of COMPANIONS) expect(engine.castVoice(slug)).toBeUndefined();
  }, 30_000);

  it("fails when a companion's morph image is missing", async () => {
    const companions = join(tmp, "companions-broken");
    cpSync(join(COMPANIONS_SRC, "iris"), join(companions, "iris"), { recursive: true });
    const job = JSON.parse(readFileSync(join(companions, "iris", "job.json"), "utf8"));
    rmSync(join(companions, "iris", job.rig.morph.atlas));
    await expect(buildPacks(forge, join(tmp, "f"), companions)).rejects.toThrow(/missing the morph image/);
  }, 30_000);
});
