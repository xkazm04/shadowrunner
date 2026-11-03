# Rig v1 format

A **Rig** is the layered 2.5D description of a character's face: a canvas size, a palette and a
stack of PNG layers with pivots. A **Look** is the user's customisation of a rig, stored separately
so a streamer can try looks without re-forging.

The contract is declared once, in `packages/rig/src/types.ts`; the spec of record is
`.kiro/specs/rig-core/design.md` ("Data model"). This page describes the same fields in prose. If
they disagree, the spec wins and this page and the code are fixed to match.

## Wire rules

- `version` is the literal number `1` (`RIG_VERSION`).
- Optional fields are **omitted** when absent. They are never `null`, and the serializer drops
  `undefined` keys.
- Coordinates are canvas pixels, with the origin at the top-left of a `width` x `height` canvas.
- Colours are strings of the form `#rrggbb` (six hex digits).
- External rig data enters only through `packages/rig/src/validate.ts`: `parseRigJson(text)` is
  the only `JSON.parse` of rig text (malformed JSON is `bad_shape` at path `$`), and
  `validateRig(value)` checks an already-decoded value. Both return every error they find.

## Rig

| field | type | required | meaning |
|---|---|---|---|
| `version` | `1` | yes | Format version. |
| `id` | string | yes | Slug identifying the rig. |
| `name` | string | yes | Display name. |
| `width` | integer | yes | Canvas width in px; a positive integer. |
| `height` | integer | yes | Canvas height in px; a positive integer. |
| `source` | `"forge"` \| `"replay"` \| `"import"` | yes | Where the rig came from: made by the forge pipeline, served from the replay plane, or converted from a legacy Overlord `layers.json`. |
| `fictional` | `true` | no | Present only on fabricated data. Never written as `false`. |
| `palette` | Palette | yes | The rig's default colours. |
| `layers` | Layer[] | yes | The layer stack. |

## Palette

Four colours, each `#rrggbb`:

| field | meaning |
|---|---|
| `glow` | Main line glow. |
| `eye` | Eye light. |
| `rim` | Rim / line core. |
| `mouth` | Mouth interior. |

## Layer

| field | type | required | meaning |
|---|---|---|---|
| `name` | string | yes | Unique within the rig; characters `[a-z0-9_]` only. |
| `z` | integer | yes | Unique within the rig. Low values are drawn at the back. |
| `kind` | LayerKind | yes | What the layer is; drives animation (see below). |
| `file` | string | yes | PNG path relative to the rig folder, or a PNG `data:` URL produced by the forge (see "Layer files"). |
| `bbox` | `[x, y, w, h]` | yes | Where the PNG sits on the canvas, in px. `w` and `h` are > 0. Must lie inside `[0, width] x [0, height]`; the right and bottom edges may overshoot by at most 1e-6 px (float bboxes from the forge), the left and top edges not at all. |
| `anchor` | `[x, y]` | yes | Pivot point in canvas px; rotation and followers turn about it. |
| `follow` | string | no | Name of a parent layer. The layer inherits the parent's gesture translation, rotation and scale about the parent's anchor, but not its parallax or jaw drop (see "Pose"). Must name an existing layer, with no cycles. |
| `depth` | number | no | Parallax depth in `[0, 1]`, from 0 (background) to 1 (nearest). When omitted, the default for the kind applies. |
| `visible` | `false` | no | Present only when the layer is hidden by default. Never written as `true`. |
| `motion` | Motion | no | The layer's own float and/or pulse (see "Motion"). Omitted when the layer has none. Amended by cast-forge; the format stays version 1. |
| `drop` | number | no | `jaw` layers only: the drop at `jawOpen = 1` as a fraction of `height`, in `[0.005, 0.1]`. Omitted means 0.06 (a skull's gape); a human mouth wants about 0.012-0.02. On any other kind, or out of range, it is `bad_shape` at `$.layers[i].drop`. Amended by cast-forge task 3; the format stays version 1. |
| `emissive` | boolean | no | Whether the layer gives light: its bright pixels feed the glow pass (tinted `palette.glow`), an `eye` takes `palette.eye`, and `glare` / `flare` raise its tint. Omitted means the kind's default: `eye`, `crown` and `accessory` give light, the other kinds do not. `false` on a part drawn without light of its own (a white glove, a silver crown, a painted iris); its own `motion.pulse` still applies. Not a boolean is `bad_shape` at `$.layers[i].emissive`. Amended by cast-forge (emissive fix, task 12 follow-up); the format stays version 1. |
| `variants` | object | no | Expression faces (see "Variants"): per expression family, a patch drawn over or instead of the layer while that family is on. Omitted when the layer has none. Amended by character-control; the format stays version 1. |
| `regions` | LayerRegions | no | Recolourable colour regions (see "Regions"): an index map and 1..4 slots. Omitted when the layer has none. Amended by character-control; the format stays version 1. |

### Layer files

`file` is one of:

- a relative POSIX path inside the rig folder, such as `head.png` or `parts/eye_l.png`. It must
  not be empty, start with `/`, contain a backslash or a `:` (no scheme or drive letter), have an
  empty segment (`a//b.png`, a trailing `/`) or a `..` segment. `.` segments are allowed.
- a `data:image/png;base64,` URL with a non-empty payload, as the forge produces. No other
  `data:` type is accepted.

Anything else is `bad_shape` at `$.layers[i].file`.

### LayerKind and default depth

| kind | default `depth` |
|---|---|
| `static` | 0 |
| `body` | 0.3 |
| `head` | 0.6 |
| `jaw` | 0.62 |
| `eye` | 0.7 |
| `accessory` | 0.75 |
| `crown` | 0.65 |

### Motion

Amended by cast-forge (`.kiro/specs/cast-forge/design.md`, "Motion"). Additive: a rig without
`motion` behaves exactly as before, and `version` stays `1`.

| field | type | required | range | meaning |
|---|---|---|---|---|
| `float` | FloatMotion | no | | A bob and sway about the layer's own anchor. |
| `float.amp` | `[x, y]` | yes | x in `[0, 0.05 * width]`, y in `[0, 0.05 * height]` | Canvas px. |
| `float.freq` | number | yes | `[0.02, 2]` | Hz. |
| `float.rot_deg` | number | no | `[0, 15]` | Degrees; omitted means 0. |
| `float.phase` | number | no | `[0, 1)` | Cycles; omitted means 0. |
| `pulse` | PulseMotion | no | | A light-gain oscillation. |
| `pulse.amp` | number | yes | `[0, 1]` | Gain amplitude. |
| `pulse.freq` | number | yes | `[0.02, 2]` | Hz. |
| `pulse.phase` | number | no | `[0, 1)` | Cycles; omitted means 0. |
| `blink` | BlinkMotion | no | | `eye` layers only (amended by cast-forge task 6): a blink of the layer's own, once per cycle. On any other kind it is `bad_shape` at `$.layers[i].motion.blink`. |
| `blink.freq` | number | yes | `[0.02, 2]` | Hz: blinks per second. |
| `blink.phase` | number | no | `[0, 1)` | Cycles; omitted means 0. The eye shuts where `freq*t + phase` is whole. |

A motion with neither curve (`{}`) is valid and does nothing. Any field outside its range, or of
the wrong type, is `bad_shape` at `$.layers[i].motion.<field>` (for example
`$.layers[3].motion.float.amp[1]` or `$.layers[3].motion.pulse.freq`); every fault is reported.
Fields outside the contract are dropped. Builders give sibling floats different phases so a set of
parts never moves in lockstep. An eye's own blink is a half-sine of closure over `OWN_BLINK_S`
(0.15 s) from each cycle's start, 0 for the rest of the cycle (`ownBlinkAt`); sibling eyes given
staggered phases blink one at a time (the Tallyman's six eyes counting).

### Variants

Amended by character-control (`.kiro/specs/character-control/design.md`, "Moods"). The ten
emotions share six **expression families**: `joy` (amused, delighted), `showman` (theatrical),
`anger` (irritated, furious), `gloom` (bored, grim), `smug` (smug), `suspicion` (suspicious);
`neutral` is the base art (`EMOTION_FAMILY` in `packages/rig/src/control.ts`). `variants` maps a
family to a LayerPatch:

| field | type | required | meaning |
|---|---|---|---|
| `file` | string | yes | The patch PNG, under the same rules as a layer's `file` (see "Layer files"). |
| `bbox` | `[x, y, w, h]` | yes | Where the patch sits on the canvas, in px; `w` and `h` > 0, inside the canvas like a layer's bbox. |
| `mode` | `"over"` \| `"replace"` | yes | `over` draws the patch on top of the layer; `replace` fades the layer's own pixels out by the face's weight. |

A key that is not a family, a bad `file`, a bbox that is not four finite numbers or has `w`/`h` <= 0,
or a `mode` other than the two is `bad_shape` at `$.layers[i].variants.<family>[.field]`; a patch
bbox leaving the canvas is `bbox_out_of_bounds` at `$.layers[i].variants.<family>.bbox`. Every fault
is reported. The serializer writes families in the order above.

### Regions

Amended by character-control (design.md "Regions"). `regions` is `{ map, slots }`:

| field | type | required | meaning |
|---|---|---|---|
| `map` | string | yes | An index-map PNG the size of the layer image (rules of "Layer files"): R = slot index + 1, 0 for no region. |
| `slots` | RegionSlot[] | yes | 1..4 (`MAX_REGION_SLOTS`) slots, in index order. |
| `slots[j].id` | string | yes | `[a-z0-9_]+`, unique in the layer. A jaw's painted mouth is `cavity`. |
| `slots[j].name` | string | yes | Non-empty display name (`robe`, `robe 2`, `mouth`). |
| `slots[j].hex` | string | yes | The region's colour as painted, `#rrggbb`. |

Shape faults are `bad_shape` at `$.layers[i].regions...` (`map`, `slots` with fewer than 1 or more
than 4 entries, a bad or repeated `id`, an empty `name`); a `hex` that is not `#rrggbb` is
`bad_color` at `$.layers[i].regions.slots[j].hex`. Every fault is reported.


`importLegacyLayers(json, spec?)` (`packages/rig/src/legacy.ts`) converts an Overlord-era
`layers.json` with `rig_type: "glow"`, plus an optional `m8.spec.json`, into a Rig with
`source: "import"`. The result is passed through `validateRig`, so a successful import is always
a valid Rig. It returns `{ rig, warnings }`, where each warning is `{ layer, message }`.

| legacy `kind` | LayerKind | `follow` | `depth` |
|---|---|---|---|
| `static`, `background` | `static` | - | always 0 |
| `body` | `body` | - | legacy |
| `head` | `head` | - | legacy |
| `jaw`, `aperture_lower` | `jaw` | `"head"` | legacy |
| `eye` | `eye` | `"head"` | legacy |
| `pulse` (monocle) | `accessory` | `"head"` | legacy |
| any kind, name starting `shard_` | `crown` | `"head"` | legacy |
| anything else | `accessory` (with a warning) | - | legacy |

- **Depth.** "legacy" means a legacy per-layer `depth` in `[0, 1]` is kept. A missing depth is
  omitted, so the kind default applies. Any other value (out of range, not a number) produces a
  warning and is dropped, so the kind default applies.
- **Skipped layers.** A legacy layer with no `file` (such as Malakor's `mouth_glow`) has no image
  and is skipped with a warning.
- **Motion** (amended by cast-forge). A legacy `float {amp, freq, rot_deg}` and `pulse {amp, freq}`
  are kept as `motion.float` and `motion.pulse`, taken from the layer, or else from the
  `spec.elements` entry of the same name. Each gets `phase` from the FNV-1a hash of the layer name
  (`phaseFromName`, on a 1/1000 grid in `[0, 1)`), so the import is stable and sibling shards never
  move in lockstep. A curve outside the ranges above is dropped with a warning. Malakor imports 11
  floating shards and a pulsing monocle.
- **Dropped fields.** Numeric follow weights, gains, blend modes and other Overlord-only fields are
  not carried over. A legacy layer's `variants` and `regions` (character-control, merged from a
  sidecar) are passed through to `validateRig`.
- **Colours.** From `spec.colors` (0..1 RGB triples, rounded to `#rrggbb`): the eye light `mouth`
  (Malakor's teal) -> `eye` and `mouth`; `line_glow` -> `glow`; `line_core` (the orange monocle
  line) -> `rim`. The renderer multiplies eye texels by `palette.eye`, so the eye colour must be the
  eye light, not the line colour; the glow stays the line glow, so the bloom over the monocle keeps
  its ring orange (director rulings 2026-11-01, rig-core task 7). Without a spec, Malakor's palette
  mapped this way is used (`DEFAULT_LEGACY_PALETTE`).
- **Identity.** `id` and `name` are the legacy `portrait_id` when it is a slug, otherwise
  `"legacy"`.
- Malformed legacy input is `bad_shape`, with paths into `json` (`$...`) or into `spec`
  (`spec...`).

## Look

| field | type | required | meaning |
|---|---|---|---|
| `palette` | Palette | yes | Colours to render with (starts as the rig's palette). |
| `hidden` | string[] | yes | Names of layers to leave out. Empty array when nothing is hidden. |
| `emotion` | Emotion | yes | Current emotion. |
| `gesture` | Gesture | no | A gesture to play. Omitted when none. |
| `regions` | object | no | Region colours: key `"<layer>/<slotId>"` (`regionKey`), value `#rrggbb`. An absent key draws the region as painted. Amended by character-control. |
| `shape` | object | no | Part reshapes: key a layer name, value a PartShape (see "Reshape"). An absent layer keeps its shape. Amended by character-control. |

**Emotion** is one of `"neutral"`, `"amused"`, `"smug"`, `"irritated"`, `"furious"`,
`"delighted"`, `"bored"`, `"suspicious"`, `"grim"`, `"theatrical"`.

**Gesture** is one of `"nod"`, `"tilt"`, `"lean_in"`, `"recoil"`, `"glare"`, `"flare"`.

### Look functions

`packages/rig/src/look.ts` holds the pure functions over a Look. None of them modifies its inputs.

- `defaultLook(rig)` returns the rig's palette (a copy), `hidden: []`, `emotion: "neutral"` and
  no `gesture`.
- `applyLook(rig, look)` returns a **new `Rig`** dressed by the look: its `palette` is the look's
  palette, and every layer named in `look.hidden` carries `visible: false`. Layers already hidden
  by default stay hidden; names in `look.hidden` that match no layer are ignored. All other fields
  are unchanged. Emotion and gesture are not Rig fields, so they do not appear in the result. The
  result shares no objects or arrays with either input, and a valid rig stays valid.
- `lookToEmotionDrive(emotion)` returns a fresh `EmotionDrive` for the emotion, from the table
  below.
- `resolveGesture(look)` returns the gesture to play: `look.gesture` when it is set, otherwise the
  emotion's default gesture from `lookToEmotionDrive`, otherwise `undefined`.
- `moodDrive(to, mood?)` returns the EmotionDrive held this frame: with `mood = { from, mix }` every
  numeric column is `lerp(from, to, smoothstep(mix))` (mix clamped to `[0, 1]`); absent, `to`'s row.
- `validateLookControls(look, rig?)` (`packages/rig/src/validateControl.ts`) returns every problem
  with a decoded look's `regions` (keys `layer/slot`, values `#rrggbb`) and `shape` (six finite
  numbers within `SHAPE_LIMITS`); with a rig, keys must name its layers and region slots. The web
  library runs it on read.

### PartShape

| field | range | meaning |
|---|---|---|
| `size` | `[0.6, 1.6]` | Uniform scale. |
| `sx`, `sy` | `[0.6, 1.6]` | Stretch on the layer's own x and y, times `size`. |
| `dx`, `dy` | `[-0.15, 0.15]` | Offset as fractions of the rig **width** (both axes, so a square offset is square). |
| `rot` | `[-25, 25]` | Degrees, clockwise on screen. |

`clampShape` fills missing or non-finite fields from the identity `{1, 1, 1, 0, 0, 0}` and clamps
the rest; the pose reads every shape through it, so a saved value out of range cannot escape.

### EmotionDrive

| field | type | required | meaning |
|---|---|---|---|
| `eyeGain` | number | yes | Multiplier on the eye light; 1 = as drawn. |
| `brow` | number | yes | Signed brow offset in table steps; positive raises the brow. The renderer maps one step to `0.004 * height` canvas px (`height` is the rig's). |
| `gesture` | Gesture | no | The emotion's default gesture. Omitted when it has none. |
| `headTilt` | number | yes | Held head roll, degrees; positive is clockwise on screen. |
| `headPitch` | number | yes | Held head pitch, degrees; positive is chin down, added to `Drive.headPitch` before its clamp. |
| `squint` | number | yes | Extra eye y-squash, combined with the blink as `1 - (1 - blinkSquash) * (1 - squint)`. |
| `jawSet` | number | yes | Added to `jawOpen`, clamped to 1. |
| `glowGain` | number | yes | Multiplies the tint of emissive layers. |
| `browLift` | number | yes | Brow-layer lift as a fraction of `height`; positive raises. |

The columns after `gesture` were added by character-control (design.md "Moods").

| emotion | `eyeGain` | `brow` | `gesture` | `headTilt` | `headPitch` | `squint` | `jawSet` | `glowGain` | `browLift` |
|---|---|---|---|---|---|---|---|---|---|
| `neutral` | 1.0 | 0 | - | 0 | 0 | 0 | 0 | 1.0 | 0 |
| `amused` | 1.2 | +1 | `tilt` | 4 | 0 | 0.15 | 0.05 | 1.1 | 0.006 |
| `smug` | 1.1 | +2 | `tilt` | 6 | -2 | 0.25 | 0 | 1.1 | 0.008 |
| `irritated` | 1.3 | -2 | `glare` | 0 | 3 | 0.25 | 0 | 1.2 | -0.008 |
| `furious` | 2.0 | -3 | `flare` | 0 | 5 | 0.35 | 0.1 | 1.6 | -0.012 |
| `delighted` | 1.5 | +2 | `nod` | -3 | -2 | 0.2 | 0.2 | 1.3 | 0.01 |
| `bored` | 0.7 | -1 | - | 5 | 4 | 0.35 | 0 | 0.7 | -0.004 |
| `suspicious` | 1.2 | -1 | `lean_in` | -4 | 2 | 0.4 | 0 | 1.0 | -0.006 |
| `grim` | 0.9 | -2 | - | 0 | 4 | 0.15 | 0 | 0.8 | -0.008 |
| `theatrical` | 1.6 | +3 | `flare` | -5 | -4 | 0 | 0.25 | 1.5 | 0.014 |

The same table is exported as `EMOTION_TABLE` (frozen).

## Pose

`poseLayers(rig, look, drive)` (`packages/rig/src/pose.ts`) computes each frame's layer
transforms without WebGL. It is pure: the same inputs always give the same output, and the inputs
are never modified.

### Drive

The per-frame input from the avatar driver.

| field | type | required | meaning |
|---|---|---|---|
| `t` | number | yes | Clock in seconds. |
| `headYaw` | number | yes | Degrees, clamped to ±22. Positive moves near layers right. |
| `headPitch` | number | yes | Degrees, clamped to ±12 (after a nod's pitch is added). Positive moves near layers down. |
| `jawOpen` | number | yes | 0..1, clamped. |
| `blink` | number | yes | 0..1, clamped; 1 = eyes shut. |
| `gesture` | `{ name: Gesture, startedAt: number }` | no | The running gesture; `startedAt` is in seconds on the same clock as `t`. |
| `still` | boolean | no | Reduced motion: layer float and pulse, and an eye's own blink, are zero. The avatar sets it whenever reduced motion is on. The held mood still applies. |
| `mood` | `{ from: Emotion, mix: number }` | no | An emotion change in progress (character-control): every mood column is `lerp(from, look.emotion, smoothstep(mix))`, and the faces fade from `from`'s family to the look's. Omitted means mix 1. The avatar advances `mix` over `MOOD_FADE_S` (0.25 s); reduced motion sets it to 1. |

`GESTURE_DURATION_S` is `0.4`: every gesture curve runs for 0.4 s from `startedAt`, shaped as a
half-sine `sin(pi * elapsed / 0.4)` that peaks halfway at the design value. Outside that window the
gesture has no effect.

### LayerPose

One per drawn layer, in `z` order. A layer is drawn unless it is named in `look.hidden` or carries
`visible: false`.

| field | type | meaning |
|---|---|---|
| `name` | string | The layer's name. |
| `x`, `y` | number | Posed bbox top-left, canvas px: the bbox moved by the layer's translation. |
| `scale` | `[x, y]` | Scale about the posed anchor, `anchor + (x - bbox[0], y - bbox[1])`, in the layer's own frame. Uniform except for an eye's blink and squint squash on y and a `Look.shape` stretch. |
| `rotation` | number | Radians, clockwise on the y-down canvas, about the posed anchor. |
| `opacity` | number | 0..1. Currently always 1. |
| `tint` | number | Light gain multiplied into the layer colour; 1 = as drawn. |
| `faces` | `{ family, weight }[]` | Only on a layer with `variants`: with `m = smoothstep(mix)`, the outgoing family at `1 - m` and the incoming at `m`, each listed only if the layer has a variant for it (one family on both sides is listed once at 1; zero weights are dropped). Omitted when empty: the base only. The renderer draws the base at opacity `1 - sum(weights of replace faces)`, then each patch at its weight, in the layer's transform. |

### Rules

- **Parallax.** A layer shifts by `yaw/22 * 0.04 * width * depth` in x and
  `pitch/12 * 0.03 * height * depth` in y, using its own `depth` (or the kind default). Followers
  do not add their parent's parallax, so the shift is monotonic in depth across every layer.
- **Follow.** A follower inherits its parent's gesture translation, rotation and scale about the
  parent's anchor. Parallax and the jaw drop are not inherited.
- **Jaw.** Each `jaw` layer drops by `jawOpen * drop * height` canvas px along the head's down axis
  (it turns with a tilt), `drop` being the layer's own (0.06 when omitted; cast-forge task 3). The
  length is not scaled by gestures, so it never exceeds `drop * height`.
  Followers of a jaw do not move with the drop; a jaw that follows a jaw drops by its own amount
  only. No other kind moves with `jawOpen`.
- **Blink.** `eye` layers scale y by `1 - 0.9 * max(blink, own)`, `own` the layer's `motion.blink`
  closure at `t` (0 when it has none or `still`; cast-forge task 6). The own blink is not inherited.
- **Motion** (amended by cast-forge). With `w = 2*pi*(freq*t + phase)`, a float adds, after the
  inherited follow transform, the parallax and the jaw drop, a canvas-px translation
  `(amp[0]*sin(w), amp[1]*sin(w + pi/2))` and a rotation of `rot_deg*sin(w + pi)` degrees about the
  layer's posed anchor. A float is carried down the follow chain (cast-forge task 4): a follower turns
  and moves rigidly with its parent's float (about the parent's anchor) before its own float, so a
  bulb stays on the tip of a swaying stalk; its parallax stays its own. A pulse multiplies the tint by
  `1 + amp*(0.5 + 0.5*sin(w))`. Both are pure functions of `t` (`motionAt` in
  `packages/rig/src/motion.ts`), and both are zero when `drive.still` is true. The WebGL2 renderer
  multiplies the tint into the layer colour; the canvas2D fallback draws it as a `brightness()` filter.
- **Gestures**, at their peak: `nod` adds 6° of pitch; `tilt` rotates the head 5°; `lean_in`
  scales the head by 1.04; `recoil` scales it by 0.96 and lifts it by 1% of height; `glare` sets
  the eye tint to 1.6; `flare` sets the tint of the emissive layers (`emissive`, else the kinds
  `eye`, `crown`, `accessory`) to 2.0; a layer with `emissive: false` takes neither (glare only
  raises an emissive eye). `tilt`, `lean_in` and `recoil` act about the anchor of each `head` layer that has no
  `head` ancestor, and reach its followers through the follow rule.
- **Moods** (amended by character-control). The look's emotion (crossfaded by `drive.mood`) is held
  while it is on: `headTilt` adds to the tilt gesture's rotation of the head group (followers
  inherit it); `headPitch` adds to the pitch before the clamp; `eye` layers scale y by
  `(1 - 0.9 * closure) * (1 - squint)`; `jawSet` adds to `jawOpen` before its clamp; `glowGain`
  multiplies the tint of emissive layers. **Brow layers** are the layers named `brow` or `brow_*`
  (`isBrowLayer`): `browLift` moves them up by `browLift * height` in their parent's frame and turns
  them about their anchor by `-browLift * 600` degrees for the brow on screen left and the opposite
  on screen right (side from the bbox centre against the brows' mean; an angry V when negative; a
  single brow is not turned). When a rig has brow layers (`hasBrowLayers`), the renderer does not
  also shift the eyes by the `brow` steps; without them it does, as before.
- **Reshape** (amended by character-control). A layer named in `look.shape` is, inside its own
  follow transform, scaled by `(size * sx, size * sy)` and turned by `rot` about its anchor, then
  moved by `(dx * width, dy * width)`; a gesture turns it about its moved anchor, and its followers
  inherit all of it. A layer with no entry poses exactly as before.

## Example

A fabricated three-layer rig, with the hidden-by-default and follow fields in use:

```json
{
  "version": 1,
  "id": "example_lich",
  "name": "Example Lich",
  "width": 1024,
  "height": 1024,
  "source": "replay",
  "fictional": true,
  "palette": { "glow": "#7cf2c4", "eye": "#e8fff4", "rim": "#e8fff4", "mouth": "#1a0f24" },
  "layers": [
    {
      "name": "head",
      "z": 0,
      "kind": "head",
      "file": "head.png",
      "bbox": [312, 180, 400, 520],
      "anchor": [512, 640]
    },
    {
      "name": "jaw",
      "z": 1,
      "kind": "jaw",
      "file": "jaw.png",
      "bbox": [400, 560, 224, 160],
      "anchor": [512, 580],
      "follow": "head"
    },
    {
      "name": "monocle",
      "z": 2,
      "kind": "accessory",
      "file": "monocle.png",
      "bbox": [540, 360, 96, 96],
      "anchor": [588, 408],
      "follow": "head",
      "depth": 0.8,
      "visible": false
    }
  ]
}
```

And a Look over it:

```json
{
  "palette": { "glow": "#7cf2c4", "eye": "#e8fff4", "rim": "#e8fff4", "mouth": "#1a0f24" },
  "hidden": [],
  "emotion": "smug",
  "gesture": "tilt"
}
```
