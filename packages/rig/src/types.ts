// Rig v1 wire contract (.kiro/specs/rig-core/design.md, "Data model").
// This file is the ONLY declaration of these types; docs/rig-format.md describes the same contract.
// Optional fields are omitted when absent, never null.
// Layer.motion (FloatMotion, PulseMotion) is amended by cast-forge (req 1) and Layer.drop by
// cast-forge task 3, Motion.blink by cast-forge task 6, Layer.emissive by the cast-forge task 12
// follow-up (emissive per layer); Rig stays version 1.

export const RIG_VERSION = 1 as const;

// face-control: "iris" (the moving part of an eye, following its eye layer) and Rig.face / Look.face.

export type LayerKind = "static" | "body" | "head" | "jaw" | "eye" | "iris" | "accessory" | "crown";

/** Every value is "#rrggbb". */
export interface Palette {
  glow: string;
  eye: string;
  rim: string;
  mouth: string;
}

export interface Layer {
  /** Unique in the rig, [a-z0-9_]+. */
  name: string;
  /** Unique integer, low = back. */
  z: number;
  kind: LayerKind;
  /** PNG name relative to the rig folder, or a "data:" URL from the forge. */
  file: string;
  /** Canvas px. */
  bbox: [x: number, y: number, w: number, h: number];
  /** Pivot, canvas px. */
  anchor: [x: number, y: number];
  /** Parent layer name. */
  follow?: string;
  /** 0..1; default by kind (static 0, body .3, head .6, jaw .62, eye .7, accessory .75, crown .65). */
  depth?: number;
  /** Present only when the layer is hidden by default. */
  visible?: false;
  /** Motion of its own (cast-forge req 1): float and/or pulse. Omitted when the layer has none. */
  motion?: Motion;
  /**
   * Jaw layers only (cast-forge task 3): the drop at `jawOpen = 1` as a fraction of rig height, in
   * [JAW_DROP_MIN, JAW_DROP_MAX]. Omitted means JAW_DROP (0.06, sized for a skull); a human mouth
   * wants about 0.012-0.02.
   */
  drop?: number;
  /**
   * Whether the layer gives light (cast-forge task 12 follow-up): the renderer's glow pass, the
   * palette's eye colour on an eye, and the glare and flare gains. Omitted means the kind's default
   * (`EMISSIVE_KINDS`: eye, crown, accessory); `false` on a part drawn without light of its own (a
   * white glove, a silver crown, a painted iris), `true` on a lit part of another kind.
   */
  emissive?: boolean;
  /**
   * Expression faces (character-control): per family, a patch drawn over (`over`) or instead of
   * (`replace`) the layer's pixels while that family is on. Omitted when the layer has none.
   */
  variants?: Partial<Record<ExpressionFamily, LayerPatch>>;
  /** Colour regions (character-control): an index map and 1..4 recolourable slots. */
  regions?: LayerRegions;
  /**
   * Eye layers with an iris (face-control): an alpha mask (same bbox as the layer) of the lid
   * opening, where the iris may show. Omitted: the eye is one painted piece, as before.
   */
  socket?: string;
  /** Eye layers (face-control): the closed-lid art, same bbox; a blink crossfades to it. */
  closed?: string;
  /**
   * Eye and iris layers (cast-face-pass): `false` when the palette's eye colour must not tint this
   * layer, so its light keeps the art's own colour (a white visor light, a candle). Omitted: tinted.
   */
  tint?: false;
  /**
   * A signature act (tiger L1): the layer's own motion played once when a spoken line says a cue
   * word (`act.ts`). Accessory and crown layers only; readers drop a bad one. Omitted: none.
   */
  act?: LayerAct;
}

/** A signature act (docs/rig-format.md "Act"): cue words and the act's size and length. */
export interface LayerAct {
  /** 1..3 lowercase words, each at most 24 characters. */
  cue: string[];
  /** In [1, 3]; omitted means 1.5. */
  gain?: number;
  /** Seconds, in [0.6, 1.5]; omitted means 1. */
  s?: number;
}

/** The six expression families the ten emotions share (character-control design "Moods"). */
export type ExpressionFamily = "joy" | "showman" | "anger" | "gloom" | "smug" | "suspicion";

/** One face of a layer: a PNG (rig-relative name or data: URL) placed at `bbox`, canvas px. */
export interface LayerPatch {
  file: string;
  bbox: [x: number, y: number, w: number, h: number];
  mode: "over" | "replace";
  /** Eye patches (face-control): this face's lid opening, an alpha mask at the LAYER's bbox. */
  socket?: string;
  /** Eye patches (face-control): the face already narrows the lids, so mood squint adds none. */
  narrowed?: true;
}

/** One recolourable region of a layer: id [a-z0-9_]+ ("cavity" on a jaw), a name, its painted colour. */
export interface RegionSlot {
  id: string;
  name: string;
  /** "#rrggbb", the region's median colour as painted. */
  hex: string;
}

/** `map`: a PNG the size of the layer image, R = slot index + 1 (0 = no region). */
export interface LayerRegions {
  map: string;
  slots: RegionSlot[];
}

/** A part's reshape (character-control design "Reshape"); ranges in `SHAPE_LIMITS`. */
export interface PartShape {
  size: number;
  sx: number;
  sy: number;
  /** Fractions of the rig's width. */
  dx: number;
  dy: number;
  /** Degrees. */
  rot: number;
}

/**
 * A bob and sway about the layer's own anchor (cast-forge design "Motion"), with
 * `w = 2*pi*(freq*t + phase)`: translation `(amp[0]*sin(w), amp[1]*sin(w + pi/2))` canvas px and
 * rotation `rot_deg*sin(w + pi)` degrees, after the inherited follow transform, not inherited.
 */
export interface FloatMotion {
  /** Canvas px; x in [0, 0.05 * width], y in [0, 0.05 * height]. */
  amp: [x: number, y: number];
  /** Hz, in [0.02, 2]. */
  freq: number;
  /** Degrees, in [0, 15]; omitted means 0. */
  rot_deg?: number;
  /** Cycles, in [0, 1); omitted means 0. */
  phase?: number;
}

/** A light-gain oscillation: the layer's tint is multiplied by `1 + amp*(0.5 + 0.5*sin(w))`. */
export interface PulseMotion {
  /** In [0, 1]. */
  amp: number;
  /** Hz, in [0.02, 2]. */
  freq: number;
  /** Cycles, in [0, 1); omitted means 0. */
  phase?: number;
}

/**
 * A periodic blink of the layer's own (cast-forge task 6), `eye` layers only: once per cycle, from
 * the cycle's start `frac(freq*t + phase) = 0`, the eye shuts over OWN_BLINK_S seconds (a half-sine
 * of closure, as the driver's blink). It adds to `Drive.blink` (the larger closure wins). Sibling
 * eyes given staggered phases blink one at a time: a many-eyed character counting.
 */
export interface BlinkMotion {
  /** Hz, in [0.02, 2]. */
  freq: number;
  /** Cycles, in [0, 1); omitted means 0. */
  phase?: number;
}

export interface Motion {
  float?: FloatMotion;
  pulse?: PulseMotion;
  /** Eye layers only (cast-forge task 6). */
  blink?: BlinkMotion;
}

export interface Rig {
  version: typeof RIG_VERSION;
  /** Slug. */
  id: string;
  name: string;
  width: number;
  height: number;
  source: "forge" | "replay" | "import";
  fictional?: true;
  palette: Palette;
  layers: Layer[];
  /**
   * Where the character's mouth is, canvas px, measured by the forge from the jaw's lip line.
   * Optional: rigs made before it load unchanged and consumers fall back to the jaw's box.
   */
  mouth?: RigMouth;
  /** The character's face profile (face-control): gaze, motion, expression strength. Omitted: defaults. */
  face?: RigFace;
  /** Secondary motion (perfection-pass V1, spring.ts). Omitted: defaults. */
  motion?: RigMotion;
  /** Depth turn and lighting (perfection-pass V2, turn.ts). Omitted: defaults. */
  turn?: RigTurn;
  /** Morph keys (companion-lanes, morph.ts): the face of one layer repainted by track weights. Omitted: none. */
  morph?: RigMorph;
}

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
}

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

/** Secondary motion strength (perfection-pass V1); `Look.motion` wins over `Rig.motion`. */
export interface RigMotion {
  /** How strongly loose parts lag and settle, in [0, 2]; 0 disables, omitted means 1. */
  spring?: number;
}

/** Depth turn strengths (perfection-pass V2); `Look.turn` wins over `Rig.turn`, field by field. */
export interface RigTurn {
  /** How far a head turn curves the head's layers, in [0, 1]; 0 disables, omitted means 0.5. */
  warp?: number;
  /** How strongly a head turn moves the light across the face, in [0, 1]; 0 disables, omitted means 0.5. */
  light?: number;
}

/**
 * A face profile (face-control). Every field is optional; `resolveFace` (face.ts) fills defaults
 * and clamps to FACE_LIMITS. `Look.face` overrides `Rig.face` field by field.
 */
/** Expression families whose painted face is retired to procedural motion (retire-a-face). */
export type RetiredFaces = Partial<Record<ExpressionFamily, "procedural">>;

export interface RigFace {
  gaze?: {
    /** How far the iris travels, 0..1 of the socket's half extent. */
    range?: number;
    /** Saccades per second. */
    saccadeRate?: number;
    /** Relative weights of where the eyes go when the character is not looking at anything. */
    habits?: { chat?: number; content?: number; host?: number };
  };
  motion?: {
    /** Multipliers (1 = today's motion) of head drift, mood tilt and gesture peaks. */
    drift?: number;
    tilt?: number;
    gesture?: number;
    /** Breathing idle amplitude, 0 = none. */
    breath?: number;
  };
  /**
   * How strongly the painted expression faces show, 0..1; `faces` retires a family's painted face
   * to procedural motion (retire-a-face), as if its variants were absent. Omitted when none is.
   */
  expression?: { strength?: number; faces?: RetiredFaces };
  /** How strongly emotion bends the mouth (warp and drawn), 0..1.5. */
  mouth?: { emotion?: number };
}

/** The rest mouth: centre x, lip line y, and width (corner to corner), canvas px. */
export interface RigMouth {
  cx: number;
  lineY: number;
  width: number;
  /**
   * "drawn": the player paints its procedural, emotional mouth here (flat, low-poly and line-art
   * styles it suits). Omitted: the art keeps its own neutral lips and the jaw (painterly styles,
   * until an art-preserving mouth exists); the position is still recorded for it.
   */
  render?: "drawn" | "still";
  /**
   * Pixel art: the canvas px of one art pixel. The player's drawn mouth then paints on that grid
   * (a crop at 1/cell resolution, scaled up unsmoothed) so it reads as part of the art. Omitted:
   * smooth paint.
   */
  cell?: number;
  /**
   * The painted lips' extent, measured by the forge: the art-preserving (warp) mouth bends the art
   * inside it. Omitted: the warp falls back to `width` about (cx, lineY).
   */
  lips?: RigLips;
}

/** The painted lips at rest, canvas px: corner x's, the upper lip's top y, the lower lip's bottom y. */
export interface RigLips {
  left: number;
  right: number;
  upper: number;
  lower: number;
  /**
   * Where the lips meet at cx (the parting line), when the forge found it: the warp opens the mouth
   * here. It differs from `lineY` (the jaw cut) on rigs whose jaw was cut above the upper lip.
   * Omitted: the warp parts at `lineY`.
   */
  seam?: number;
  /**
   * cast-face-pass: the painted mouth is already open (teeth around a dark gap, a carved grin), so
   * the warp widens the gap and moves the teeth rows instead of parting closed lips. Omitted: lips.
   */
  maw?: true;
}

export type Emotion =
  | "neutral"
  | "amused"
  | "smug"
  | "irritated"
  | "furious"
  | "delighted"
  | "bored"
  | "suspicious"
  | "grim"
  | "theatrical";

export type Gesture = "nod" | "tilt" | "lean_in" | "recoil" | "glare" | "flare";

export interface Look {
  palette: Palette;
  hidden: string[];
  emotion: Emotion;
  gesture?: Gesture;
  /** Region colours, keyed `${layer}/${slotId}` -> "#rrggbb". Omitted keys draw as painted. */
  regions?: Record<string, string>;
  /** Part reshapes, keyed by layer name. Omitted layers keep their shape. */
  shape?: Record<string, PartShape>;
  /** The viewer's face profile (face-control), over `Rig.face` field by field. */
  face?: RigFace;
  /** The viewer's secondary motion strength (perfection-pass V1), over `Rig.motion`. */
  motion?: RigMotion;
  /** The viewer's depth turn strengths (perfection-pass V2), over `Rig.turn`. */
  turn?: RigTurn;
}
