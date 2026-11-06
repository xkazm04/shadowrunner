// A synthetic face-control rig (face-control WP-A test fixture, until the re-cut cast lands): a drawn
// head with two eyes, each an iris-removed eye (white), an iris disc following it, an elliptical
// socket mask, closed-lid art and a joy face with its own, narrower socket; a jaw whose six patches
// are one image under six names (dead). Pixel images (pixels.ts) so the canvas2D clip can run.
import type { Layer, LayerPatch, Rig } from "@sr/rig";
import { pixelImage, solid, type PixelImage, type Rgba } from "./pixels.js";

export const SKIN: Rgba = [200, 160, 140, 255];
export const WHITE: Rgba = [240, 240, 235, 255];
export const IRIS: Rgba = [40, 120, 200, 255];
export const LID: Rgba = [150, 110, 95, 255];

/** Eye box: 24 x 16 at (x, 40); socket ellipse semi-axes 10 x 6 about its centre (joy: 10 x 3). */
const EYE_W = 24;
const EYE_H = 16;

/** Alpha 255 inside the ellipse (cx, cy, rx, ry) of a w x h image, 0 outside. */
export function ellipse(w: number, h: number, rx: number, ry: number, rgba: Rgba = WHITE): PixelImage {
  const [cx, cy] = [w / 2, h / 2];
  return pixelImage(w, h, (x, y) => (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1 ? rgba : [0, 0, 0, 0]));
}

const eyeLayer = (name: string, z: number, x: number): Layer => {
  const joy: LayerPatch = { file: `${name}.joy.png`, bbox: [x, 40, EYE_W, EYE_H], mode: "replace", socket: `${name}.joy.socket.png`, narrowed: true };
  return {
    name,
    z,
    kind: "eye",
    file: `${name}.png`,
    bbox: [x, 40, EYE_W, EYE_H],
    anchor: [x + EYE_W / 2, 48],
    follow: "head",
    socket: `${name}.socket.png`,
    closed: `${name}.closed.png`,
    variants: { joy },
  };
};

const irisLayer = (name: string, z: number, eye: string, cx: number): Layer => ({ name, z, kind: "iris", file: `${name}.png`, bbox: [cx - 4, 44, 8, 8], anchor: [cx, 48], follow: eye });

const jawPatches = Object.fromEntries(["joy", "showman", "anger", "gloom", "smug", "suspicion"].map((f) => [f, { file: `jaw.${f}.png`, bbox: [48, 76, 32, 12], mode: "replace" as const }]));

/** The synthetic face: 128 x 128, eyes at x 34 and 70. */
export function faceRig(): Rig {
  return {
    version: 1,
    id: "face",
    name: "Face",
    width: 128,
    height: 128,
    source: "replay",
    fictional: true,
    palette: { glow: "#30c0ff", eye: "#2878c8", rim: "#ffffff", mouth: "#5a1414" },
    layers: [
      { name: "head", z: 1, kind: "head", file: "head.png", bbox: [16, 16, 96, 96], anchor: [64, 100] },
      { name: "jaw", z: 2, kind: "jaw", file: "jaw.png", bbox: [48, 76, 32, 12], anchor: [64, 76], follow: "head", variants: jawPatches },
      eyeLayer("eye_l", 3, 34),
      irisLayer("iris_l", 4, "eye_l", 46),
      eyeLayer("eye_r", 5, 70),
      irisLayer("iris_r", 6, "eye_r", 82),
    ],
  };
}

/** Its images: socket ellipses (joy narrower), white eyes, closed lids, 8 x 8 iris discs, one jaw image under six names. */
export function faceAssets(): Record<string, PixelImage> {
  const out: Record<string, PixelImage> = {
    "head.png": solid(96, 96, SKIN),
    "jaw.png": solid(32, 12, SKIN),
  };
  for (const f of ["joy", "showman", "anger", "gloom", "smug", "suspicion"]) out[`jaw.${f}.png`] = solid(32, 12, LID);
  for (const eye of ["eye_l", "eye_r"]) {
    out[`${eye}.png`] = ellipse(EYE_W, EYE_H, 11, 7);
    out[`${eye}.joy.png`] = ellipse(EYE_W, EYE_H, 11, 4);
    out[`${eye}.socket.png`] = ellipse(EYE_W, EYE_H, 10, 6);
    out[`${eye}.joy.socket.png`] = ellipse(EYE_W, EYE_H, 10, 3);
    out[`${eye}.closed.png`] = solid(EYE_W, EYE_H, LID);
  }
  for (const iris of ["iris_l", "iris_r"]) out[`${iris}.png`] = ellipse(8, 8, 4, 4, IRIS);
  return out;
}
