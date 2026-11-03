// Baseline (character-control task 1): poseLayers output for Malakor's imported v1 rig and one cast
// rig (Reveille, which has brow layers) at a spread of drive states, with a neutral look and none of
// the character-control fields. The snapshot was written BEFORE moods, faces and reshape landed;
// an untouched rig must pose exactly as it did (to 1e-9 canvas px / radians).
import { describe, expect, it } from "vitest";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import reveilleJob from "../../../../assets/replay/forge/reveille/job.json";
import { importLegacyLayers } from "../legacy.js";
import { poseLayers, type Drive, type LayerPose } from "../pose.js";
import type { Look, Rig } from "../types.js";
import { validateRig } from "../validate.js";

function malakor(): Rig {
  const result = importLegacyLayers(layersJson, specJson);
  if (!result.ok) throw new Error("malakor import failed");
  return result.value.rig;
}

function reveille(): Rig {
  const result = validateRig((reveilleJob as { rig: unknown }).rig);
  if (!result.ok) throw new Error("reveille rig invalid");
  return result.value;
}

const DRIVES: Record<string, Drive> = {
  rest: { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 },
  talking: { t: 1.7, headYaw: 9, headPitch: -4, jawOpen: 0.6, blink: 0.3 },
  clamped: { t: 3.25, headYaw: 40, headPitch: 30, jawOpen: 2, blink: 1 },
  tilt: { t: 5.2, headYaw: -6, headPitch: 2, jawOpen: 0.1, blink: 0, gesture: { name: "tilt", startedAt: 5.05 } },
  nod: { t: 7.1, headYaw: 0, headPitch: 8, jawOpen: 0, blink: 0.5, gesture: { name: "nod", startedAt: 7 } },
  flare: { t: 2.2, headYaw: 3, headPitch: 0, jawOpen: 0.4, blink: 0, gesture: { name: "flare", startedAt: 2.0 } },
  recoil: { t: 9.3, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, gesture: { name: "recoil", startedAt: 9.1 } },
  still: { t: 4.4, headYaw: 5, headPitch: 5, jawOpen: 0.2, blink: 0.1, still: true },
};

const round = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;
const flat = (p: LayerPose): unknown => ({
  name: p.name,
  x: round(p.x),
  y: round(p.y),
  scale: p.scale.map(round),
  rotation: round(p.rotation),
  opacity: p.opacity,
  tint: round(p.tint),
  ...(p.faces === undefined ? {} : { faces: p.faces }),
});

describe.each([
  { slug: "malakor", rig: malakor() },
  { slug: "reveille", rig: reveille() },
])("poseLayers baseline: $slug", ({ rig }) => {
  const look: Look = { palette: rig.palette, hidden: [], emotion: "neutral" };
  it.each(Object.keys(DRIVES))("poses %s as before character-control", (name) => {
    const drive = DRIVES[name];
    if (drive === undefined) throw new Error(name);
    expect(poseLayers(rig, look, drive).map(flat)).toMatchSnapshot();
  });
});
