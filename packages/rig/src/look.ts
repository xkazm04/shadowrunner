// Looks (rig-core req 5): the user's customisation, kept apart from the rig. Pure, no DOM.
//
// Decisions the spec leaves open (documented here so the creator and renderer agree):
// - `applyLook(rig, look)` returns the rig as dressed by the look: a new `Rig` whose palette is the
//   look's and whose layers named in `look.hidden` carry `visible: false`. A layer already hidden by
//   default stays hidden; names in `look.hidden` that match no layer are ignored. Emotion and
//   gesture are not rig fields, so they do not appear in the result. The result shares no objects
//   or arrays with either input.
// - `brow` is in the table's own units (signed steps, + raises the brow); the renderer and driver
//   choose the pixel scale.
// - An emotion with no default gesture ("-" in the table) has no `gesture` key (omitted, never null).
import type { Emotion, Gesture, Layer, Look, Palette, Rig } from "./types.js";

export interface EmotionDrive {
  /** Multiplier on the eye light; 1 = as drawn. */
  eyeGain: number;
  /** Signed brow offset in table steps; positive raises. */
  brow: number;
  /** Gesture played when the emotion is chosen; absent when there is none. */
  gesture?: Gesture;
}

/** design.md "Emotion table". */
export const EMOTION_TABLE: Readonly<Record<Emotion, Readonly<EmotionDrive>>> = Object.freeze({
  neutral: Object.freeze({ eyeGain: 1.0, brow: 0 }),
  amused: Object.freeze({ eyeGain: 1.2, brow: 1, gesture: "tilt" }),
  smug: Object.freeze({ eyeGain: 1.1, brow: 2, gesture: "tilt" }),
  irritated: Object.freeze({ eyeGain: 1.3, brow: -2, gesture: "glare" }),
  furious: Object.freeze({ eyeGain: 2.0, brow: -3, gesture: "flare" }),
  delighted: Object.freeze({ eyeGain: 1.5, brow: 2, gesture: "nod" }),
  bored: Object.freeze({ eyeGain: 0.7, brow: -1 }),
  suspicious: Object.freeze({ eyeGain: 1.2, brow: -1, gesture: "lean_in" }),
  grim: Object.freeze({ eyeGain: 0.9, brow: -2 }),
  theatrical: Object.freeze({ eyeGain: 1.6, brow: 3, gesture: "flare" }),
});

const copyPalette = (palette: Palette): Palette => ({
  glow: palette.glow,
  eye: palette.eye,
  rim: palette.rim,
  mouth: palette.mouth,
});

const copyLayer = (layer: Layer): Layer => ({ ...layer, bbox: [...layer.bbox], anchor: [...layer.anchor] });

/** Eye-light gain, brow offset and default gesture for `emotion`, as a fresh object. */
export function lookToEmotionDrive(emotion: Emotion): EmotionDrive {
  const row = EMOTION_TABLE[emotion];
  return row.gesture === undefined ? { eyeGain: row.eyeGain, brow: row.brow } : { eyeGain: row.eyeGain, brow: row.brow, gesture: row.gesture };
}

/** The rig's own palette, nothing hidden, neutral, no gesture. */
export function defaultLook(rig: Rig): Look {
  return { palette: copyPalette(rig.palette), hidden: [], emotion: "neutral" };
}

/** A new rig dressed by `look` (palette replaced, `look.hidden` layers set `visible: false`). Never mutates its inputs. */
export function applyLook(rig: Rig, look: Look): Rig {
  const hidden = new Set(look.hidden);
  return {
    ...rig,
    palette: copyPalette(look.palette),
    layers: rig.layers.map((layer): Layer => {
      const copy = copyLayer(layer);
      if (hidden.has(layer.name)) copy.visible = false;
      return copy;
    }),
  };
}
