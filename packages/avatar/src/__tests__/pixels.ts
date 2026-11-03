// Pixel fixtures for the character-control renderer tests (no canvas under node): images that
// carry straight RGBA, an offscreen surface stub that copies, reads and writes those pixels, and a
// tiny rig with a non-emissive eye, a jaw with a `cavity` region, a robe with two regions, and an
// eye face patch.
import type { Layer, Rig } from "@sr/rig";
import type { Surface, SurfaceFactory } from "../canvas2d/recolour.js";
import type { RigAssets } from "../render/types.js";

/** A stand-in for a DOM type the stub cannot construct; only the members the code uses exist. */
const stand = <T extends object>(value: object): T => value as T;

export interface PixelImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export type Rgba = [r: number, g: number, b: number, a: number];

/** A `w` x `h` image; `at(x, y)` gives each pixel. */
export function pixelImage(w: number, h: number, at: (x: number, y: number) => Rgba): PixelImage {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) pixels.set(at(x, y), (y * w + x) * 4);
  return { width: w, height: h, pixels };
}

export const solid = (w: number, h: number, rgba: Rgba): PixelImage => pixelImage(w, h, () => rgba);

/** Pixel (x, y) of a drawn image (a fixture or a stub surface's canvas). */
export function pixelOf(image: unknown, x: number, y: number): Rgba {
  const img = image as PixelImage;
  const i = (y * img.width + x) * 4;
  return [img.pixels[i] ?? NaN, img.pixels[i + 1] ?? NaN, img.pixels[i + 2] ?? NaN, img.pixels[i + 3] ?? NaN];
}

/** Offscreen surfaces over PixelImages: drawImage copies a same-size image's pixels. */
export function pixelSurfaces(): { factory: SurfaceFactory; made: () => number } {
  let made = 0;
  const factory: SurfaceFactory = (w, h) => {
    made += 1;
    const canvas: PixelImage = { width: w, height: h, pixels: new Uint8ClampedArray(w * h * 4) };
    const ctx = {
      clearRect: () => canvas.pixels.fill(0),
      drawImage: (src: PixelImage) => canvas.pixels.set(src.pixels.subarray(0, canvas.pixels.length)),
      getImageData: () => ({ data: new Uint8ClampedArray(canvas.pixels), width: w, height: h }),
      putImageData: (data: { data: Uint8ClampedArray }) => canvas.pixels.set(data.data),
    };
    return stand<Surface>({ canvas, ctx });
  };
  return { factory, made: () => made };
}

export const TEAL: Rgba = [32, 178, 170, 255];
export const ROBE_A: Rgba = [120, 60, 30, 255];
export const ROBE_B: Rgba = [40, 40, 140, 255];
export const CAVITY: Rgba = [90, 20, 20, 255];
export const TEETH: Rgba = [230, 230, 220, 255];

const layer = (over: Partial<Layer> & Pick<Layer, "name" | "z" | "kind" | "file" | "bbox">): Layer => ({ anchor: [over.bbox[0], over.bbox[1]], ...over });

/** A 16 x 16 rig: robe (regions r1 left / r2 right), jaw (r1 teeth top / cavity bottom), a painted eye with an anger face. */
export function pixelRig(): Rig {
  return {
    version: 1,
    id: "pixel",
    name: "Pixel",
    width: 16,
    height: 16,
    source: "import",
    palette: { glow: "#30c0ff", eye: "#20b2aa", rim: "#ffffff", mouth: "#5a1414" },
    layers: [
      layer({ name: "robe", z: 1, kind: "body", file: "robe.png", bbox: [0, 8, 16, 8], regions: { map: "robe.regions.png", slots: [{ id: "r1", name: "robe", hex: "#783c1e" }, { id: "r2", name: "robe 2", hex: "#28288c" }] } }),
      layer({ name: "jaw", z: 2, kind: "jaw", file: "jaw.png", bbox: [4, 4, 8, 4], regions: { map: "jaw.regions.png", slots: [{ id: "r1", name: "jaw", hex: "#e6e6dc" }, { id: "cavity", name: "mouth", hex: "#5a1414" }] } }),
      layer({ name: "eye_l", z: 3, kind: "eye", emissive: false, file: "eye.png", bbox: [2, 0, 4, 4], variants: { anger: { file: "eye_l.anger.png", bbox: [2, 0, 4, 2], mode: "replace" } } }),
    ],
  };
}

/** Its images: robe left half A / right half B, jaw teeth over cavity, a teal eye, a teal face patch. */
export function pixelAssets(): Record<string, PixelImage> {
  return {
    "robe.png": pixelImage(16, 8, (x) => (x < 8 ? ROBE_A : ROBE_B)),
    "robe.regions.png": pixelImage(16, 8, (x) => [x < 8 ? 1 : 2, 0, 0, 255]),
    "jaw.png": pixelImage(8, 4, (_x, y) => (y < 2 ? TEETH : CAVITY)),
    "jaw.regions.png": pixelImage(8, 4, (_x, y) => [y < 2 ? 1 : 2, 0, 0, 255]),
    "eye.png": solid(4, 4, TEAL),
    "eye_l.anger.png": solid(4, 2, TEAL),
  };
}

export const asImage = (image: PixelImage | undefined): ImageBitmap => stand<ImageBitmap>(image ?? { width: 0, height: 0 });

export const asRigAssets = (images: Record<string, PixelImage>): RigAssets => stand<RigAssets>(images);
