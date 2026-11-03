// Rig v1 wire contract (.kiro/specs/rig-core/design.md, "Data model").
// This file is the ONLY declaration of these types; docs/rig-format.md describes the same contract.
// Optional fields are omitted when absent, never null.
// Layer.motion (FloatMotion, PulseMotion) is amended by cast-forge (req 1) and Layer.drop by
// cast-forge task 3, Motion.blink by cast-forge task 6; Rig stays version 1.

export const RIG_VERSION = 1 as const;

export type LayerKind = "static" | "body" | "head" | "jaw" | "eye" | "accessory" | "crown";

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
}
