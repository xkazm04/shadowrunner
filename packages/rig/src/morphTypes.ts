// Morph keys (companion-lanes): the wire types of `Rig.morph`, declared here beside types.ts (for
// its 400-line cap) and re-exported from it; types.ts stays the single entry of the rig contract.
// Optional fields are omitted when absent, never null.
import type { ExpressionFamily } from "./types.js";

/**
 * What drives a morph key (companion-lanes design "Tracks"): the blink, the seven non-rest mouth
 * shapes (`@sr/avatar` MOUTH_SHAPES), the six expression families, and the four gaze directions
 * (L and R are the picture's left and right: `Drive.gaze.x` < 0 and > 0; U and D are y < 0 and > 0).
 */
export type MorphTrack =
  | "blink"
  | "openWide" | "openMid" | "round" | "closed" | "teeth" | "tongue" | "narrow"
  | ExpressionFamily
  | "gazeL" | "gazeR" | "gazeU" | "gazeD";

/**
 * One morph key: an aligned repaint of part of the morph layer (an image edit of the portrait with
 * one thing changed), with an optional motion field from the layer's own pixels to it.
 */
export interface MorphKey {
  /** Unique in the rig, [a-z0-9_]+. */
  id: string;
  track: MorphTrack;
  /**
   * The key's stop on its track, in (0, 1]; omitted means 1. Keys of one track are stops in `at`
   * order: a track value between two stops shows the lower one fading out as the upper fades in
   * (below the first stop, the layer's own pixels fade out).
   */
  at?: number;
  /** The canvas px box the key repaints (integers, inside the canvas). */
  bbox: [x: number, y: number, w: number, h: number];
  /**
   * The key's colour cell in `RigMorph.atlas`, atlas px (integers): RGB is the repaint, alpha its
   * coverage (feathered to 0 at the cell's edge). The cell is stretched over `bbox`.
   */
  cell: [x: number, y: number, w: number, h: number];
  /**
   * The key's motion cell in `RigMorph.flow`, flow-image px (integers), stretched over `bbox`:
   * R and G hold the displacement from a layer pixel to the same feature in the key, canvas px,
   * as `(code - 128) / 127 * flowMax` (x right, y down), already faded to 0 where coverage is 0.
   * Omitted: the key has no motion and is a plain cross-fade.
   */
  flowCell?: [x: number, y: number, w: number, h: number];
  /** Canvas px of displacement at code 255, in (0, 256]; required with `flowCell`. */
  flowMax?: number;
  /**
   * The key's back cell in `RigMorph.flow` (companion-lanes round 2), stretched over `bbox`, read in
   * the KEY's frame: R and G hold the displacement from a key pixel back to the same feature in the
   * layer (same code and `flowMax` as `flowCell`), B how much that key pixel is new surface the
   * layer does not have (teeth, the inside of a mouth, a lowered lid), `code / 255`. With it the
   * morph is exact at weight 1 for any motion and new surface is uncovered by the motion instead of
   * faded in. Requires `flowCell`. Omitted: the forward motion alone, no reveal.
   */
  backCell?: [x: number, y: number, w: number, h: number];
  /**
   * Expression family keys only (companion-lanes round 3): the half of the face this key repaints,
   * "upper" (brows, lids, eyes) or "lower" (cheeks, mouth). Two keys of one family may share a stop
   * when their parts differ (an upper and a lower key partition one face). While the mouth speaks,
   * a lower key's colour gives way to the mouth keys and its motion halves (morph.ts). Omitted: the
   * key is the whole face.
   */
  part?: MorphPart;
}

/** The half of a face an expression key repaints (round 3). */
export type MorphPart = "upper" | "lower";

/** Soft secondary motion inside the morph layer (hair ends, ears): a weight map and its reach. */
export interface MorphSway {
  /** A greyscale image stretched over the morph layer's bbox: R = how loosely that pixel hangs, 0..1. */
  map: string;
  /** Canvas px a weight-1 pixel lags at full spring deflection, in (0, 0.05 * width]. */
  amp: number;
}

/** Morph keys of one layer (companion-lanes): the portrait lane's face. */
export interface RigMorph {
  /** The layer the keys repaint (kind "head", visible). */
  layer: string;
  /** One image holding every key's colour cell (rig-relative name, straight alpha). */
  atlas: string;
  /** One image holding every key's motion cell; required when any key has `flowCell`. */
  flow?: string;
  /** 1..40 keys; ids unique; at most 4 stops per track. */
  keys: MorphKey[];
  /** The centres of the two eyes, canvas px, the picture's left eye first (the turn's face, the gaze). */
  eyes: [[x: number, y: number], [x: number, y: number]];
  /** Omitted: no sway. */
  sway?: MorphSway;
}
