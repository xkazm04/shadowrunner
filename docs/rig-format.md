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
| `mouth` | RigMouth | no | Where the talking mouth is drawn (see "Mouth"). Omitted when the art owns its mouth. |
| `face` | RigFace | no | The character's face profile (see "Face profile"): gaze, motion and expression strengths. Omitted means the defaults. Amended by face-control; the format stays version 1. |
| `motion` | `{ spring?: number }` | no | Secondary motion (perfection-pass V1): `spring` in [0, 2] scales how far loose parts lag and settle (see Pose, Rules, "Secondary motion"); omitted means 1, 0 turns it off; `Look.motion` wins. Faults are `bad_shape` at `$.motion` / `$.motion.spring`. |
| `morph` | RigMorph | no | Morph keys (companion-lanes): aligned repaints of one head layer blended by track weights, the portrait lane's face (see "Morph keys"). Omitted: none, and the rig renders exactly as before. The format stays version 1. |
| `turn` | `{ warp?: number; light?: number }` | no | Depth turn and lighting (perfection-pass V2, WebGL only): `warp` in [0, 1] bends the head's layers with a head turn, `light` in [0, 1] moves the light across the face (see "Depth turn in the avatar"); omitted means the defaults (0.5 each; warp lowered for pixel art and mouthless heads), 0 turns one off; `Look.turn` wins field by field. Faults are `bad_shape` at `$.turn` / `$.turn.warp` / `$.turn.light`. |

### Mouth

Amended by llm-avatar-lab ("the rig owns the mouth"); the format stays version 1. `mouth` is
`{ cx, lineY, width }` in canvas px: the rest mouth's centre x, its lip line y and its width corner
to corner. When present, the expression faces keep the neutral portrait mouth. With
`render: "drawn"` the renderer also draws the talking mouth there and carries the emotion in it
(smile, snarl, smirk, downturn): this suits flat, low-poly shading (the Tallyman). Painterly and
dithered pixel faces showed a flat cover box and cartoon lips, so they are not marked. Without
`render` and with `lips` (amended by art-mouth) the WebGL renderer talks with the art's own lips:
it bends the head and jaw art inside the painted `lips` box, moving the corners with the emotion
and parting the lips at the `seam` (or at `lineY` without one) over a dark interior; the Canvas2D
fallback keeps the neutral lips and the sliding jaw. The warp runs only when `lips` exists (Director
decision, art-mouth): a rig without `lips` keeps the neutral lips and the sliding jaw, so a
character whose lips the forge could not measure (Lot Ninety, the Understudy) needs no flag.
`render: "still"` is the explicit per-character opt-out for a rig that has `lips`: the art keeps its
neutral lips and the jaw slides as before, in both renderers. The forge does not set `render`: a
style is marked drawn, or a character still, by a person after seeing it.

The player names the result `mouthMode` (`@sr/avatar`): `"drawn"`, `"warp"` (with `lips`), `"still"`,
undefined (no usable `mouth`: the jaw slides), and `"morph"` (companion-lanes): a rig whose `morph`
has a key on a mouth track talks with those keys whatever its `mouth` says (see "Morph keys"); no
mouth is drawn or warped, no jaw moves, and `mouth` is still written for the lab's region of
interest (without `lips` or `render`).

| field | type | required | meaning |
|---|---|---|---|
| `cx` | number | yes | Finite, in `[0, width]`. |
| `lineY` | number | yes | Finite, in `[0, height]`. |
| `width` | number | yes | Finite and > 0. |
| `render` | `"drawn"` \| `"still"` | no | `"drawn"`: the player paints its procedural mouth. `"still"` (art-mouth): no bending; neutral lips and the jaw. Omitted: the art-preserving (warp) mouth. Any other value is `bad_shape` at `$.mouth.render`. |
| `lips` | `{ left, right, upper, lower, seam?, maw? }` | no | The painted lips at rest, canvas px: the corners' x (`left`, `right`), the upper lip's top y (`upper`) and the lower lip's bottom y (`lower`). Finite, with `0 <= left < cx < right <= width` and `0 <= upper < lineY < lower <= height`, else `bad_shape` at `$.mouth.lips`. `seam` (optional) is the y where the lips part at `cx`: it differs from `lineY` (the jaw cut) on rigs whose jaw was cut at or above the upper lip (Moth Widow: lineY 599, seam 611; Sister Vesper: 480, 501). Finite with `upper <= seam <= lower`, else `bad_shape` at `$.mouth.lips.seam`; omitted (never 0) when no dark line parts the lips, and the warp then parts at `lineY`. Omitted `lips` (never zeros) when the forge was unsure: the warp does not run. `maw` (cast-face-pass, optional, only `true`): the painted mouth is already open, teeth rows (or carved edges) around a dark gap; then `upper` is the upper row's top, `lower` the lower row's bottom and `seam` the gap's middle at `cx`, and the warp widens the gap instead of parting closed lips (see "Mouth in the avatar"). Omitted (never `false`): lips. Amended by art-mouth; the format stays version 1. |
| `cell` | number | no | Pixel art: the canvas px of one art pixel (the forge's `cut.cell`; the Redactor's is 7.1). The drawn mouth then paints on that grid: a crop at 1/`cell` resolution scaled up with smoothing off, in both renderers. It also snaps the art-mouth warp and the iris gaze to whole cells (cast-face-pass, see "Mouth in the avatar" and "Eyes"); it is the rig's art pixel, read from `mouth` because that is where the forge records it. Finite and > 0, else `bad_shape` at `$.mouth.cell`. Omitted: smooth paint. Amended by llm-avatar-lab; the format stays version 1. |

The drawn mouth's skin cover takes its colour from the rest art as the look recolours it (a region
or light colour the look sets), so a recoloured face shows no unrecoloured patch.

A `mouth` that is not an object is `bad_shape` at `$.mouth`; a field off its range is `bad_shape` at
`$.mouth.<field>`. Absent, the rig renders as before: the art's own mouth and jaw, nothing drawn
over them (every rig made before the amendment, every `import` rig, and a lipless forged rig).

How the forge sets it (`packages/forge`):

- **Measure.** `assembleRig` measures the first jaw layer (`measureMouth`, `mouthAnchor.ts`):
  `lineY` is the median top edge of the jaw over the middle 60% of its opaque columns, `cx` the
  middle of that span, `width` the span times 0.85, capped at 0.32 of the first head layer's width.
- **Lips.** Then `measureLips` (`mouthLips.ts`) finds the painted lips on the rest head + jaw
  composited, in a window 0.85 x width each side of `cx`, 0.45 x width above and 0.6 x width below
  `lineY`. Each pixel scores as a robust z-score (median, MAD) against the window on two cues,
  redder (R - G: painted lips) and darker (luminance: ink or greyscale lips); the cue on which the
  middle of the mouth stands out more decides, and a pixel is lip halfway to that level. `upper` and
  the bottom come from the run of lip nearest `lineY` in each middle column (the other cue may join
  a dark parting but never ends the run); a lower lip only shading shows ends at the first row
  darker than halfway between the parting and the lip's lit row. `left`/`right` are where the
  columns stop holding lip. A jaw cut up to 0.1 x width above the lips puts `upper` at `lineY - 1`.
  `seam` is the darkest row of the middle columns' luminance (`cx` +- 0.1 x width) strictly inside
  the lips' rows, kept only when it is darker than their median row by a quarter of their range
  (at least 8 levels): an ink or shadowed parting.
  It returns nothing (and the rig gets no `lips`) when the lips stand out by less than 1.5 skin
  spreads, an edge is the window's, the span is outside 0.5..1.4 x width or the box does not hold
  (`cx`, `lineY`). The cast's are back-filled by `node scripts/cast/mouth-backfill.mjs --all --lips`.
- **Lipless mouths keep their art.** A jaw part whose `cavity` is `"gap"` (a visor's slit, a grin
  drawn over a dark gap) or `"fill"` (a maw of teeth over a lit throat) means the mouth is drawn
  open and there are no lips to draw: `drawnMouth(parts)` is true and the rig gets no `mouth`.
  A jaw with only a `glow`, or a pixel-art `cut.cell`, still has a lip and gets one.
- **Reset.** `cutVariants` (expression faces) restores the neutral mouth from the base layer inside
  every head and jaw patch when the rig has `mouth` (`resetMouth`: a rounded box 0.95 x width each
  side of `cx`, 0.75 x width above `lineY` and 0.6 x width below, feathered 8 px).
- **Prompt.** The expression edit changes only the eyes, eyelids and brows and keeps the mouth,
  lips and jaw as painted (`expressionPrompt`, `.kiro/specs/character-control/design.md`
  "Expressions"), so the faces carry no painted grin or cheek fold for the reset to miss.
- **Survives every hop.** `serializeRig` writes it, `validateRig`/`parseRigJson` read it back, so it
  rides the live job record (KV, `parseForgeJob`), the `JobView`, the creator's library (IndexedDB,
  `readRecord`) and a pack's `rig.json` unchanged.

### Morph keys

Amended by companion-lanes; the format stays version 1. `morph` animates one head layer of a
portrait (a photoreal or anime face kept whole) with **keys**: image edits of the portrait with one
thing changed (eyes shut, mouth open, a smile, a glance), registered to it and blended by weights,
each with an optional motion field from the layer's own pixels to the key. Declared in
`packages/rig/src/types.ts` (`RigMorph`, `MorphKey`, `MorphTrack`, `MorphSway`); read by
`validateMorph.ts`, planned by `morph.ts`, drawn by `packages/avatar/src/gl/morph.ts`.

| field | type | required | meaning |
|---|---|---|---|
| `layer` | string | yes | The layer the keys repaint: a visible `head` layer, else `bad_shape` at `$.morph.layer`. |
| `atlas` | string | yes | One image (WebP with alpha, at most 2048 px a side, straight alpha in the file) holding every key's colour cell; a rig-relative name or a PNG/WebP `data:` URL (the layer-file rule). |
| `flow` | string | no | One image (lossless PNG, RGB) holding every key's motion cell. Required when a key has `flowCell`, and omitted when none has (`bad_shape` at `$.morph.flow` either way). |
| `keys` | MorphKey[] | yes | 1..40 keys (`bad_shape` at `$.morph.keys`). |
| `eyes` | `[[x, y], [x, y]]` | yes | The two eye centres, canvas px, the picture's left first: the turn's face and the gaze. Off the canvas is `bbox_out_of_bounds` at `$.morph.eyes[i]`. |
| `sway` | `{ map, amp }` | no | Soft secondary motion inside the layer (hair ends, ears): `map` a greyscale image stretched over the layer's bbox (R = how loosely that pixel hangs, 0..1), `amp` the canvas px a weight-1 pixel lags at full deflection, in (0, 0.05 x width]. Omitted: no sway. |
| `mouthGain` | `{ <track>: number }` | no | Round 6: per mouth track, a gain in (0, 1] on its shape weight, so speech lands below the drawn key's full size (keys `openWide` `openMid` `round` `tongue` `narrow`). `closed` and `teeth` are refused (`bad_shape` at `$.morph.mouthGain.<track>`: they are never reduced, the lips must meet on p, b, m), as is any other key or a value outside (0, 1]. Written in that track order, after `sway`. Omitted, or a track omitted: 1. |

A **MorphKey** is `{ id, track, at?, bbox, cell, flowCell?, flowMax?, backCell?, part? }`. `id` matches `^[a-z0-9_]+$`
and is unique in the rig (`duplicate_name` at `$.morph.keys[i].id`). `track` is one of the 18
tracks below (`bad_shape` otherwise). `at`, the key's stop on its track, is in (0, 1]; omitted means
1. `bbox` is the canvas box the key repaints and `cell` its colour cell in the atlas (RGB the
repaint, alpha its coverage feathered to 0 at the edge, a 2 px gutter of repeated edge pixels;
stretched over `bbox`, 1 atlas px = 1 canvas px as built): integers with x, y >= 0 and w, h > 0
(`bad_shape`), and `bbox` inside the canvas (`bbox_out_of_bounds`). `flowCell` is the key's motion
cell in `flow` (the bbox at 1/4 size rounded up, a 1 px gutter, stretched over `bbox`): R and G hold
the displacement from a layer pixel to the same feature in the key, `(code - 128) / 127 * flowMax`
canvas px (x right, y down; code 128 is exactly 0), already faded to 0 where the coverage is.
`flowMax` is in (0, 256] and comes with `flowCell`, never alone (`bad_shape` at the missing one). A
key without motion has neither: it is a plain cross-fade. `backCell` (round 2; integers as `cell`,
`bad_shape` otherwise, and only with `flowCell`, else `bad_shape` at `flowCell`) is a second cell in
`flow`, stretched over `bbox` and read in the KEY's frame: R and G the displacement from a key pixel
back to the same feature in the layer (same code and `flowMax`), B how much that key pixel is new
surface the layer does not have (teeth, a mouth's inside, a lowered lid), `code / 255`. Omitted: the
forward motion alone, no reveal. `part` (round 3) is `"upper"` (brows, lids, eyes) or `"lower"`
(cheeks, mouth), only on the six family tracks (`bad_shape` at `part` elsewhere): the half of the
face the key repaints. On one track either every key has a part or none does; an upper and a lower
key may share a stop, two keys of one part may not. Omitted: the key is the whole face. A track
holds at most 4 keys per part and no two of one part at one stop (`bad_shape`). Omitted fields are
omitted, never null or 0. The morph types are declared in `morphTypes.ts`, re-exported by
`types.ts`.

**Tracks** (each a value v in [0, 1] per frame, `morph.ts`):

| track | group | value |
|---|---|---|
| `joy` `showman` `anger` `gloom` `smug` `suspicion` | face | The family's weight in the mood crossfade (the outgoing family at `1 - smoothstep(mix)`, the incoming at `smoothstep(mix)`, one family once), times the face profile's `expression.strength`; 0 for a family retired to `"procedural"`. |
| `gazeL` `gazeR` `gazeU` `gazeD` | gaze | `max(0, -gx)` / `max(0, gx)` of `gx = gaze.x * range / 0.6` clamped to [-1, 1] (L and R: the picture's left and right), and `gy` likewise (U up, D down); `range` is the profile's `gaze.range`. |
| `openWide` `openMid` `round` `closed` `teeth` `tongue` `narrow` | mouth | That shape's weight in the player's emotion-free mix (visemes from `setMouthShapes`, or the level's `openMid`); round 6: every track but `closed` and `teeth` is first multiplied by its `mouthGain` and the face profile's `mouth.size`, clamped to 1; then when the seven sum above 1 they are divided by the sum; `rest` is the remainder. |
| `blink` | blink | `Drive.blink` (a head layer has no blink of its own). |

**Stops.** A track's keys sorted by `at` are `a1 < ... < an`, with `a0 = 0` the layer's own pixels:
for v in `[a(k), a(k+1)]` key k+1 has weight `(v - a(k)) / (a(k+1) - a(k))` and key k (k >= 1) the
rest; at or above `an` the last key has weight 1. Two stops make a blink half-shut, then shut.

**Colour and motion** (round 3). Every key is painted on the neutral face, so the plan gives each
key two numbers: its motion weight (the stop rule's weight; it moves pixels and makes the key
active) and a colour scale in [0, 1] (how much of its paint shows). A family key with
`part: "lower"` shows `1 - speak` of its colour and moves at `w (1 - 0.5 speak)`: while the mouth
speaks, the mouth keys paint the mouth and the smile still lifts it half way. A gaze key shows
`1 - E` and moves at `w (1 - E)`, with E = min(1, the sum of the six family values): its paint
and its field were made on the neutral eye, so under an expression it yields and the expression's
own eyes hold (painted, it ghosts inside the lids; moved alone, it smears them). Every
other key shows its colour in full. `speak` is the mouth mix's non-rest total (capped at 1),
followed by the player with a fast attack (95 % in 60 ms) and a slow release (95 % in 350 ms), so
a smile's lower face does not flicker back between words; 0 without mouth keys; a frozen frame
takes the total as it is.

**Active keys.** A key with motion weight above 0.002 is active (also when its colour is 0: it
still moves pixels); of more than 8, the lowest weights are
dropped (a tie drops the key that composites later). They composite by group, `face` < `gaze` <
`mouth` < `blink` (a later group covers an earlier one), then in `keys` order.

**The shader** (WebGL2, `gl/morph.ts`), in canvas px of the layer's rest frame, before its pose and
the turn's bend (round 2, design "Round 2 amendment"; no inversion, exact at weight 0 and 1 for any
motion): the sway first moves the point x by `- s(x) * amp * L`. Each active key's field at x is
`Fh_i = mix(F_i, -G_i, w_i)` (F the flow cell, G the back cell's R, G, both at x and 0 outside the
key's bbox; a key without a back cell has `Fh_i = F_i`); the layer is read at `p = x - sum w_i Fh_i`
and key i at `q_i = p + Fh_i`, where its colour, coverage m_i and reveal r_i (back cell B; 0 without
one) are read. A key's share is `a_i = colour_i * mix(w_i, smoothstep(0, 0.4, w_i), r_i)` (w the motion weight,
colour the colour scale): new surface is
mostly there by weight 0.4, uncovered by the motion rather than faded in. One key at weight 1 reads
the layer where each key pixel's feature came from and the key at x: its cell exactly; a pure shift
d at weight w moves the layer w d and the key meets it (no double image). Then per group, the keys'
colours are averaged by share times coverage and mixed over the layer's colour by the group's total
(at most 1), at the layer's own alpha (a key never adds coverage); a later key without motion moves
with the earlier keys' displacement. Recolour
regions, the light gain, rim, the turn's bend and light, the dim and the glow source then run on
that colour as on any layer; the rim's taps are read about `p`, and the region map (round 7) at
`mix(p, x, K)`, `K = 1 - prod_g (1 - min(1, S_g))` the share of the pixel the keys paint (their art
is at `x`), so a key's strand keeps its slot's recolour where `p` left the slot. At weight 1 of
one key its cell is reproduced inside its coverage; a frame with no active key and no sway draws
the layer with the base program, exactly as without `morph`. The atlas is uploaded premultiplied
with mipmaps, the motion image (all three channels data) and the sway map as stored (no
premultiply, no colour-space conversion), linear; the morph program is linked only on a frame that needs it.

**Sway.** L, per axis in [-1, 1], is the head group's spring lag (`Drive.spring`, see Pose
"Secondary motion"): the yaw and roll lags sideways, the pitch and lift lags up and down, each over
the lag that counts as full (`SWAY_FULL`: yaw and pitch 0.08 of their limits, roll 0.03 rad, lift
0.006 of the height), times the spring strength (`motion.spring`; 0 disables), plus a slow idle
drift of at most 0.15. Reduced motion (`still`) and a frozen drive give L = 0.

**Canvas2D fallback.** The layer, then each active key's atlas cell over its bbox at
`globalAlpha = opacity x weight x colour`: a cross-fade without motion or sway; keys keep their painted
colour (no region recolour).

**What a morph rig takes from the rest of the pose.** It needs no jaw, eye or iris layer. Its mouth
mode is `"morph"` when it has a mouth key; with gaze keys the driver lets the eyes lead (saccades,
glances, look-at) as on a rig with irises; the turn's face comes from `eyes` when the head has no
eye layer (each centre a box half the eye distance wide); it breathes, as a rig with a face profile
does. A rig's file lists (`@sr/pack` `rigFiles`, `@sr/avatar` `rigAssetFiles`, the web app's
`rigFiles`) carry `atlas`, `flow` and `sway.map`; a pack moves inline ones to `morph.atlas.<ext>`,
`morph.flow.<ext>` and `morph.sway.<ext>`.

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
| `file` | string | yes | PNG or WebP path relative to the rig folder, or a PNG or WebP `data:` URL (see "Layer files"). |
| `bbox` | `[x, y, w, h]` | yes | Where the PNG sits on the canvas, in px. `w` and `h` are > 0. Must lie inside `[0, width] x [0, height]`; the right and bottom edges may overshoot by at most 1e-6 px (float bboxes from the forge), the left and top edges not at all. |
| `anchor` | `[x, y]` | yes | Pivot point in canvas px; rotation and followers turn about it. |
| `follow` | string | no | Name of a parent layer. The layer inherits the parent's gesture translation, rotation and scale about the parent's anchor, but not its parallax or jaw drop (see "Pose"). Must name an existing layer, with no cycles. |
| `depth` | number | no | Parallax depth in `[0, 1]`, from 0 (background) to 1 (nearest). When omitted, the default for the kind applies. |
| `visible` | `false` | no | Present only when the layer is hidden by default. Never written as `true`. |
| `motion` | Motion | no | The layer's own float and/or pulse (see "Motion"). Omitted when the layer has none. Amended by cast-forge; the format stays version 1. |
| `drop` | number | no | `jaw` layers only: the drop at `jawOpen = 1` as a fraction of `height`, in `[0.005, 0.1]`. Omitted means 0.06 (a skull's gape); a human mouth wants about 0.012-0.02. On any other kind, or out of range, it is `bad_shape` at `$.layers[i].drop`. Amended by cast-forge task 3; the format stays version 1. |
| `emissive` | boolean | no | Whether the layer gives light: its bright pixels feed the glow pass (tinted `palette.glow`), an `eye` takes `palette.eye`, and `glare` / `flare` raise its tint. Omitted means the kind's default: `eye`, `iris`, `crown` and `accessory` give light, the other kinds do not; an `eye` with a `socket` gives none (its iris carries the light, face-control). `false` on a part drawn without light of its own (a white glove, a silver crown, a painted iris); its own `motion.pulse` still applies. Not a boolean is `bad_shape` at `$.layers[i].emissive`. Amended by cast-forge (emissive fix, task 12 follow-up); the format stays version 1. |
| `variants` | object | no | Expression faces (see "Variants"): per expression family, a patch drawn over or instead of the layer while that family is on. Omitted when the layer has none. Amended by character-control; the format stays version 1. |
| `regions` | LayerRegions | no | Recolourable colour regions (see "Regions"): an index map and 1..4 slots. Omitted when the layer has none. Amended by character-control; the format stays version 1. |
| `socket` | string | no | `eye` layers only (face-control): an alpha mask, same bbox as the layer, of the lid opening where the eye's iris may show (see "Eyes"). Omitted: the eye is one painted piece, as before. A file under the rules of "Layer files"; on another kind it is `bad_shape` at `$.layers[i].socket`. |
| `closed` | string | no | `eye` layers only (face-control): the closed-lid art, same bbox; a blink crossfades the eye to it instead of squashing (see "Eyes"). Same rules as `socket`. An eye may have `closed` without a `socket` or an iris (a one-piece eye that closes by its art, the Vicar's glass lids): it blinks the same way. |
| `tint` | `false` | no | `eye` and `iris` layers only (cast-face-pass): the palette's eye colour does not tint this layer, so its light keeps the art's own colour (Sir Vacant's white slit light, the Lantern's candle). Its `eyeGain` brightness, pulse, glare and flare still apply, in that colour, and a look's eye colour does not recolour it (its region slots still do). Omitted (never `true`): tinted, as before. Any other value, or `false` on another kind, is `bad_shape` at `$.layers[i].tint`. |
| `act` | Act | no | `accessory` and `crown` layers only (tiger L1): a signature act, the layer's own motion played once when a spoken line says a cue word (see "Act"). Readers drop a bad one (never an error), and drop it on another kind. Omitted: none. The format stays version 1. |

### Layer files

`file` is one of:

- a relative POSIX path inside the rig folder, such as `head.png`, `head.webp` or `parts/eye_l.png`. It must
  not be empty, start with `/`, contain a backslash or a `:` (no scheme or drive letter), have an
  empty segment (`a//b.png`, a trailing `/`) or a `..` segment. `.` segments are allowed.
- a `data:image/png;base64,` or `data:image/webp;base64,` URL with a non-empty payload (the forge produces PNG). No other
  `data:` type is accepted.

Anything else is `bad_shape` at `$.layers[i].file`.

**Lossless WebP (asset-webp amendment; additive, the format stays version 1).** A path is not checked for
its extension, so `.webp` paths were already legal; the amendment adds the `data:image/webp;base64,` URL and
fixes the convention: committed layer images, region maps and variant patches are lossless WebP
(`scripts/rig-webp.mjs` converts a folder, `exact` so even colour under alpha 0 survives, and refuses unless
every decoded RGBA byte is equal). A loader decodes by content, never by extension. The rig-core design.md
still says "PNG"; spec design edits are denied to the builder, so this note is the amendment of record.
Not yet converted: `assets/replay/forge/**`, because `api/_lib/forge-replay.ts` only accepts `.png`/`.jpg`
layer names (its `FILE` and `EXTRA_FILE` patterns) and `api/` was out of this task's scope.

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
| `iris` | 0.7 (unused: an iris takes its eye's whole transform, see "Eyes") |

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

### Act

A signature act (tiger L1, `packages/rig/src/act.ts`): an event-driven move from the brief ("the
glove slams down on 'sold'", "the stamp thunks when something is approved"), as the part's own
approved motion played once. The stage fires it when a spoken line contains a cue word; no model is
asked during playback.

| field | type | required | range | meaning |
|---|---|---|---|---|
| `cue` | string[] | yes | 1..3 words | Lowercase words (`^[a-z][a-z0-9'-]*$`, at most 24 characters each). A line fires the act when it contains one, at a word boundary, ignoring case and simple endings (`sold`, `Sold!`, `ring` / `rings` / `ringing`). |
| `gain` | number | no | `[1, 3]` | How much bigger than the idle motion; omitted means 1.5. |
| `s` | number | no | `[0.6, 1.5]` | Seconds; omitted means 1. |

Read leniently (`readAct`): cue words that break the rule, and duplicates, are dropped, at most three
kept; a `gain` or `s` out of range is dropped (the default applies); no cue word left means no act.
`Drive.act = { layer, startedAt }` plays it (see "Rules": *Act*). A rig without acts poses exactly
as before.

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
| `socket` | string | no | Eye patches (face-control): this face's lid opening, an alpha mask at the **layer's** bbox. Omitted: the face uses the eye's own `socket`. |
| `narrowed` | `true` | no | Eye patches (face-control): the face already narrows the lids, so the mood's squint adds no squash while it shows. Never written as `false`. |

A key that is not a family, a bad `file`, a bbox that is not four finite numbers or has `w`/`h` <= 0,
or a `mode` other than the two is `bad_shape` at `$.layers[i].variants.<family>[.field]`; a patch
bbox leaving the canvas is `bbox_out_of_bounds` at `$.layers[i].variants.<family>.bbox`. Every fault
is reported. The serializer writes families in the order above.

### Regions

Amended by character-control (design.md "Regions"). `regions` is `{ map, slots, soft? }`:

| field | type | required | meaning |
|---|---|---|---|
| `map` | string | yes | An index-map PNG the size of the layer image (rules of "Layer files"): R = slot index + 1, 0 for no region. |
| `slots` | RegionSlot[] | yes | 1..4 (`MAX_REGION_SLOTS`) slots, in index order. |
| `slots[j].id` | string | yes | `[a-z0-9_]+`, unique in the layer. A jaw's painted mouth is `cavity`. |
| `slots[j].name` | string | yes | Non-empty display name (`robe`, `robe 2`, `mouth`). |
| `slots[j].hex` | string | yes | The region's colour as painted, `#rrggbb`. On a `shade: "move"` slot it is also the recolour's lightness reference. |
| `slots[j].shade` | `"move"` | no | Companion-lanes round 4. A look that names a colour for this slot moves its lightness as well as its hue: each pixel's HSL lightness goes through (0,0) - (L(hex), L(target)) - (1,1), both ends clamped to [1/256, 1 - 1/256], so the painted colour lands on the target's lightness and the shading keeps its order (`packages/avatar/src/render/recolour.ts`). Round 7: a side of that curve steeper than 3 (a large move, which read as satin) is instead the power curve `x^m` in that side's unit square (below: `L(t) * (l / L(hex))^m`; above: `1 - (1 - L(t)) * ((1 - l) / (1 - L(hex)))^m`), `m` set so the slope at the reference is 3; a side within slope 3 keeps the line. And the art's saturation carried into the result (`s * 0.15`) is scaled by `min(1, s_t / 0.25) * min(1, (1 - abs(2 L(t) - 1)) / 0.25)`, so a grey, near-black or near-white target reads neutral; lights and slots without `shade` keep the full carry. For a slot that is one material (a jacket, hair). Omitted (never `null`) = the art's lightness is kept, the rule for the forge's slots, which are lightness bands of one material; any other value is `bad_shape`. |
| `soft` | `true` | no | Companion-lanes round 5. The map's G channel is the pixel's coverage, 0..255, of the slot its R names (a strand tip half over skin is part hair). A recolour of that slot gives `mix(without, recoloured, G / 255)` per channel, `without` being what the pixel shows without the slot (the layer's light's result, or the art). The map is still read nearest and both channels come from the same texel; G is ignored where R is 0 or the slot is off. Omitted (never `null` or `false`) = binary: coverage 1 on every pixel of a slot, G ignored (the forge writes G = 0, a grey map has G = R); any other value is `bad_shape`. B and A are unused. |

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
| `face` | RigFace | no | The viewer's face profile (face-control), over `Rig.face` field by field (see "Face profile"). Saved with the look and carried in packs. |
| `motion` | `{ spring?: number }` | no | The viewer's secondary motion strength (perfection-pass V1), over `Rig.motion`. `readLook` drops a bad one, never the look. |
| `turn` | `{ warp?: number; light?: number }` | no | The viewer's depth turn strengths (perfection-pass V2), over `Rig.turn` field by field. `readLook` drops a bad one, never the look. |

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

### Face profile

Amended by face-control; the format stays version 1. `RigFace` (on `Rig.face`, the character's
defaults, and on `Look.face`, the viewer's override) has four optional groups; every field is
optional and omitted when absent:

| field | default | range | meaning |
|---|---|---|---|
| `gaze.range` | 0.6 | `[0, 1]` | How far the iris travels, as a share of its socket's half extent. |
| `gaze.saccadeRate` | 1.2 | `[0, 4]` | Eye micro-saccades per second (0: none). |
| `gaze.habits.chat` / `.content` / `.host` | 1 / 1 / 1 | `[0, 1]` | Relative weights of where the eyes glance on their own (`host` = stay on the viewer). |
| `motion.drift` | 1 | `[0, 2]` | Multiplier of the head's idle drift. |
| `motion.tilt` | 1 | `[0, 2]` | Multiplier of the mood's held head tilt and pitch. |
| `motion.gesture` | 1 | `[0, 2]` | Multiplier of the gesture peaks. |
| `motion.breath` | 0.3 | `[0, 1]` | Breathing idle amplitude (see "Eyes"). |
| `expression.strength` | 1 | `[0, 1]` | Multiplier of every expression face's weight. |
| `expression.faces` | none | family -> `"procedural"` | Retired faces (retire-a-face): each named family's painted face is not drawn, as if no layer had a variant for it, so procedural motion carries that mood. Omitted when no family is retired. |
| `mouth.emotion` | 1 | `[0, 1.5]` | Multiplier of the emotion's bias on the player's mouth (warp and drawn). |
| `mouth.size` | 1 | `[0.3, 1]` | Companion-lanes round 6: multiplier (shrink only: above the tuned size a drawn key would cross-fade into the next) of a morph rig's speaking mouth (every mouth track but `closed` and `teeth`, after `morph.mouthGain`, clamped to 1). Read only by the morph plan, so a cast rig's mouth is unchanged; the creator shows it only on a morph rig (where it hides `mouth.emotion`). |

`resolveFace(rig, look)` (`packages/rig/src/face.ts`) is the only place defaults apply: each field
is `Look.face`'s, else `Rig.face`'s, else the default, clamped to its range. `readFace` checks a
stored profile (a field that is not a finite number in range is reported and dropped). Every
consumer reads the profile through `resolveFace`: the avatar player every frame (a look may change
live), and the creator's Face panel.

`expression.faces` (amended by retire-a-face; the format stays version 1) is not a number, so it
has no default or range: its keys are expression families (`joy`, `showman`, `anger`, `gloom`,
`smug`, `suspicion`) and its only value is `"procedural"`. `resolveFace` takes the **union** of
`Rig.face`'s and `Look.face`'s retirements, so a look can retire a family the rig paints but cannot
bring back one the rig itself retired. `readFace` keeps known families set to `"procedural"`,
reports and drops any other value, and drops unknown families silently; the families are written
in the order above. The creator's Face tab writes it on the look (Retire / Restore per family), so
it is saved with the character, rides `sr.onAir` to the stage, embed, overlay and studio, and
travels in a pack's manifest `look`.

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

`poseLayers(rig, look, drive, options?)` (`packages/rig/src/pose.ts`) computes each frame's layer
transforms without WebGL. `options` (face-control) carries the profile in force (`face`, default
`resolveFace(rig, look)`) and `sockets`: per socketed eye, its socket's half extents `{ hx, hy }`
in canvas px (the avatar measures them from the mask's alpha box; an eye missing there keeps its
iris at rest). It is pure: the same inputs always give the same output, and the inputs
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
| `gaze` | `{ x: number, y: number }` | no | Where the irises look (face-control), -1..1 per axis of the socket's half extents (clamped); x positive is screen right, y down. Omitted means rest. |
| `act` | `{ layer: string, startedAt: number }` | no | A signature act in play (tiger L1): that layer's act from `startedAt` (seconds, same clock as `t`) for its `s`. A layer that is missing is a no-op; a layer without `act` plays with the defaults. Omitted means none. |
| `spring` | SpringChannels | no | Secondary motion (perfection-pass V1): the springs' lag, `{ yaw, pitch, roll, scale, lift, actDx, actDy, actRot, actLayer? }` (see Rules, "Secondary motion"). Omitted means none, as does `still`. |

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
| `opacity` | number | 0..1. 1, except an iris whose eye has `closed` art: `1 - closure` while it blinks. |
| `tint` | number | Light gain multiplied into the layer colour; 1 = as drawn. |
| `faces` | `{ family, weight }[]` | Only on a layer with `variants`: with `m = smoothstep(mix)`, the outgoing family at `1 - m` and the incoming at `m`, each listed only if the layer has a variant for it and the profile does not retire it (`expression.faces`, retire-a-face) (one family on both sides is listed once at 1; zero weights are dropped), each times `expression.strength` (face-control). Omitted when empty: the base only. The renderer draws the base at opacity `1 - sum(weights of replace faces)`, then each patch at its weight, in the layer's transform. |
| `closed` | number | Only on an `eye` with `closed` art while it blinks (face-control): the closure 0..1; the renderer draws the closed art over the eye at that weight. |

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
- **Act** (tiger L1, `actMotionAt`). While `drive.act` names the layer and `u = (t - startedAt) / s`
  is in `[0, 1)`, with the envelope `e = sin(pi*u)^2`, the layer's motion gains, on top of its idle
  motion: for a float, one period of it in `s` seconds times `gain*e` (side swing `amp[0]*sin(2*pi*u)`,
  sway `rot_deg*sin(2*pi*u + pi)`, and a press down and back `max(amp[1], 0.01*height)*(1 - cos(2*pi*u))`);
  for a pulse, the tint times `1 + gain*amp*e`; for a layer with neither, a dip
  `gain*0.02*height*e` px down. Followers are carried as by the float. Outside that window the motion
  is exactly the idle one, so `s` seconds after an act the pose is the idle pose. Under `still` there
  is no movement: the tint is times 1.3 for the first half of the act (one static beat), then as idle.
- **Secondary motion** (perfection-pass V1, `packages/rig/src/spring.ts`). `drive.spring` is the lag
  of one damped spring per channel (head yaw and pitch as shares of their limits, the head group's
  roll in radians, its gesture scale and lift, and a playing act's own move of `actLayer`); the
  avatar steps them on its clock (2.2 Hz, damping 0.45, solved exactly, so any frame rate gives the
  same motion) toward `springTargetOf(rig, look, drive)`. The lag moves a loose part's bbox centre by
  `e` px (each channel's own rigid motion at that point; the act channels only for followers of
  `actLayer`). A part pinned away from its centre swings about its anchor by the part of `e` across
  its lever over `max(lever, 0.12 * height)`; a floating part pinned near its centre moves by `e`. Who
  springs and how much is read from the rig alone (`springParts`): accessory and crown layers only,
  never a brow or anything a jaw, eye or iris follows or is followed by, less the more it covers the
  face box (eye, iris and jaw boxes; none at 30 %), more the lighter it is, a part with no float swings
  at 0.35 and, off the head, not at all. Swing at most 0.2 rad, move at most 6 % of the bbox's shorter
  side; the swing is added to the float in the carry, so followers ride it. Strength
  `look.motion.spring ?? rig.motion.spring ?? 1` scales it (0 off). Absent, all zero or under `still`:
  no change.
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
- **Eyes** (amended by face-control, `packages/rig/src/eyes.ts`). An `iris` layer follows an `eye`
  with a `socket`. It takes its eye's whole transform (follow chain, carried float, the eye's
  parallax; not its own depth, reshape or float) and moves inside it by the gaze offset
  `clamp(gaze, -1, 1) * (hx, hy) * gaze.range` in the eye's rest frame, so a turned head turns the
  travel with it. The eye's blink and squint squash are not passed on: the renderer clips the iris
  by the eye's posed socket mask, so the lids close over it. An iris is drawn only when its eye is.
  - *Blink*: an eye with `closed` art is not squashed by the blink; its pose carries `closed` (the
    closure) and its iris's opacity is `1 - closure`. An eye without `closed` squashes as before.
    The closure is the larger of `Drive.blink` and the eye's own `motion.blink`, so an eye with
    `closed` and no socket or iris (cast-face-pass) blinks by its art too, and several eyes with
    their own blink phases (the Tallyman's six) close one at a time.
  - *Pixel art* (cast-face-pass): on a rig with `mouth.cell` the gaze offset is rounded to whole
    cells (`Math.round(offset / cell) * cell` per axis, in the eye's rest frame), so the iris steps
    by art pixels.
  - *Squint*: the mood's squint on an eye is multiplied by `1 - (sum of the weights of the shown
    faces whose patch is narrowed)`.
  - *Glow*: an eye with a `socket` gives no light by default (`isEmissive`); `iris` is an emissive
    kind, so the iris carries the eye light, `eyeGain`, glare and flare (unless its own
    `emissive: false`, a painted iris). The eye's own `motion.pulse` moves to its iris (an iris
    pulse of its own wins).
  - *Profile*: `motion.tilt` multiplies the mood's `headTilt` and `headPitch`, `motion.gesture` the
    gesture peaks, `expression.strength` the face weights.
  - *Breathing*: on a rig with a face profile (`Rig.face` or `Look.face`) or iris layers, each
    `head` or `body` layer with no head or body ancestor rises by
    `breath * 0.004 * height * sin(2 pi 0.2 t)` and scales by `1 + breath * 0.006 * sin(...)` about
    its anchor; followers inherit it; none under `still`. A rig with neither does not breathe, so
    it poses exactly as before.
- **Reshape** (amended by character-control). A layer named in `look.shape` is, inside its own
  follow transform, scaled by `(size * sx, size * sy)` and turned by `rot` about its anchor, then
  moved by `(dx * width, dy * width)`; a gesture turns it about its moved anchor, and its followers
  inherit all of it. A layer with no entry poses exactly as before.

### Face control in the avatar

How `@sr/avatar` uses the fields above (face-control; behaviour, not wire format):

- **Socket clip.** An iris whose eye has a `socket` is drawn multiplied by the eye's mask, placed
  by the eye's pose (its squash included), and crossfaded with the shown faces' patch `socket`s by
  their weights (a face without one lends the eye's). Outside the eye's box the mask is 0, so the
  iris never shows outside its socket. WebGL2 samples the masks in an iris twin of the base program;
  canvas2D composites the iris on the CPU. While the eye's mask is not loaded the iris is not
  drawn. An iris whose eye has no socket draws as a plain layer.
- **Closed lids.** The `closed` art is drawn over the eye (after its faces) at `LayerPose.closed`.
- **Gaze driver.** On a rig with iris layers the eyes lead: a look-at point, the caller's gaze
  (`content` left and down, `chat` right), or idle glances chosen every 2-5 s by `gaze.habits`
  (a glance away holds 0.6-1.6 s) set the eye target; micro-saccades come at `gaze.saccadeRate`;
  the head follows the eyes' target slowly (8 degrees of yaw and 4 of pitch per unit, 0.9 s) with
  the idle drift (times `motion.drift`) on top. Reduced motion stops the glances and saccades but
  still looks where it is asked. A rig without irises keeps the head-only gaze exactly.
- **Light.** The look's eye gain and brow shift fade with the mood crossfade (they used to snap).
  The brow shift of a brow-less rig never moves an eye with a `socket`. The eye light recolours the
  iris, not a socketed eye. An emissive eye or iris with `tint: false` (cast-face-pass) is
  multiplied by `eyeGain` alone (grey) instead of `palette.eye x eyeGain` in WebGL2, takes the
  same `eyeGain` in its canvas2D brightness filter, and is never recoloured by the eye light. The
  glow pass still tints all glow by `palette.glow` (one composite for the whole rig), so its halo
  takes the palette's glow colour; only the layer itself keeps the art's colour.
- **Dead patches.** A `jaw` or `eye` layer whose two or more patches are one image (one file name,
  or for images in hand, identical decoded pixels) has its patches dropped before the pose.
- **Mouth.** `mouth.emotion` multiplies the emotion's bias on the player's mouth. `mouth.size`
  scales a morph rig's mouth tracks (see "Tracks" under the morph section) and nothing else.

### Mouth in the avatar

How the WebGL2 art-mouth warp (`packages/avatar/src/mouth/warp.ts`, `gl/warp.ts`) reads `mouth`
(behaviour, not wire format; canvas2D never warps):

- **Lips** (art-mouth). Inside a window around `lips`, the corners move with the emotion, the lips
  part at `seam` (else `lineY`) by the pose's opening (about a sixth of the span mid-open, the
  lower lip at most 0.26 of the span) over a dark interior drawn from the lip colour.
- **Maw** (`lips.maw`, cast-face-pass). The mouth is already open, so the same field moves the
  teeth rows apart, rigidly, by the lens profile: the opening is the lips' one capped at 0.7 of
  the rows' height (`lower - upper`), the lower row drops at most 0.5 of it. Press and tight never
  squeeze the rows. Corners and width move 0.3 of the lips' amount (`MAW_BEND`: a full smile then
  tilts a row's end by about 8 degrees instead of 26, past which a carved or toothed edge reads as
  bent). The jaw layer is the lower row whole (a maw's cut lies in or at the gap): every jaw row
  drops with it, also a curved rim that rises above the straight `seam` toward the corners; the
  head parts at the seam as for lips. No interior is drawn: where the rows have parted, a layer
  that is opaque at its own `seam` row in that column shows the mean of the opaque texels darker
  than luminance 0.3 among 9 rows within half the thinner row of the seam, i.e. the art's own gap
  stretched (a painted gap curves with the grin, so a single seam row would cross teeth toward the
  corners); where none is that dark it shows the stretched seam row itself (skin past the corners),
  and where the layer is clear at the seam it paints nothing there (the other layer holds it). Only the head and the jaw bend: art of the mouth cut into another layer (a
  hood in front of the teeth) stays put. Rest with the jaw shut is the identity, as for lips.
- **Pixel art** (`cell`, cast-face-pass). Each cell of the canvas grid (from 0, as the drawn mouth's
  crop) takes one displacement, its centre's, rounded to whole cells, and the interior (or maw gap)
  covers whole cells, so the art's own pixels move by whole art pixels and the opening's edge
  steps. The point is not resampled at the cell's centre: a forged pixel portrait's grid is neither
  on the canvas origin nor regular (the Redactor's period measures 7.0-7.3 px with its phase
  drifting across the face), and centre samples would land on its soft cell borders.

### Depth turn in the avatar

How the WebGL2 renderer reads `turn` (perfection-pass V2, `packages/rig/src/turn.ts`,
`packages/avatar/src/gl/turn.ts`; behaviour, not wire format). The frame clock carries the pose's
yaw and pitch (shares of 22° and 12°, gesture and mood included) while the head is turned and a
strength is above 0; facing front, or with `warp` and `light` both 0, the frame is drawn exactly as
before, call for call. **Canvas2D never bends or relights: it keeps the rigid depth pan.**

- **Strength.** `look.turn.<field> ?? rig.turn.<field> ?? default`, clamped to [0, 1]. The default
  light is 0.5. The default warp is 0.5, lowered by two art rules (never a value the rig or look
  sets): pixel art (`mouth.cell`) 0, since a bend breaks its grid; a head the forge found no lips on
  (no `mouth`: a clock, a helmet, a fish, a skull) 0.3, since a rigid face's straight painted lines
  bow at the human default.
- **Head.** The first visible `head` layer that follows no head, and every layer whose follow chain
  reaches a `head` (face, eyes, irises, lids, brows, jaw, hair, hat, held props). Body, background
  and what follows the torso keep the pan. The face is an ellipse in rest px: centred between the
  head's eyes, 1.6 times their half span wide (at most the head's half width), 1.3 times that tall
  (at most the head's half height), its centre 0.15 of its height below the eye line; a head without
  eyes uses its bbox.
- **Bend** (`warp`). Every head layer is drawn as a 32 x 32 grid whose rest points move by
  `(A, B) w(q)`: `A = warp * yaw * 0.25 * rx`, `B = warp * pitch * 0.15 * ry`, `w` a smooth bump
  `(1 - u^2)^2 (1 - v^2)^2` over 1.25 face radii (below the face it ends at the head layer's bottom
  edge at the latest, so the neck never opens on the body). The face slides toward the turn and
  compresses on the far side; the outline and anything off the face stay put. All head layers share
  the one field in rest px, so features, face patches, closed lids, the art-mouth warp and the drawn
  mouth stay registered (the grid's own error is under 0.9 rig px on the cast at warp 1), and an
  iris moves as the point of its eye under it.
- **Light** (`light`). At rest nothing changes: the painted shading is taken as right facing front.
  Turned, each pixel of a head layer (not an eye, iris or emissive layer) is scaled by
  `1 + 0.6 * light * (shade(R n) - shade(n))`, with `n` the face ellipsoid's normal at the rest
  point bent by the luminance gradient of the rim's four taps, `R` the turn's rotation, `shade` a
  wrapped Lambert term toward a key light from the upper left in front; the brightening is tinted by
  `palette.rim`. The rim (alpha gradient, same taps) is scaled by `1 + 2 * light * delta` for its
  edge's own normal, so it grows on the edge turning into the light and fades on the other. No new
  texture taps.

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
