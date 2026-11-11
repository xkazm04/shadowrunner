// The synthetic morph rig of the morph capture page (companion-lanes task 1, D): drawn in the page,
// so the shader's fixed points can be measured on known pixels. A 512 px canvas; one head layer
// (a fine checker, 4 px squares, two greys, with coloured dots on a 64 px grid); five keys:
// - `shift` (track showman, face group): the checker moved by SHIFT px, with a uniform flow of that move
//   (faded with the coverage), so at weight w the checker sits at w x SHIFT;
// - `solid_r`, `solid_b` (openWide, round: one mouth group, one box): solid red and blue, no flow;
// - `lid` (blink, the last group): solid yellow, over part of `shift`'s box;
// - round 2 (morphFields.ts): `big` (gloom) the head moved BIG px with a back cell, `stretch`
//   (openMid) a stretch that opens a gap of new surface with reveal 1 there;
// - a sway map: 0 in the head's top half, rising to 1 at its bottom.
// Every key's coverage is 1 inside and feathers to 0 over FEATHER px at its cell's edge.
import type { MorphKey, Rig } from "@sr/rig";
import { coverageAt, moving } from "./morphFields";

export const SYNTH_SIZE = 512;
export const CHECKER = 4;
export const HEAD_BOX: [number, number, number, number] = [56, 56, 400, 400];
export const SWAY_AMP = 20;

export const SYNTH_KEYS: MorphKey[] = [
  { id: "shift", track: "showman", bbox: [156, 156, 160, 120], cell: [2, 2, 160, 120], flowCell: [1, 1, 40, 30], flowMax: 4 },
  { id: "solid_r", track: "openWide", bbox: [176, 316, 120, 80], cell: [166, 2, 120, 80] },
  { id: "solid_b", track: "round", bbox: [176, 316, 120, 80], cell: [290, 2, 120, 80] },
  { id: "lid", track: "blink", bbox: [226, 176, 120, 80], cell: [166, 86, 120, 80] },
  { id: "big", track: "gloom", bbox: [120, 300, 240, 120], cell: [2, 170, 240, 120], flowCell: [43, 1, 60, 30], flowMax: 42, backCell: [105, 1, 60, 30] },
  { id: "stretch", track: "openMid", bbox: [320, 100, 120, 120], cell: [246, 170, 120, 120], flowCell: [167, 1, 30, 30], flowMax: 16, backCell: [199, 1, 30, 30] },
  { id: "face_up", track: "joy", part: "upper", bbox: [120, 80, 200, 100], cell: [2, 294, 200, 100], flowCell: [1, 34, 50, 25], flowMax: 22, backCell: [53, 34, 50, 25] },
  { id: "face_low", track: "joy", part: "lower", bbox: [120, 196, 200, 100], cell: [206, 294, 200, 100], flowCell: [105, 34, 50, 25], flowMax: 22, backCell: [157, 34, 50, 25] },
  { id: "look_r", track: "gazeR", bbox: [160, 120, 120, 60], cell: [2, 398, 120, 60], flowCell: [1, 61, 30, 15], flowMax: 10, backCell: [33, 61, 30, 15] },
];

export const SOLID: Readonly<Record<string, readonly [number, number, number]>> = { solid_r: [230, 40, 40], solid_b: [40, 60, 230], lid: [250, 210, 20] };

/** The head's colour at canvas px (x, y): the checker, with a dot every 64 px. */
export function headAt(x: number, y: number): [number, number, number] {
  const gx = (((x - HEAD_BOX[0]) % 64) + 64) % 64;
  const gy = (((y - HEAD_BOX[1]) % 64) + 64) % 64;
  if (Math.hypot(gx - 32, gy - 32) < 5) return [40 + ((x * 3) & 127), 180, 90 + ((y * 5) & 127)];
  const on = (Math.floor(x / CHECKER) + Math.floor(y / CHECKER)) % 2 === 0;
  return on ? [215, 215, 215] : [60, 60, 60];
}

export function synthRig(): Rig {
  return {
    version: 1,
    id: "synthetic-morph",
    name: "Synthetic morph",
    width: SYNTH_SIZE,
    height: SYNTH_SIZE,
    source: "replay",
    fictional: true,
    palette: { glow: "#000000", eye: "#ffffff", rim: "#000000", mouth: "#000000" },
    layers: [{ name: "head", z: 1, kind: "head", file: "head.png", bbox: HEAD_BOX, anchor: [256, 456] }],
    turn: { warp: 1, light: 0 },
    // No mood tilt or pitch: an emotion (round 3's states) drives the keys without turning the head.
    face: { motion: { tilt: 0 } },
    morph: {
      layer: "head",
      atlas: "atlas.png",
      flow: "flow.png",
      keys: SYNTH_KEYS,
      eyes: [[216, 200], [296, 200]],
      sway: { map: "sway.png", amp: SWAY_AMP },
    },
  };
}

type Paint = (x: number, y: number) => [number, number, number, number];

function imageData(w: number, h: number, paint: Paint): ImageData {
  const data = new ImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const i = 4 * (y * w + x);
      data.data[i] = r;
      data.data[i + 1] = g;
      data.data[i + 2] = b;
      data.data[i + 3] = a;
    }
  }
  return data;
}

/** The key's colour at its bbox px (u, v). */
function keyAt(key: MorphKey, u: number, v: number): [number, number, number] {
  const solid = SOLID[key.id];
  if (solid !== undefined) return [solid[0], solid[1], solid[2]];
  return moving(key.id, key.bbox)?.colour(headAt, u, v) ?? [0, 0, 0];
}

/** The atlas: each key's cell (colour + coverage) at its `cell`; transparent elsewhere. */
function atlasData(): ImageData {
  const cells = SYNTH_KEYS.map((key) => ({ key, cx: key.cell[0], cy: key.cell[1], w: key.cell[2], h: key.cell[3] }));
  return imageData(SYNTH_SIZE, SYNTH_SIZE, (x, y) => {
    for (const { key, cx, cy, w, h } of cells) {
      const u = x - cx;
      const v = y - cy;
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      const [r, g, b] = keyAt(key, u, v);
      return [r, g, b, Math.round(255 * coverageAt(u, v, w, h))];
    }
    return [0, 0, 0, 0];
  });
}

/**
 * The motion image: 128 everywhere; each moving key's flow cell holds F and its back cell G and r,
 * sampled at the centre of the bbox block each cell px covers (the 1 px gutter repeats the edge).
 */
function flowData(): ImageData {
  const code = (d: number, max: number): number => Math.max(0, Math.min(255, Math.round(128 + (127 * d) / max)));
  const cells = SYNTH_KEYS.flatMap((key) => {
    const field = moving(key.id, key.bbox);
    if (field === undefined || key.flowCell === undefined) return [];
    const out = [{ key, box: key.flowCell, at: (u: number, v: number): [number, number, number] => {
      const [dx, dy] = field.f(u, v);
      return [code(dx, field.flowMax), code(dy, field.flowMax), 128];
    } }];
    if (key.backCell !== undefined && field.g !== undefined) {
      const g = field.g;
      out.push({ key, box: key.backCell, at: (u, v) => {
        const [dx, dy] = g(u, v);
        return [code(dx, field.flowMax), code(dy, field.flowMax), Math.round(255 * (field.r?.(u, v) ?? 0))];
      } });
    }
    return out;
  });
  return imageData(256, 128, (x, y) => {
    for (const { key, box, at } of cells) {
      const u = x - box[0];
      const v = y - box[1];
      if (u < -1 || v < -1 || u > box[2] || v > box[3]) continue;
      const bu = (Math.min(box[2] - 1, Math.max(0, u)) + 0.5) * (key.bbox[2] / box[2]);
      const bv = (Math.min(box[3] - 1, Math.max(0, v)) + 0.5) * (key.bbox[3] / box[3]);
      return [...at(bu, bv), 255];
    }
    return [128, 128, 128, 255];
  });
}

/** The sway map over the head's box: 0 above its middle, rising to 1 at its bottom. */
function swayData(): ImageData {
  return imageData(HEAD_BOX[2], HEAD_BOX[3], (_x, y) => {
    const s = Math.round(255 * Math.min(1, Math.max(0, (y - HEAD_BOX[3] / 2) / (HEAD_BOX[3] / 2))));
    return [s, s, s, 255];
  });
}

/** Every image of the synthetic rig, decoded as the app decodes them (colour premultiplied, data raw). */
export async function synthAssets(): Promise<Record<string, ImageBitmap>> {
  const colour: ImageBitmapOptions = { premultiplyAlpha: "premultiply" };
  const raw: ImageBitmapOptions = { premultiplyAlpha: "none", colorSpaceConversion: "none" };
  const head = imageData(HEAD_BOX[2], HEAD_BOX[3], (x, y) => [...headAt(HEAD_BOX[0] + x, HEAD_BOX[1] + y), 255]);
  return {
    "head.png": await createImageBitmap(head, colour),
    "atlas.png": await createImageBitmap(atlasData(), colour),
    "flow.png": await createImageBitmap(flowData(), raw),
    "sway.png": await createImageBitmap(swayData(), raw),
  };
}
