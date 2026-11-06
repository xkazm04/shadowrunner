// face-from-pack (face-control): a pack exported with a tuned Look.face, baked into a copy of a cast
// job.json: --dry-run writes nothing, a real run writes rig.face over the job's own profile and
// changes nothing else in the file (same line ending, same bytes outside the new key), a pack
// without a face leaves the job untouched.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { faceFromPack } from "./face-from-pack.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SLUG = "moth-widow";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("faceFromPack", () => {
  let tmp;
  let forge;
  let jobPath;
  let original;
  let mod;
  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "sr-face-from-pack-"));
    forge = join(tmp, "forge");
    mkdirSync(join(forge, SLUG), { recursive: true });
    jobPath = join(forge, SLUG, "job.json");
    original = readFileSync(join(ROOT, "assets", "replay", "forge", SLUG, "job.json"));
    const config = { configFile: false, root: ROOT, logLevel: "warn" };
    const [{ module: pack }, { module: rig }] = await Promise.all([runnerImport("/packages/pack/src/index.ts", config), runnerImport("/packages/rig/src/index.ts", config)]);
    mod = { pack, rig };
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  async function writeTestPack(name, face, eol = "\n") {
    writeFileSync(jobPath, eol === "\n" ? original : Buffer.from(original.toString("utf8").replace(/\n/g, "\r\n")));
    const job = JSON.parse(original.toString("utf8"));
    const files = Object.fromEntries(job.rig.layers.map((l) => [l.file, new Blob([PNG], { type: "image/png" })]));
    const look = { ...mod.rig.defaultLook(job.rig), ...(face === undefined ? {} : { face }) };
    const bytes = await mod.pack.writePack({ rig: job.rig, look, voice: "crypt", files, licence: "CC0-1.0", createdAt: "2026-11-06T00:00:00.000Z" });
    const path = join(tmp, name);
    writeFileSync(path, bytes);
    return path;
  }

  const quiet = () => {
    const lines = [];
    return { lines, log: (line) => lines.push(line) };
  };

  it("--dry-run prints the diff and writes nothing", async () => {
    const path = await writeTestPack("dry.srpack", { gaze: { range: 0.85, habits: { chat: 0.25 } }, motion: { breath: 0.3 } });
    const out = quiet();
    const done = await faceFromPack(path, { dryRun: true, forgeDir: forge, log: out.log });
    expect(done.slug).toBe(SLUG);
    expect(done.written).toBe(false);
    // breath 0.3 is the default: not stored, so not a change against a job without a face.
    expect(out.lines.filter((l) => l.startsWith("  "))).toEqual(["  gaze.range: - -> 0.85", "  gaze.habits.chat: - -> 0.25"]);
    expect(out.lines.at(-1)).toContain("would write");
    expect(readFileSync(jobPath).equals(original)).toBe(true);
  });

  it("writes rig.face after the rig's last key, keeping the line ending and every other byte", async () => {
    for (const eol of ["\n", "\r\n"]) {
      const path = await writeTestPack("real.srpack", { expression: { strength: 0.6 }, mouth: { emotion: 1.2 } }, eol);
      const before = readFileSync(jobPath, "utf8");
      const done = await faceFromPack(path, { forgeDir: forge, log: quiet().log });
      expect(done.written).toBe(true);
      const after = readFileSync(jobPath, "utf8");
      const job = JSON.parse(after);
      expect(job.rig.face).toEqual({ expression: { strength: 0.6 }, mouth: { emotion: 1.2 } });
      expect(Object.keys(job.rig).at(-1)).toBe("face");
      expect(after.includes("\r\n")).toBe(eol === "\r\n");
      if (eol === "\n") expect(after.includes("\r")).toBe(false);
      delete job.rig.face;
      expect(JSON.stringify(job, null, 2).replace(/\n/g, eol) + eol).toBe(before);
    }
  });

  it("lays the pack's fields over the job's own profile; a field set back to the default is dropped", async () => {
    const path = await writeTestPack("over.srpack", { gaze: { range: 0.6 }, motion: { tilt: 1.4 } });
    const job = JSON.parse(original.toString("utf8"));
    job.rig.face = { gaze: { range: 0.3 }, expression: { strength: 0.5 } };
    writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`);
    const out = quiet();
    await faceFromPack(path, { forgeDir: forge, log: out.log });
    expect(JSON.parse(readFileSync(jobPath, "utf8")).rig.face).toEqual({ motion: { tilt: 1.4 }, expression: { strength: 0.5 } });
    expect(out.lines.filter((l) => l.startsWith("  "))).toEqual(["  gaze.range: 0.3 -> - (default)", "  motion.tilt: - -> 1.4"]);
    expect(out.lines[0]).toContain("warning");
  });

  it("a pack without a face leaves the job untouched", async () => {
    const path = await writeTestPack("plain.srpack", undefined);
    const out = quiet();
    expect((await faceFromPack(path, { forgeDir: forge, log: out.log })).written).toBe(false);
    expect(out.lines[0]).toContain("no face");
    expect(readFileSync(jobPath).equals(original)).toBe(true);
  });

  it("refuses a job.json not in the 2-space form, and a slug with no job", async () => {
    const path = await writeTestPack("form.srpack", { gaze: { range: 0.9 } });
    writeFileSync(jobPath, JSON.stringify(JSON.parse(original.toString("utf8"))));
    await expect(faceFromPack(path, { forgeDir: forge, log: quiet().log })).rejects.toThrow(/2-space form/);
    await expect(faceFromPack(path, { slug: "nobody", forgeDir: forge, log: quiet().log })).rejects.toThrow(/no recorded job nobody/);
  });
});
