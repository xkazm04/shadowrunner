// forge-pipeline task 10: a turned head shows no ghost. Every committed replay job is rendered at
// rest and at the gaze "chat" yaw through `poseLayers`; in the strip the head, crown and hat
// vacate, the picture must not repeat their rest pixels (a static second copy in the background).
// Images are read from assets/replay/** on disk, as the deploy serves them at /replay/**.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compositeRig, decodeImage, luma, type Rgba } from "@sr/forge";
import { poseLayers, validateRig, type Layer, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";

/** The driver's GAZE_TARGET_DEG.chat (packages/avatar/src/driver/state.ts). */
const CHAT_YAW_DEG = 10;
/** A vacated pixel repeats the rest layer when their luma is this close... */
const MATCH = 6;
/** ...and only counts when the rest layer stands out from the ground by more than this. */
const STANDS_OUT = 16;
/**
 * Ghost score limit. Measured 2026-11-01: the task 9 jobs (background = whole plate) score 0.90-1.00,
 * the task 10 jobs 0.19-0.40 (what is left is the 2 px erosion band and the soft edge).
 */
const GHOST_LIMIT = 0.5;

const SLUGS = ["announcer-of-dead-air", "lantern-warden", "malakor", "moth-widow", "sister-vesper", "understudy"];

interface Job {
  rig: Rig;
  images: Record<string, Rgba>;
}

function loadJob(dir: string): Job {
  const manifest: unknown = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
  const rig = validateRig((manifest as { rig: unknown }).rig);
  if (!rig.ok) throw new Error(`${dir}: invalid rig`);
  const images: Record<string, Rgba> = {};
  for (const layer of rig.value.layers) {
    const decoded = decodeImage(new Uint8Array(readFileSync(join(dir, layer.file))));
    if (!decoded.ok) throw new Error(`${dir}/${layer.file}: ${decoded.errors.message}`);
    images[layer.file] = decoded.value;
  }
  return { rig: rig.value, images };
}

const isGroup = (l: Layer): boolean => l.kind === "head" || l.kind === "crown" || l.name === "hat";
const lumaAt = (im: Rgba, i: number): number => luma(im.data[i * 4] ?? 0, im.data[i * 4 + 1] ?? 0, im.data[i * 4 + 2] ?? 0);

/** Alpha of `layer`'s image at canvas (x, y) when placed with `offset`. */
function alphaAt(job: Job, layer: Layer, x: number, y: number, [dx, dy]: readonly [number, number]): number {
  const im = job.images[layer.file];
  const lx = x - Math.round(layer.bbox[0]) - dx;
  const ly = y - Math.round(layer.bbox[1]) - dy;
  if (im === undefined || lx < 0 || ly < 0 || lx >= im.width || ly >= im.height) return 0;
  return im.data[(ly * im.width + lx) * 4 + 3] ?? 0;
}

/**
 * Share of the vacated strip that repeats the rest picture. The strip: pixels where a head, crown or
 * hat layer is solid (alpha >= 128) at rest but no such layer touches at the yaw pose, and the rest
 * picture there stands out from the ground (the mean of the canvas corners). A ghost pixel is one
 * where the posed picture matches the rest picture within MATCH luma.
 */
function ghostScore(job: Job): { score: number; strip: number } {
  const { rig } = job;
  const drive = { t: 0, headYaw: CHAT_YAW_DEG, headPitch: 0, jawOpen: 0, blink: 0 };
  const look = { palette: rig.palette, hidden: [], emotion: "neutral" as const };
  const offsets: Record<string, [number, number]> = {};
  for (const pose of poseLayers(rig, look, drive)) {
    const layer = rig.layers.find((l) => l.name === pose.name);
    if (layer === undefined) continue;
    expect([pose.scale[0], pose.scale[1], pose.rotation]).toEqual([1, 1, 0]);
    offsets[pose.name] = [Math.round(pose.x - layer.bbox[0]), Math.round(pose.y - layer.bbox[1])];
  }
  const rest = compositeRig(rig, job.images);
  const turned = compositeRig(rig, job.images, { offsets });
  const { width, height } = rig;
  const ground = [0, width - 1, (height - 1) * width, height * width - 1].reduce((s, i) => s + lumaAt(rest, i), 0) / 4;
  const group = rig.layers.filter(isGroup);
  let strip = 0;
  let ghosts = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!group.some((l) => alphaAt(job, l, x, y, [0, 0]) >= 128)) continue;
      if (group.some((l) => alphaAt(job, l, x, y, offsets[l.name] ?? [0, 0]) > 0)) continue;
      if (Math.abs(lumaAt(rest, i) - ground) <= STANDS_OUT) continue;
      strip++;
      if (Math.abs(lumaAt(turned, i) - lumaAt(rest, i)) <= MATCH) ghosts++;
    }
  }
  return { score: strip === 0 ? 0 : ghosts / strip, strip };
}

describe("a turned head shows no ghost (task 10)", () => {
  for (const slug of SLUGS) {
    it(`${slug}: at the "chat" yaw the vacated strip does not repeat the head or crown`, () => {
      const dir = join("assets", "replay", "forge", slug);
      expect(existsSync(join(dir, "job.json"))).toBe(true);
      const { score, strip } = ghostScore(loadJob(dir));
      expect(strip, "the head must actually move off some pixels").toBeGreaterThan(500);
      expect(score).toBeLessThan(GHOST_LIMIT);
    });
  }
});
