// Looks (rig-core req 5): the user's customisation, kept apart from the rig. Pure, no DOM.
//
// Decisions the spec leaves open (documented here so the creator and renderer agree):
// - `applyLook(rig, look)` returns the rig as dressed by the look: a new `Rig` whose palette is the
//   look's and whose layers named in `look.hidden` carry `visible: false`. A layer already hidden by
//   default stays hidden; names in `look.hidden` that match no layer are ignored. Emotion and
//   gesture are not rig fields, so they do not appear in the result. The result shares no objects
//   or arrays with either input.
// - `brow` is in the table's own units (signed steps, + raises the brow); the renderer maps one
//   step to `0.004 * rig.height` canvas px.
// - An emotion with no default gesture ("-" in the table) has no `gesture` key (omitted, never null).
// - Gesture precedence (`resolveGesture`): `look.gesture` when set, otherwise the emotion's default.
import type { Emotion, Gesture, Layer, Look, Palette, Rig } from "./types.js";

export interface EmotionDrive {
  /** Multiplier on the eye light; 1 = as drawn. */
  eyeGain: number;
  /** Signed brow offset in table steps; positive raises. One step = `0.004 * rig.height` px. */
  brow: number;
  /** Gesture played when the emotion is chosen; absent when there is none. */
  gesture?: Gesture;
  /** Held head roll, degrees; positive = clockwise on screen (character-control "Moods"). */
  headTilt: number;
  /** Held head pitch, degrees; positive = chin down, added to `Drive.headPitch` before its clamp. */
  headPitch: number;
  /** Extra eye y-squash, 0..0.4, combined with the blink as `1 - (1 - blink) * (1 - squint)`. */
  squint: number;
  /** Extra `jawOpen`, added and clamped to 1. */
  jawSet: number;
  /** Multiplier on the tint of emissive layers; 1 = as drawn. */
  glowGain: number;
  /** Brow-layer lift as a fraction of rig height; positive raises. */
  browLift: number;
}

/** The numeric columns of EmotionDrive, the ones a mood crossfade blends. */
export type MoodColumn = Exclude<keyof EmotionDrive, "gesture">;
export const MOOD_COLUMNS: readonly MoodColumn[] = Object.freeze(["eyeGain", "brow", "headTilt", "headPitch", "squint", "jawSet", "glowGain", "browLift"]);

type Row = [eyeGain: number, brow: number, gesture: Gesture | undefined, headTilt: number, headPitch: number, squint: number, jawSet: number, glowGain: number, browLift: number];
const row = ([eyeGain, brow, gesture, headTilt, headPitch, squint, jawSet, glowGain, browLift]: Row): Readonly<EmotionDrive> =>
  Object.freeze({ eyeGain, brow, ...(gesture === undefined ? {} : { gesture }), headTilt, headPitch, squint, jawSet, glowGain, browLift });

/** rig-core design.md "Emotion table", extended by character-control design.md "Moods" (verbatim). */
export const EMOTION_TABLE: Readonly<Record<Emotion, Readonly<EmotionDrive>>> = Object.freeze({
  neutral: row([1.0, 0, undefined, 0, 0, 0, 0, 1.0, 0]),
  amused: row([1.2, 1, "tilt", 4, 0, 0.15, 0.05, 1.1, 0.006]),
  smug: row([1.1, 2, "tilt", 6, -2, 0.25, 0, 1.1, 0.008]),
  irritated: row([1.3, -2, "glare", 0, 3, 0.25, 0, 1.2, -0.008]),
  furious: row([2.0, -3, "flare", 0, 5, 0.35, 0.1, 1.6, -0.012]),
  delighted: row([1.5, 2, "nod", -3, -2, 0.2, 0.2, 1.3, 0.01]),
  bored: row([0.7, -1, undefined, 5, 4, 0.35, 0, 0.7, -0.004]),
  suspicious: row([1.2, -1, "lean_in", -4, 2, 0.4, 0, 1.0, -0.006]),
  grim: row([0.9, -2, undefined, 0, 4, 0.15, 0, 0.8, -0.008]),
  theatrical: row([1.6, 3, "flare", -5, -4, 0, 0.25, 1.5, 0.014]),
});

const copyPalette = (palette: Palette): Palette => ({
  glow: palette.glow,
  eye: palette.eye,
  rim: palette.rim,
  mouth: palette.mouth,
});

const copyLayer = (layer: Layer): Layer => ({ ...layer, bbox: [...layer.bbox], anchor: [...layer.anchor] });

/** Every column of `emotion`'s row (gesture omitted when it has none), as a fresh object. */
export function lookToEmotionDrive(emotion: Emotion): EmotionDrive {
  return { ...EMOTION_TABLE[emotion] };
}

/** 0..1 -> 0..1, `3m^2 - 2m^3`; non-finite or out-of-range input is clamped (NaN -> 1, settled). */
export function smoothstep(mix: number): number {
  const m = Number.isNaN(mix) ? 1 : Math.min(1, Math.max(0, mix));
  return m * m * (3 - 2 * m);
}

/**
 * The mood held at this frame (character-control design "Moods", "Crossfade"): every numeric
 * column is `lerp(from, to, smoothstep(mix))`; the gesture is `to`'s. `mood` absent means settled.
 */
export function moodDrive(to: Emotion, mood?: { from: Emotion; mix: number }): EmotionDrive {
  const target = lookToEmotionDrive(to);
  if (mood === undefined || mood.from === to) return target;
  const m = smoothstep(mood.mix);
  if (m === 1) return target;
  const source = EMOTION_TABLE[mood.from];
  for (const column of MOOD_COLUMNS) target[column] = source[column] + (target[column] - source[column]) * m;
  return target;
}

/** The gesture to play for `look`: `look.gesture` when set, otherwise the emotion's default (or none). */
export function resolveGesture(look: Look): Gesture | undefined {
  return look.gesture ?? EMOTION_TABLE[look.emotion].gesture;
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
