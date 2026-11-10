// The synthetic morph rig of the morph capture page (companion-lanes task 1, D): drawn in the page,
// so the shader's fixed points can be measured on known pixels. A 512 px canvas; one head layer
// (a fine checker, 4 px squares, two greys, with coloured dots on a 64 px grid); five keys:
// - `shift` (track joy, face group): the checker moved by SHIFT px, with a uniform flow of that move
//   (faded with the coverage), so at weight w the checker sits at w x SHIFT;
// - `solid_r`, `solid_b` (openWide, round: one mouth group, one box): solid red and blue, no flow;
// - `lid` (blink, the last group): solid yellow, over part of `shift`'s box;
// - a sway map: 0 in the head's top half, rising to 1 at its bottom.
// Every key's coverage is 1 inside and feathers to 0 over FEATHER px at its cell's edge.
import type { MorphKey, Rig } from "@sr/rig";

export const SYNTH_SIZE = 512;
/** The `shift` key's move, canvas px, and its flowMax (code 255 = SHIFT). */
export const SHIFT: readonly [number, number] = [4, 0];
export const FEATHER = 12;
export const CHECKER = 4;
export const HEAD_BOX: [number, number, number, number] = [56, 56, 400, 400];
export const SWAY_AMP = 20;

export const SYNTH_KEYS: MorphKey[] = [
  { id: "shift", track: "joy", bbox: [156, 156, 160, 120], cell: [2, 2, 160, 120], flowCell: [1, 1, 40, 30], flowMax: 4 },
  { id: "solid_r", track: "openWide", bbox: [176, 316, 120, 80], cell: [166, 2, 120, 80] },
  { id: "solid_b", track: "round", bbox: [176, 316, 120, 80], cell: [290, 2, 120, 80] },
  { id: "lid", track: "blink", bbox: [226, 176, 120, 80], cell: [166, 86, 120, 80] },
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

/** Coverage of a cell pixel (u, v) of a w x h cell: 1 inside, feathered to 0 at the edge. */
export function coverageAt(u: number, v: number, w: number, h: number): number {
  const d = Math.min(u + 0.5, v + 0.5, w - u - 0.5, h - v - 0.5);
  return Math.min(1, Math.max(0, d / FEATHER));
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

/** The key's colour at canvas px (x, y) inside its box. */
function keyAt(key: MorphKey, x: number, y: number): [number, number, number] {
  const solid = SOLID[key.id];
  if (solid !== undefined) return [solid[0], solid[1], solid[2]];
  return headAt(x - SHIFT[0], y - SHIFT[1]);
}

/** The atlas: each key's cell (colour + coverage) at its `cell`; transparent elsewhere. */
function atlasData(): ImageData {
  const cells = SYNTH_KEYS.map((key) => ({ key, cx: key.cell[0], cy: key.cell[1], w: key.cell[2], h: key.cell[3] }));
  return imageData(SYNTH_SIZE, 256, (x, y) => {
    for (const { key, cx, cy, w, h } of cells) {
      const u = x - cx;
      const v = y - cy;
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      const [r, g, b] = keyAt(key, key.bbox[0] + u, key.bbox[1] + v);
      return [r, g, b, Math.round(255 * coverageAt(u, v, w, h))];
    }
    return [0, 0, 0, 0];
  });
}

/** The motion image: 128 everywhere; `shift`'s cell holds SHIFT times the coverage at that point. */
function flowData(): ImageData {
  const key = SYNTH_KEYS[0];
  const fc = key?.flowCell ?? [0, 0, 1, 1];
  const max = key?.flowMax ?? 1;
  return imageData(64, 64, (x, y) => {
    const u = x - fc[0];
    const v = y - fc[1];
    const inside = u >= -1 && v >= -1 && u <= fc[2] && v <= fc[3];
    if (!inside || key === undefined) return [128, 128, 128, 255];
    // The flow cell's pixel (u, v) covers the bbox's 4 x 4 block about its centre (the gutter repeats the edge).
    const bu = (Math.min(fc[2] - 1, Math.max(0, u)) + 0.5) * (key.bbox[2] / fc[2]);
    const bv = (Math.min(fc[3] - 1, Math.max(0, v)) + 0.5) * (key.bbox[3] / fc[3]);
    const k = coverageAt(bu - 0.5, bv - 0.5, key.bbox[2], key.bbox[3]);
    const code = (d: number): number => Math.round(128 + (127 * d * k) / max);
    return [code(SHIFT[0]), code(SHIFT[1]), 128, 255];
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
