// Test-only fixtures for the creator (never imported by app code, so never bundled).
import type { Rig } from "@sr/rig";
import type { ReplayJob } from "./replayJobs";

/** A small valid fictional rig with one of each kind the customize panel cares about. */
export function testRig(id = "test-ghost", name = "Test Ghost"): Rig {
  return {
    version: 1,
    id,
    name,
    width: 64,
    height: 64,
    source: "forge",
    fictional: true,
    palette: { glow: "#112233", eye: "#445566", rim: "#778899", mouth: "#aabbcc" },
    layers: [
      { name: "background", z: 1, kind: "static", file: "background.png", bbox: [0, 0, 64, 64], anchor: [32, 32], depth: 0 },
      { name: "torso", z: 2, kind: "body", file: "torso.png", bbox: [8, 40, 48, 24], anchor: [32, 52] },
      { name: "head", z: 3, kind: "head", file: "head.png", bbox: [16, 8, 32, 36], anchor: [32, 40] },
      { name: "jaw", z: 4, kind: "jaw", file: "jaw.png", bbox: [24, 30, 16, 8], anchor: [32, 30], follow: "head" },
      { name: "eye_l", z: 5, kind: "eye", file: "eye_l.png", bbox: [22, 18, 6, 4], anchor: [25, 20], follow: "head" },
      { name: "eye_r", z: 6, kind: "eye", file: "eye_r.png", bbox: [36, 18, 6, 4], anchor: [39, 20], follow: "head" },
      { name: "crown", z: 7, kind: "crown", file: "crown.png", bbox: [16, 0, 32, 10], anchor: [32, 8], follow: "head" },
      { name: "monocle", z: 8, kind: "accessory", file: "monocle.png", bbox: [34, 16, 10, 8], anchor: [39, 20], follow: "head" },
    ],
  };
}

/** A recorded job over `testRig`, holds 1.5 s each. Asset URLs are tiny data URLs. */
export function testJob(slug = "test-ghost"): ReplayJob {
  const rig = testRig(`replay-${slug}`);
  const assets: Record<string, string> = {};
  for (const layer of rig.layers) assets[layer.file] = PIXEL_PNG;
  return {
    slug,
    name: "Test Ghost",
    steps: [
      { status: "queued", holdMs: 1500 },
      { status: "portrait", holdMs: 1500 },
      { status: "segmenting", holdMs: 1500 },
      { status: "cutting", holdMs: 1500 },
      { status: "filling", holdMs: 1500 },
      { status: "done", holdMs: 0 },
    ],
    portraitUrl: PIXEL_PNG,
    rig,
    assets,
  };
}

/** A 1x1 transparent PNG. */
export const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
