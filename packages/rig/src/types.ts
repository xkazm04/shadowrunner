// Rig v1 wire contract (.kiro/specs/rig-core/design.md, "Data model").
// This file is the ONLY declaration of these types; docs/rig-format.md describes the same contract.
// Optional fields are omitted when absent, never null.

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
