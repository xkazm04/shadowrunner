# Design: rig-core

## Overview
Pure functions over plain data. Files (each well under the 400-line cap):
```
packages/rig/src/types.ts       the contract below (the ONLY declaration of these types)
packages/rig/src/result.ts      Result<T,E> = { ok: true, value: T } | { ok: false, errors: E }
packages/rig/src/validate.ts    validateRig, RigError
packages/rig/src/serialize.ts   serializeRig (drops undefined keys, stable key order)
packages/rig/src/legacy.ts      importLegacyLayers
packages/rig/src/pose.ts        poseLayers, LayerPose, Drive
packages/rig/src/look.ts        defaultLook, applyLook, lookToEmotionDrive
packages/rig/src/index.ts       re-exports
docs/rig-format.md              human doc of the same contract (kept in sync by the contract-guard hook)
```

## Data model (wire contract)
```ts
export const RIG_VERSION = 1 as const;
export type LayerKind = "static" | "body" | "head" | "jaw" | "eye" | "accessory" | "crown";
export interface Palette { glow: string; eye: string; rim: string; mouth: string } // "#rrggbb"
export interface Layer {
  name: string;               // unique in rig, [a-z0-9_]+
  z: number;                  // unique integer, low = back
  kind: LayerKind;
  file: string;               // PNG name relative to the rig folder, or "data:" URL from the forge
  bbox: [x: number, y: number, w: number, h: number];  // canvas px
  anchor: [x: number, y: number];                      // pivot, canvas px
  follow?: string;            // parent layer name
  depth?: number;             // 0..1, default by kind (static 0, body .3, head .6, jaw .62, eye .7, accessory .75, crown .65)
  visible?: false;            // present only when hidden by default
  motion?: Motion;            // amended by cast-forge (req 1): own float and/or pulse
  drop?: number;              // amended by cast-forge task 3: jaw layers only, travel at jawOpen 1 as a
                              // fraction of height in [0.005, 0.1], default 0.06 (bad_shape at $.layers[i].drop)
  emissive?: boolean;         // amended by cast-forge (emissive fix, task 12 follow-up): gives light (glow pass,
                              // eye colour, glare/flare gain); omitted = kind default (eye, crown, accessory)
}
// Amended by cast-forge (design.md "Motion"); additive, the rig stays version 1. Ranges, checked by
// validateRig as bad_shape at $.layers[i].motion.<field>, every error reported: amp x in
// [0, 0.05*width], y in [0, 0.05*height] px; freq in [0.02, 2] Hz; rot_deg in [0, 15]; phase in [0, 1);
// pulse amp in [0, 1]. Blink (cast-forge task 6): eye layers only (else bad_shape at
// $.layers[i].motion.blink), freq in [0.02, 2] Hz, phase in [0, 1).
export interface FloatMotion { amp: [x: number, y: number]; freq: number; rot_deg?: number; phase?: number }
export interface PulseMotion { amp: number; freq: number; phase?: number }
export interface BlinkMotion { freq: number; phase?: number }
export interface Motion { float?: FloatMotion; pulse?: PulseMotion; blink?: BlinkMotion }
export interface Rig {
  version: typeof RIG_VERSION;
  id: string;                 // slug
  name: string;
  width: number; height: number;
  source: "forge" | "replay" | "import";
  fictional?: true;
  palette: Palette;
  layers: Layer[];
}
export type Emotion = "neutral" | "amused" | "smug" | "irritated" | "furious" | "delighted" | "bored" | "suspicious" | "grim" | "theatrical";
export type Gesture = "nod" | "tilt" | "lean_in" | "recoil" | "glare" | "flare";
export interface Look { palette: Palette; hidden: string[]; emotion: Emotion; gesture?: Gesture }
```

## Legacy import
| legacy `kind` | LayerKind | notes |
|---|---|---|
| static / background | static | depth 0 |
| body | body | |
| head | head | |
| jaw | jaw | `follow: "head"` |
| eye | eye | `follow: "head"` |
| pulse (monocle) | accessory | `follow: "head"` |
| shard_* names | crown | `follow: "head"` |

Motion (amended by cast-forge): legacy `float {amp, freq, rot_deg}` and `pulse {amp, freq}` (from
the layer, else the m8 spec element of the same name) become `motion.float` / `motion.pulse`, with
`phase` from an FNV-1a hash of the layer name (stable, so shards never move in lockstep); a curve
outside the ranges is dropped with a warning. Malakor: 11 floating shards and the pulsing monocle.
Colours: `spec.colors.line_glow -> glow`, `line_core -> rim`, `mouth -> mouth` and `eye` (the teal eye light; director ruling 2026-11-01, rig-core task 7);
0..1 floats -> `#rrggbb`. Missing spec -> a fixed Malakor-like default palette.

## Pose math
For each layer (z order): base position = bbox top-left. Head yaw/pitch in degrees (clamped
±22 / ±12, the clamp Overlord measured for 2.5D artefacts): parallax offset `dx = yaw/22 * 0.04
* width * depth`, `dy = pitch/12 * 0.03 * height * depth`. Followers inherit the parent's gesture translation,
rotation and scale about the parent's anchor, but their parallax comes from their own depth only
(not added to the parent's). Jaw: a drop of `jawOpen * drop * height` along the head's down axis (`drop` the
layer's own, 0.06 when omitted; amended by cast-forge task 3), applied after the parent transform and
capped at `drop * height` canvas px; it is not inherited by
the jaw's followers. Blink in [0,1] scales
`eye` layers' y-scale by `1 - 0.9 * blink`; an eye layer's own `motion.blink` (amended by cast-forge
task 6) is a closure of its own that adds to it, the larger winning. Gestures add a short additive offset curve over
`t` (nod: pitch +6° sine 400 ms; tilt: rotation 5°; lean_in: scale 1.04; recoil: scale .96 and
dy -1%; glare: eye tint gain 1.6; flare: glow gain 2.0; both only on emissive layers, `isEmissive` =
`emissive ?? kind in {eye, crown, accessory}`, amended by cast-forge's emissive fix). Layer motion (amended by cast-forge, its design.md "Motion")
comes last: float about the layer's own anchor after the follow transform, carried rigidly to its
followers (cast-forge task 4); pulse
multiplies the tint; `Drive.still` (reduced motion) zeroes both, and an eye's own blink.

## Emotion table
| emotion | eyeGain | brow | default gesture |
|---|---|---|---|
| neutral | 1.0 | 0 | - |
| amused | 1.2 | +1 | tilt |
| smug | 1.1 | +2 | tilt |
| irritated | 1.3 | -2 | glare |
| furious | 2.0 | -3 | flare |
| delighted | 1.5 | +2 | nod |
| bored | 0.7 | -1 | - |
| suspicious | 1.2 | -1 | lean_in |
| grim | 0.9 | -2 | - |
| theatrical | 1.6 | +3 | flare |

## Testing strategy (fast-check)
- Round trip: `validateRig(JSON.parse(serializeRig(r)))` ok for arbitrary valid rigs.
- Fault seeding: arbitrary single mutations (bbox out of bounds, duplicate z, follow cycle, bad
  colour) are each rejected with the right code.
- Purity and non-mutation of `poseLayers` / `applyLook` (deep-freeze inputs).
- Parallax monotonic in depth; jaw moves only jaw layers.
- Golden: Malakor import has 0 errors and 18 layers.

## Amendment: character-control (2026-11-03)
The emotion table above is superseded by `.kiro/specs/character-control/design.md` "Moods": the same
`eyeGain`, `brow` and default gesture, plus held `headTilt`, `headPitch`, `squint`, `jawSet`,
`glowGain` and `browLift` columns, a 250 ms crossfade (`Drive.mood`), and expression faces
(`Layer.variants`, `LayerPose.faces`, `EMOTION_FAMILY`). Brow layers (`/^brow(_|$)/`) take the brow
offset when the rig has them; otherwise the eyes move as before. `Layer.regions`, `Look.regions` and
`Look.shape` (`PartShape`, applied before the follow chain) are additive; Rig stays version 1.
