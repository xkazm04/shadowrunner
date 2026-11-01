// Server-side forge types (forge-pipeline design.md "Contracts (wire names)").
// The wire contract the browser sees lives in wire.ts; these are the pipeline's own nouns.

/** The closed list of part names the segmentation model may return (PARTS_PROMPT). */
export const PART_NAMES = [
  "head",
  "jaw",
  "eye_l",
  "eye_r",
  "monocle",
  "crown",
  "torso",
  "hat",
  "hair",
  "accessory",
] as const;
export type PartName = (typeof PART_NAMES)[number];

/** One part as the model returns it. Coordinates are integers normalized to 0..1000. */
export interface Part {
  name: PartName;
  box_2d: [ymin: number, xmin: number, ymax: number, xmax: number];
  /** Outline points as [y, x], 0..1000. */
  poly: [y: number, x: number][];
}

/** A polygon in canvas pixels, [x, y] points (the output of `toCanvas`). */
export type Polygon = [x: number, y: number][];

/** An RGBA image: `data` holds width * height * 4 bytes, row-major, no padding. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
