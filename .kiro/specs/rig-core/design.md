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
}
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
Colours: `spec.colors.line_glow -> glow`, `line_core -> rim`, `mouth -> mouth`, eye = `line_core`;
0..1 floats -> `#rrggbb`. Missing spec -> a fixed Malakor-like default palette.

## Pose math
For each layer (z order): base position = bbox top-left. Head yaw/pitch in degrees (clamped
±22 / ±12, the clamp Overlord measured for 2.5D artefacts): parallax offset `dx = yaw/22 * 0.04
* width * depth`, `dy = pitch/12 * 0.03 * height * depth`. Followers inherit the parent's gesture translation,
rotation and scale about the parent's anchor, but their parallax comes from their own depth only
(not added to the parent's). Jaw: a drop of `jawOpen * 0.06 * height` along the head's down axis,
applied after the parent transform and capped at `0.06 * height` canvas px; it is not inherited by
the jaw's followers. Blink in [0,1] scales
`eye` layers' y-scale by `1 - 0.9 * blink`. Gestures add a short additive offset curve over
`t` (nod: pitch +6° sine 400 ms; tilt: rotation 5°; lean_in: scale 1.04; recoil: scale .96 and
dy -1%; glare: eye tint gain 1.6; flare: glow gain 2.0).

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
