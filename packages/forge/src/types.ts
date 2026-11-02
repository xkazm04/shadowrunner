// Server-side forge types (forge-pipeline design.md "Contracts (wire names)").
// The wire contract the browser sees lives in wire.ts; these are the pipeline's own nouns.
import type { Motion } from "@sr/rig";

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

/**
 * cast-forge design.md "Named parts": a part's role. The ten v1 names, plus `eye` (an eye that is
 * not a left/right pair member), `float` (a piece that bobs on its own) and `pulse` (one that glows).
 */
export type PartRole = PartName | "eye" | "float" | "pulse";

/** One named part of a PartsV2 file. Coordinates as `Part`. */
export interface NamedPart {
  /** `[a-z0-9_]`, unique in the file; becomes the layer name. */
  name: string;
  role: PartRole;
  box_2d: [ymin: number, xmin: number, ymax: number, xmax: number];
  poly: [y: number, x: number][];
  /** Another part's name; omitted means the role's default (`defaultFollow`). */
  follow?: string;
  /** Motion in 1024-px canvas units (scaled to the portrait by assembleRig). */
  motion?: Motion;
  /** Luma-key the polygon; omitted means the role's default (`defaultKey`). */
  key?: boolean;
}

/** A v2 parts file (cast-forge design.md "Named parts"). */
export interface PartsV2 {
  version: 2;
  parts: NamedPart[];
}
