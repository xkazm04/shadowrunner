# Design: character-control

Decisions come from the owner's design dialog of 2026-11-03 (`.spark/Spark/ideas/character-control.md`,
"Design decisions"). The wire types and constants in this file are committed by task 0 in
`packages/rig/src/types.ts`, `packages/rig/src/control.ts` and `packages/forge/src/wire.ts`; this file
and those are the contract. Absent values are OMITTED everywhere (never `null`, never an identity
object): an absent region colour, shape or variant means the base art.

## Wire types (task 0)

```ts
// packages/rig/src/types.ts
export type ExpressionFamily = "joy" | "showman" | "anger" | "gloom" | "smug" | "suspicion";
export interface LayerPatch { file: string; bbox: [x: number, y: number, w: number, h: number]; mode: "over" | "replace" }
export interface RegionSlot { id: string; name: string; hex: string }        // id [a-z0-9_]+, hex "#rrggbb"
export interface LayerRegions { map: string; slots: RegionSlot[] }           // 1..4 slots
export interface PartShape { size: number; sx: number; sy: number; dx: number; dy: number; rot: number }
// Layer gains:  variants?: Partial<Record<ExpressionFamily, LayerPatch>>;  regions?: LayerRegions;
// Look gains:   regions?: Record<string, string>   // key `${layer}/${slotId}` -> "#rrggbb"
//               shape?: Record<string, PartShape>  // key layer name
// Drive gains:  mood?: { from: Emotion; mix: number }   // mix 0..1 from `from` to look.emotion; absent = 1
// LayerPose gains: faces?: { family: ExpressionFamily; weight: number }[]  // absent = base only

// packages/forge/src/wire.ts
// ForgeStatus gains "expressing" (between "filling" and "done").
// JobView gains: expressions?: Partial<Record<ExpressionFamily, "ok" | "skipped" | "failed">>
```

`packages/rig/src/control.ts` (task 0 constants, task 1 behaviour):

```ts
export const EXPRESSION_FAMILIES: readonly ExpressionFamily[] = ["joy", "showman", "anger", "gloom", "smug", "suspicion"];
export const EMOTION_FAMILY: Readonly<Record<Emotion, ExpressionFamily | null>> = {
  neutral: null, amused: "joy", delighted: "joy", theatrical: "showman", irritated: "anger",
  furious: "anger", bored: "gloom", grim: "gloom", smug: "smug", suspicious: "suspicion" };
export const SHAPE_LIMITS = { size: [0.6, 1.6], sx: [0.6, 1.6], sy: [0.6, 1.6], dx: [-0.15, 0.15], dy: [-0.15, 0.15], rot: [-25, 25] } as const;
export const IDENTITY_SHAPE: PartShape = { size: 1, sx: 1, sy: 1, dx: 0, dy: 0, rot: 0 };
export const MAX_REGION_SLOTS = 4;
export const MOOD_FADE_S = 0.25;
export function clampShape(value: Partial<PartShape>): PartShape;   // fills from IDENTITY_SHAPE, clamps
export function isIdentityShape(shape: PartShape): boolean;
export function regionKey(layer: string, slot: string): string;    // `${layer}/${slot}`
```

`dx`, `dy` are fractions of `rig.width` (both axes, so a square offset is square); `rot` is degrees.

## Recolour (requirements 1, 2)

One rule everywhere, implemented once in GLSL (`packages/avatar/src/gl/programs.ts`) and once in TS
(`packages/avatar/src/render/recolour.ts`, used by canvas2d and the tests):

```
src (r,g,b) in 0..1 -> HSL (h, s, l); target hex -> (ht, st, lt)
out = HSL->RGB(ht, max(st * S_KEEP + s * (1 - S_KEEP), S_FLOOR * st), l)
S_KEEP = 0.85, S_FLOOR = 0.6
```

Lightness (the painting) is kept; hue becomes the target's; saturation mostly the target's, with a
floor so a grey robe still turns the chosen colour. Applied:

- **Eye light**: every pixel of every `eye` layer (emissive or not), then times the emotion's
  `eyeGain` as today. Replaces the old multiply.
- **Glow**: the glow pass tint, as today, and every pixel of emissive layers whose saturation > 0.25
  (the coloured light, not white highlights).
- **Mouth light**: the `cavity` region slot of `jaw` layers; and every pixel of a layer named
  `mouth_glow` (Malakor).
- **Region**: pixels whose index-map value is `slot + 1`, when `look.regions` has the key.
- **Rim**: stays additive; `RIM_STRENGTH` 0.35 -> 0.6.

A look whose lights equal the rig palette and that has no regions draws exactly as today (no pixel
changes; the shader path is skipped by a uniform flag). canvas2d: recolour into an offscreen canvas
per layer, cached by `layer.file + '|' + the layer's effective recolour key`; GL vs canvas2d agree
within 3/255 per channel on the test fixtures.

## Regions (requirement 2; `packages/forge/src/regions.ts`)

Per layer image, offline and live, no model call, deterministic:
1. Opaque pixels (alpha >= 128) only. Features per pixel: hue (circular), saturation, lightness.
2. Near-grey pixels (s < 0.12) form a lightness class (dark < 0.35 <= mid < 0.7 <= light); coloured
   pixels are binned by hue into 12 bins of 30 degrees.
3. Classes are merged greedily (smallest first into its nearest neighbour by hue, then lightness)
   until at most `MAX_REGION_SLOTS` remain and none holds < 4% of the opaque pixels.
4. A 3x3 majority filter on the index map removes speckle (ties keep the centre).
5. Slots are ordered by pixel count, ids `r1..r4`, names `<part>` for the largest, `<part> 2`... ;
   on a `jaw` layer the slot covering the painted cavity (`mouth.ts` cavity mask) is id `cavity`,
   name `mouth`. `hex` is the slot's median colour.
6. The map is a PNG the size of the layer image, R = slot index + 1 (0 none), G = B = 0, A = 255;
   file name `<layer>.regions.png`.
7. Layers with one class or < 2% opaque pixels get no `regions`; `background` never does.

## Moods (requirement 4)

`EmotionDrive` (packages/rig/src/look.ts) gains columns; `EMOTION_TABLE` becomes:

| emotion | eyeGain | brow | gesture | headTilt | headPitch | squint | jawSet | glowGain | browLift |
|---|---|---|---|---|---|---|---|---|---|
| neutral | 1.0 | 0 | - | 0 | 0 | 0 | 0 | 1.0 | 0 |
| amused | 1.2 | 1 | tilt | 4 | 0 | 0.15 | 0.05 | 1.1 | 0.006 |
| smug | 1.1 | 2 | tilt | 6 | -2 | 0.25 | 0 | 1.1 | 0.008 |
| irritated | 1.3 | -2 | glare | 0 | 3 | 0.25 | 0 | 1.2 | -0.008 |
| furious | 2.0 | -3 | flare | 0 | 5 | 0.35 | 0.1 | 1.6 | -0.012 |
| delighted | 1.5 | 2 | nod | -3 | -2 | 0.2 | 0.2 | 1.3 | 0.01 |
| bored | 0.7 | -1 | - | 5 | 4 | 0.35 | 0 | 0.7 | -0.004 |
| suspicious | 1.2 | -1 | lean_in | -4 | 2 | 0.4 | 0 | 1.0 | -0.006 |
| grim | 0.9 | -2 | - | 0 | 4 | 0.15 | 0 | 0.8 | -0.008 |
| theatrical | 1.6 | 3 | flare | -5 | -4 | 0 | 0.25 | 1.5 | 0.014 |

Units: `headTilt` degrees (positive = clockwise roll on screen), `headPitch` degrees (positive =
chin down, added to `Drive` pitch before its clamp), `squint` = extra eye y-squash (0..0.4, combined
with blink as `1 - (1 - blinkSquash) * (1 - squint)`), `jawSet` = extra `jawOpen` (added, clamped to
1), `glowGain` multiplies the tint of emissive layers, `browLift` = fraction of rig height (positive
raises).

- **Brow layers**: layers whose name matches `/^brow(_|$)/` (Reveille's `brow_l`, `brow_r`). When the
  rig has any, `browLift` translates them and `brow` no longer moves the eyes; the inner end tilts by
  `-browLift * 600` degrees for the left brow and the opposite for the right (an angry V when
  negative). When it has none, the eyes shift as today (`BROW_STEP`).
- **Hold**: these values are held while the emotion is on; the gesture still fires on change.
- **Crossfade**: `Drive.mood = { from, mix }`; every numeric column is `lerp(from, to, smoothstep(mix))`.
  `AvatarCanvas` advances `mix` over `MOOD_FADE_S` on an emotion change; reduced motion sets mix 1.
- **Faces**: with `fa = EMOTION_FAMILY[from]`, `fb = EMOTION_FAMILY[look.emotion]`, a layer with
  variants gets `faces` = `[{family: fa, weight: 1 - m}]` (if fa has a variant on this layer) plus
  `[{family: fb, weight: m}]` (if fb has one), `m = smoothstep(mix)`. Renderer: draw the base with
  opacity `1 - sum(weights of replace-mode faces)`, then each face's patch at its bbox with opacity
  weight, in the layer's transform, with the layer's recolour applied.

## Reshape (requirement 3)

In `poseLayers`, a layer's `PartShape` applies before its follow chain is resolved, so followers
inherit it: scale `(size*sx, size*sy)` about the layer's anchor, rotation `rot` degrees about the
anchor, translation `(dx*W, dy*W)`. A layer with no entry poses exactly as today.

## Expressions (requirement 5; `packages/forge/src/expressions.ts`)

```ts
export const EXPRESSION_DRIFT_LIMIT = 20;          // mean abs diff /255 inside the mask
export function expressionPrompt(name: string, family: ExpressionFamily, style?: string): string;
export function faceMask(rig: Rig, layers: ReadonlyMap<string, ImageLike>): ImageLike; // canvas-size alpha
export interface VariantCut { family: ExpressionFamily; drift: number; patches: Record<string, { patch: LayerPatch; image: ImageLike }>; flagged: boolean }
export function cutVariants(rig: Rig, layers: ReadonlyMap<string, ImageLike>, portrait: ImageLike, edited: ImageLike, family: ExpressionFamily): VariantCut;
```

- **Prompt** (exact text in `expressions.ts`, pinned by a test to this table): one sentence per
  family over a fixed frame: "Edit this portrait of {name}. Change ONLY the facial expression to
  {FACE}. Keep the same character, pose, framing, art style, colours, lighting, background and every
  other pixel. Do not add or remove objects." with FACE:
  joy "a warm, open delight: eyes smiling and slightly narrowed, brows raised, mouth in a broad smile",
  showman "a theatrical showman's flourish: eyes wide, brows high and arched, mouth open in a grand
  exclamation", anger "fury: brows drawn down hard into a V, eyes narrowed and glaring, mouth in a
  snarl showing teeth", gloom "gloom: heavy lowered eyelids, brows flat and low, mouth a flat or
  downturned line", smug "smug superiority: one brow raised, eyes half-lidded, a one-sided smirk",
  suspicion "suspicion: eyes narrowed sideways, one brow lowered, lips pressed tight".
- **Face mask**: union of the opaque pixels of `eye`, `jaw` and brow layers and of the rig's
  face band (the head layer's pixels between the top of the highest brow/eye bbox minus 6% of the
  head height and the bottom of the jaw bbox plus 3%), dilated by 2% of the rig width, feathered 8 px.
- **Cut**: composite = `edited` inside the mask, `portrait` outside (feathered). Drift = mean
  |edited - portrait| inside the mask over the pixels the edit did NOT mean to change (the mask's
  outer 25% ring); flagged when > `EXPRESSION_DRIFT_LIMIT`. For every layer of kind `head`, `eye`,
  `jaw` or a brow layer: re-cut the layer from the composite with its own matte; if its pixels differ
  from the base cut (mean > 2/255 within its bbox), emit a patch cropped to the changed area plus
  4 px: `mode: "replace"` for `eye` and `jaw` layers and brow layers, `mode: "over"` for `head`;
  file name `<layer>.<family>.png`.
- **Live**: `ForgeStatus` gains `"expressing"`; after assembly the job enters it with an
  `expressionIndex` 0; each GET runs one family: `editImage(portrait, expressionPrompt(...))`
  (charged as `costs.expression` = the fill edit's price), `cutVariants`, store the patches, set
  `expressions[family]`. A throw, a spent daily budget (`ctx.charge` refused) or a flagged drift
  records `"failed"`/`"skipped"` and moves on; after the sixth, status `done`. The quota counts the
  forge once (at POST, as today). `DEFAULT_LIMITS.dailyUsd` 5 -> 30.
- **Offline**: `scripts/cast/expressions.mjs <slug> [--families a,b] [--request|--import]`:
  `--request` writes `var/cast-expr/<slug>/<family>.request.txt` (the Codex request: the prompt plus
  "save the result as <family>.png in this folder") and prints the `codex exec` commands;
  `--import` reads `var/cast-expr/<slug>/<family>.png`, area-resizes to the portrait size, runs
  `cutVariants`, writes the patches into `assets/replay/forge/<slug>/` and the `variants` into its
  `job.json` (Malakor: `assets/characters/malakor/rig/expressions/` and a `variants.json` sidecar
  that `seed.ts` merges into his imported rig). `scripts/cast/regions.mjs <slug|--all>` writes the
  region maps and `regions` the same way. Both keep each file's own line endings.

## On air (requirement 6)

`"Put on air"` (SignalCards, ForgeWake) writes `localStorage["sr.onAir"] = record.id` before
navigating. `AirPage` and `WallLive` read it, load that record from the library store (IndexedDB) with
its saved look; when absent, unreadable or deleted they use Malakor and `defaultLook` (today's
behaviour). The reply's `emotion` sets `look.emotion` as today, so the procedural values and faces
follow it with the crossfade.

## Creator UI (requirements 2, 3; apps/web/src/creator/glass)

- Right column: a two-tab switch at the top, `Mood` (MoodDial, GestureCard, VoiceCard) and `Look`
  (PaletteCard, ShapeCard); ChannelActions stay below both. Tabs are a `role="tablist"` with arrow
  keys. Selecting a part (Layer stack row, or a glass click) switches to Look.
- **PaletteCard**: a "Lights" row (eye, glow, rim, mouth; the mouth chip disabled with "no mouth
  light on this character" when neither a `cavity` slot nor `mouth_glow` exists) and "Regions":
  per layer with regions, its name and one chip per slot. A chip opens the existing swatch Ring plus
  an `<input type="color">`. A recoloured chip shows a reset dot.
- **Glass pick**: a click on the glass (not on a pin) finds the topmost visible layer whose posed
  pixel under the pointer has alpha >= 128, then its region slot; it selects that layer (Shape) and
  slot (Palette) and draws a 1px accent outline of the slot's pixels (an SVG path traced from the
  map, cached) for 1.2 s, steady under reduced motion.
- **ShapeCard**: the selected layer's name, six labelled range inputs with numeric read-outs
  (size, width, height, x, y, tilt), "Reset part", "Reset all".
- `lookReducer` gains `{type: "region", key, value}`, `{type: "shape", layer, value: Partial<PartShape>}`
  (clamped with `clampShape`; an identity result deletes the key), `{type: "shapeReset", layer}`,
  `{type: "shapeResetAll"}`. The library saves and validates `regions` and `shape` (`readLook`).
- Rite: the forge's progress shows "Expressions n / 6" during `expressing`, and the result names
  any family that is "procedural".
