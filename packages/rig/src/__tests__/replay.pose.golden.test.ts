// Golden (retire-a-face): every one of the 14 recorded forge jobs, posed at every emotion, at rest,
// mid-talk, mid-crossfade and still, with a look that carries no `face`. The digests were written
// at aaa2b54, BEFORE `expression.faces` landed: a look without it must pose exactly as before
// (to 1e-9 canvas px / radians, every face weight included).
// Re-pinned by perfection-pass task 16, which grew 13 jobs' torso (and five jobs' head) bboxes: every
// pose is the old one moved by exactly its layer's bbox move (checked once by script, task 16 report).
import { describe, expect, it } from "vitest";
import { EMOTION_TABLE } from "../look.js";
import { poseLayers, type Drive, type LayerPose } from "../pose.js";
import type { Emotion, Look } from "../types.js";
import { replayRigs } from "./replayJobs.js";

const EMOTIONS = Object.keys(EMOTION_TABLE) as Emotion[];

const drives = (emotion: Emotion): Drive[] => [
  { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 },
  { t: 1.7, headYaw: 9, headPitch: -4, jawOpen: 0.6, blink: 0.3, gaze: { x: 0.4, y: -0.2 } },
  { t: 2.4, headYaw: -3, headPitch: 1, jawOpen: 0.2, blink: 0, mood: { from: emotion === "neutral" ? "theatrical" : "neutral", mix: 0.4 } },
  { t: 4.4, headYaw: 5, headPitch: 5, jawOpen: 0.2, blink: 0.1, still: true },
];

const round = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;
const flat = (p: LayerPose): unknown => ({
  ...p,
  x: round(p.x),
  y: round(p.y),
  scale: p.scale.map(round),
  rotation: round(p.rotation),
  tint: round(p.tint),
  ...(p.faces === undefined ? {} : { faces: p.faces.map((f) => ({ family: f.family, weight: round(f.weight) })) }),
});

/** FNV-1a over the text, 32 bits, as hex: a short, stable digest for the snapshot. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

describe.each(replayRigs())("recorded job $slug poses as before retire-a-face", ({ rig }) => {
  it("at every emotion and drive, with no face profile in the look", () => {
    const out: Record<string, string> = {};
    for (const emotion of EMOTIONS) {
      const look: Look = { palette: rig.palette, hidden: [], emotion };
      out[emotion] = digest(JSON.stringify(drives(emotion).map((drive) => poseLayers(rig, look, drive).map(flat))));
    }
    expect(out).toMatchSnapshot();
  });
});
