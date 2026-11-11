// The built companions (companion-lanes requirement 5.1, brief E): every assets/replay/companions/
// <slug>/job.json parses, its rig validates (validateRig, morph included), every file it names
// exists and is under 1.5 MB, every key's cell lies inside the atlas and its flow cell inside the
// motion image, and the tracks are complete (2 blink stops, 7 mouth shapes, 6 families, 4 gaze) or
// the gap is listed in the character's NOTES.md.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { runnerImport } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BUILT = join(ROOT, "assets", "replay", "companions");
const SOURCES = join(ROOT, "assets", "characters", "companions");
const CAP = 1.5 * 1024 * 1024;
const TRACKS = {
  blink: 2,
  openWide: 1, openMid: 1, round: 1, closed: 1, teeth: 1, tongue: 1, narrow: 1,
  joy: 1, showman: 1, anger: 1, gloom: 1, smug: 1, suspicion: 1,
  gazeL: 1, gazeR: 1, gazeU: 1, gazeD: 1,
};
const slugs = readdirSync(BUILT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(BUILT, entry.name, "job.json")))
  .map((entry) => entry.name)
  .sort();

const inside = ([x, y, w, h], width, height) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height;

describe("built companions", () => {
  let rigCore;
  beforeAll(async () => {
    rigCore = (await runnerImport("/packages/rig/src/index.ts", { configFile: false, root: ROOT, logLevel: "warn" })).module;
  });

  it("are Iris and Bun", () => {
    expect(slugs).toEqual(["bun", "iris"]);
  });

  describe.each(slugs)("%s", (slug) => {
    const dir = join(BUILT, slug);
    const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
    const { rig } = job;

    it("validates as a fictional replay rig with a morph", () => {
      const checked = rigCore.validateRig(rig);
      expect(checked.ok ? [] : checked.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([]);
      expect(rig).toMatchObject({ id: slug, source: "replay", fictional: true, width: 1024, height: 1024 });
      expect(rig.palette.rim).toBe("#000000");
      expect(rig.morph.layer).toBe("head");
    });

    it("names files that exist and stay under 1.5 MB", () => {
      const named = [...rig.layers.map((layer) => layer.file), rig.morph.atlas, rig.morph.flow, rig.morph.sway?.map].filter(Boolean);
      for (const name of [...named, "job.json", "report.json"]) {
        const path = join(dir, name);
        expect(existsSync(path), name).toBe(true);
        expect(statSync(path).size, name).toBeLessThan(CAP);
      }
    });

    it("keeps every cell inside its image", async () => {
      const atlas = await sharp(join(dir, rig.morph.atlas)).metadata();
      expect(atlas.width).toBeLessThanOrEqual(2048);
      expect(atlas.height).toBeLessThanOrEqual(2048);
      const flow = rig.morph.flow === undefined ? undefined : await sharp(join(dir, rig.morph.flow)).metadata();
      for (const key of rig.morph.keys) {
        expect(inside(key.cell, atlas.width, atlas.height), `${key.id} cell`).toBe(true);
        expect(inside(key.bbox, rig.width, rig.height), `${key.id} bbox`).toBe(true);
        // 1 atlas px = 1 canvas px.
        expect(key.cell.slice(2), `${key.id} cell size`).toEqual(key.bbox.slice(2));
        if (key.flowCell === undefined) continue;
        expect(flow, `${key.id} has motion but the rig has no flow image`).toBeDefined();
        expect(inside(key.flowCell, flow.width, flow.height), `${key.id} flowCell`).toBe(true);
        expect(key.flowMax).toBeGreaterThan(0);
      }
    });

    it("has every track, or lists the gap in NOTES.md", () => {
      const notes = readFileSync(join(SOURCES, slug, "NOTES.md"), "utf8").replace(/\r\n/g, "\n");
      for (const [track, stops] of Object.entries(TRACKS)) {
        const keys = rig.morph.keys.filter((key) => key.track === track);
        if (keys.length === stops) continue;
        expect(notes, `${slug}: track ${track} has ${keys.length} of ${stops} keys and NOTES.md does not list it`).toMatch(new RegExp(`\\b${track}\\b.*refused`, "i"));
      }
      const blink = rig.morph.keys.filter((key) => key.track === "blink").map((key) => key.at ?? 1).sort();
      if (blink.length === 2) expect(blink).toEqual([0.5, 1]);
    });

    it("reports every gate figure and passes or refuses each key", () => {
      const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
      expect(report.verdict).toBe("ok");
      const keys = new Set(rig.morph.keys.map((key) => key.id));
      for (const rec of report.keys) {
        for (const field of ["affine", "cornerShift", "floor", "outsidePrior", "supportPx", "verdict"]) expect(rec, `${rec.id}.${field}`).toHaveProperty(field);
        if (rec.verdict === "ok") {
          expect(keys.has(rec.id), rec.id).toBe(true);
          expect(rec, `${rec.id}.weight1`).toHaveProperty("weight1");
          if (rec.flow !== "none") expect(rec, `${rec.id}.flowMax`).toHaveProperty("flowMax");
        }
        else expect(report.refused.map((r) => r.id)).toContain(rec.id);
      }
    });
  });
});
