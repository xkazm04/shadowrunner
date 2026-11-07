// Server-side forge types (forge-pipeline design.md "Contracts (wire names)").
// The wire contract the browser sees lives in wire.ts; these are the pipeline's own nouns.
import type { LayerAct, Motion } from "@sr/rig";

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
  /**
   * Jaw only (llm-avatar-lab): "art" when the drawing's mouth is a design, not lips (a skull's grin
   * of teeth, a carved grin): `drawnMouth` then keeps the art's mouth and the rig gets no `mouth`.
   */
  mouth?: "art";
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
  /** Jaw role only (cast-forge task 3): the jaw's travel as a fraction of height, the rig layer's `drop`. */
  drop?: number;
  /** Jaw role only: "#rrggbb", an inner glow in the mouth cavity (`paintCavity`). */
  glow?: string;
  /**
   * Jaw role only (cast-forge task 4): what an open jaw uncovers. "paint" (omitted) paints the
   * cavity lens (`paintCavity`); "fill" leaves the fill plate, for a mouth the drawing already shows
   * open (a maw of teeth over a lit throat), where the edit paints the throat behind the jaw and a
   * flat lens hung from a jagged line between the teeth would read as a zigzag. No `glow` with it.
   * "gap" (cast-forge task 5) carries a drawn dark gap up under a smooth lip, full depth in every
   * column (`MouthOptions.gap`): for a mouth drawn open when the edit will not paint a throat.
   */
  cavity?: "paint" | "fill" | "gap";
  /**
   * Jaw only (llm-avatar-lab): "art" when the drawing's mouth is a design, not lips (a skull's grin
   * of teeth, a carved grin): `drawnMouth` then keeps the art's mouth and the rig gets no `mouth`.
   */
  mouth?: "art";
  /**
   * Lifted parts only (cast-forge task 3): how the plate behind it is filled. "extend" paints it
   * from the surface around it (`blurExtend`), not from the image edit: for a small part on a flat
   * field (a pupil in a dark lens), where an edit would paint something new. Omitted means "edit".
   */
  fill?: "edit" | "extend";
  /**
   * Lifted parts only (cast-forge task 5): "plate" keys the part against the fill plate (`matte.ts`):
   * it keeps only what differs from the surface painted behind it (a neon ring and its halo on a
   * dial, a clock hand), so a pulse lights the neon, not the dial, and a turning part carries no
   * patch of the surface with it.
   */
  matte?: "plate";
  /**
   * Lifted parts only (cast-forge task 5): `[y, x]` in 0..1000, the point the part turns about (its
   * layer anchor): a clock hand's hub, a key's boss. Omitted means `pivotOf` or the role's anchor.
   */
  pivot?: [y: number, x: number];
  /**
   * Any role (cast-forge task 12 follow-up): whether the part gives light. Omitted means the rule
   * `emissiveOf` applies (a pulsing part and an eye give light, nothing else does); `false` on an eye
   * drawn without light of its own, `true` on a part that gives light without pulsing.
   */
  emissive?: boolean;
  /**
   * tiger L1: the part's signature act (`actFromWords` from the brief's words), the layer's `act`.
   * Read leniently: a bad one is dropped, never an error. Omitted: none.
   */
  act?: LayerAct;
}

/** How a v2 file's parts are cut, per art style (cast-forge task 3). */
export interface CutStyle {
  /** Feather in canvas px, 0..8; 0 is a hard cut (pixel art). Omitted means CUT_FEATHER. */
  feather?: number;
  /** The art's own pixel size in canvas px, 1..32 (pixel art): the mouth cavity steps on it. */
  cell?: number;
}

/** A v2 parts file (cast-forge design.md "Named parts"). */
export interface PartsV2 {
  version: 2;
  parts: NamedPart[];
  cut?: CutStyle;
}
