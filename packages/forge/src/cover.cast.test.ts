/// <reference types="node" />
// perfection-pass task 16 (requirement 16.2): every recorded cast job, as committed, passes the
// coverage check: with the backdrop hidden its layers cover the portrait's foreground at rest, and
// its neck stays covered at every pose within the rig's limits (coverCheck.ts). Red on the
// Announcer's cut before the re-cut (scripts/cover-recut.mjs). No network.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { coverReport, covers } from "./coverCheck.js";
import { decodeImage } from "./image.js";
import { parseParts } from "./parts.js";
import type { NamedPart, Part, Rgba } from "./types.js";

const ROOT = new URL("../../../", import.meta.url);
const FORGE = new URL("assets/replay/forge/", ROOT);
/**
 * Malakor's replay job is the pre-existing house art (docs/provenance.md, "Pre-existing material"),
 * which is never changed, so it is exempt: the check finds his robe's pieces outside his recorded
 * parts and an uncovered neck, and this test pins that finding instead of a pass.
 */
const HOUSE = new Set(["malakor"]);

function decode(url: URL): Rgba {
  const result = decodeImage(new Uint8Array(readFileSync(url)));
  if (!result.ok) throw new Error(`${url.pathname}: ${result.errors.message}`);
  return result.value;
}

/** The job's recorded parts: a preset's or a cast member's parts.json, Malakor's m8 parts. */
function partsOf(slug: string): (Part | NamedPart)[] {
  const urls = slug === "malakor" ? [new URL("packages/forge/test/fixtures/m8-parts.json", ROOT)] : [new URL(`assets/characters/presets/${slug}/parts.json`, ROOT), new URL(`assets/characters/cast/${slug}/parts.json`, ROOT)];
  const url = urls.find((u) => existsSync(u));
  if (url === undefined) throw new Error(`no recorded parts for ${slug}`);
  const parsed = parseParts(JSON.parse(readFileSync(url, "utf8")));
  if (!parsed.ok) throw new Error(`${slug}: parts do not parse`);
  return parsed.value.named ?? parsed.value.parts;
}

function reportOf(slug: string): ReturnType<typeof coverReport> {
  const dir = new URL(`${slug}/`, FORGE);
  const job = JSON.parse(readFileSync(new URL("job.json", dir), "utf8")) as { rig: Rig; portrait: string };
  const images: Record<string, Rgba> = {};
  for (const layer of job.rig.layers) if (existsSync(new URL(layer.file, dir))) images[layer.file] = decode(new URL(layer.file, dir));
  return coverReport(job.rig, images, decode(new URL(job.portrait, dir)), partsOf(slug));
}

const slugs = readdirSync(FORGE).filter((slug) => existsSync(new URL(`${slug}/job.json`, FORGE)));

describe("every recorded job keeps every piece (task 16)", () => {
  it("finds all 14 jobs", () => expect(slugs).toHaveLength(14));

  it.each(slugs.filter((s) => !HOUSE.has(s)))("%s covers its foreground at rest and its neck at the rig's limits", (slug) => {
    const report = reportOf(slug);
    expect({ uncovered: report.uncovered, neckGaps: report.neckGaps, worstPose: report.worstPose }).toEqual({ uncovered: 0, neckGaps: 0, worstPose: undefined });
    expect(covers(report)).toBe(true);
  }, 60_000);

  it.each([...HOUSE])("%s (house art, exempt) is reported, not changed", (slug) => {
    const report = reportOf(slug);
    expect(covers(report)).toBe(false);
    expect(report.uncovered).toBeGreaterThan(0);
  }, 60_000);
});
