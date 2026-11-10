// A small portrait-lane rig for the avatar's morph tests (companion-lanes): ground, body, a head
// carrying the morph keys (blink, three mouth shapes, a face, two gaze keys), no jaw, eye or iris,
// and stand-in images for every file (no decoding under node).
import type { MorphKey, Rig } from "@sr/rig";
import type { RigAssets } from "../render/types.js";

export const KEYS: MorphKey[] = [
  { id: "blink", track: "blink", bbox: [80, 90, 100, 30], cell: [0, 34, 100, 30] },
  { id: "open_mid", track: "openMid", bbox: [100, 150, 60, 40], cell: [104, 0, 60, 40], flowCell: [27, 0, 15, 10], flowMax: 6 },
  { id: "round", track: "round", bbox: [100, 150, 60, 40], cell: [104, 44, 60, 40] },
  { id: "joy", track: "joy", bbox: [70, 70, 120, 130], cell: [0, 88, 120, 130], flowCell: [44, 0, 30, 33], flowMax: 2 },
  { id: "look_l", track: "gazeL", bbox: [80, 90, 100, 30], cell: [124, 88, 100, 30] },
  { id: "look_r", track: "gazeR", bbox: [80, 90, 100, 30], cell: [124, 122, 100, 30] },
];

export function morphRig(): Rig {
  return {
    version: 1,
    id: "test-portrait",
    name: "Test Portrait",
    width: 256,
    height: 256,
    source: "replay",
    fictional: true,
    palette: { glow: "#000000", eye: "#ffffff", rim: "#000000", mouth: "#802020" },
    layers: [
      { name: "background", z: 0, kind: "static", file: "background.webp", bbox: [0, 0, 256, 256], anchor: [128, 128] },
      { name: "body", z: 1, kind: "body", file: "body.webp", bbox: [40, 170, 176, 86], anchor: [128, 200] },
      { name: "head", z: 2, kind: "head", file: "head.webp", bbox: [60, 30, 140, 180], anchor: [130, 190] },
    ],
    mouth: { cx: 130, lineY: 170, width: 50 },
    morph: { layer: "head", atlas: "morph.atlas.webp", flow: "morph.flow.png", keys: KEYS, eyes: [[105, 105], [155, 105]], sway: { map: "morph.sway.png", amp: 6 } },
  };
}

const bitmap = (width: number, height: number): ImageBitmap => ({ width, height, close: () => undefined });

/** Stand-ins: each layer at its bbox size, a 256 px atlas, a 128 px motion image, a sway map the head's size. */
export function morphAssets(rig: Rig = morphRig()): RigAssets {
  const out: RigAssets = {};
  for (const l of rig.layers) out[l.file] = bitmap(l.bbox[2], l.bbox[3]);
  if (rig.morph !== undefined) {
    out[rig.morph.atlas] = bitmap(256, 256);
    if (rig.morph.flow !== undefined) out[rig.morph.flow] = bitmap(128, 64);
    if (rig.morph.sway !== undefined) out[rig.morph.sway.map] = bitmap(140, 180);
  }
  return out;
}
