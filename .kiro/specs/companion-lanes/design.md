# Design: companion-lanes

## Why morph keys (the measured ground)
- Scout, renderer: the art mouth opens onto a flat dark gradient, `teeth` and `tongue` are never
  drawn (`mouth/warp.ts`); a blink cross-fades a lid patch; hair moves only as rigid cut parts; the
  only in-layer deformations are the mouth warp and the turn grid.
- Scout, forge: every cast `parts.json` came from a hand-written recipe per character; the ground
  key is capped at luma 28, so it does nothing on Bun's sky blue and is an on/off cut on Iris's
  charcoal; alpha is a polygon with an inward feather.
- Experiment (2026-11-11, `var/companion-lanes/edits`, `morph`): eight Codex edits (closed eyes,
  open mouth, smile, no-op, both portraits) registered to their source by an affine within
  0.1-0.4 px of identity (joy on Iris: 1.6 px, 0.2 % scale); median motion 0.4-1.2 px; mean change
  outside the face 2.5-4.2/255 (the editor's noise floor). A dense motion field (OpenCV DIS) between
  portrait and edit gives a believable half-open mouth on the photoreal face; on the anime face it
  smears (flat fills carry no texture to follow), so anime keys cross-fade through stops.
- Registry `talking-avatar` golden path: keep motion, drawing and timing apart; one parameter
  vocabulary; warp head layers through one field. Named deviation: it advises against generated
  variants of moving parts ("discrete pictures that can only be cross-faded"). Here the variants
  are registered, gated and joined by a motion field, the in-betweens are drawn from the portrait's
  own pixels, and the keys' colour arrives only where new surface appears (teeth, lids).

## Data
`packages/rig/src/types.ts` is the declaration (`RigMorph`, `MorphKey`, `MorphTrack`, `MorphSway`).

- Canvas 1024 x 1024. Layers of a portrait-lane rig, back to front: `background` (kind `static`,
  the ground alone, opaque), `body` (kind `body`: neck, shoulders, clothes; soft alpha), `head`
  (kind `head`: hair, face, ears, headgear; soft alpha; the morph layer). No jaw, eye or iris layer.
- `morph.atlas`: WebP with alpha, at most 2048 x 2048; one cell per key, 1 atlas px = 1 canvas px,
  2 px gutter of repeated edge pixels around each cell. Straight alpha in the file.
- `morph.flow`: PNG (lossless), RGB; a key's flow cell is its bbox at 1/4 size (rounded up), 1 px
  gutter. Displacement in canvas px = `(code - 128) / 127 * flowMax`; code 128 is exactly zero.
- Absent values: an optional field is omitted, never null or 0 (the rig's wire rule). A key without
  motion has neither `flowCell` nor `flowMax`; a rig whose keys all lack motion has no `flow`.
- `Rig.mouth` (`cx`, `lineY`, `width`) is still written (the lab's region of interest reads it),
  with no `lips` and no `render`.
- `Rig.palette.rim` is `#000000` on both characters (a rim would outline every loose strand);
  no layer is emissive.

## Tracks
Track value `v` in [0, 1]:

| track | value |
|---|---|
| `blink` | `Drive.blink` (the larger of the driver's and the layer's own) |
| `openWide` `openMid` `round` `closed` `teeth` `tongue` `narrow` | that mouth shape's weight after emotion-free mixing; if the seven sum above 1 they are divided by the sum |
| `joy` `showman` `anger` `gloom` `smug` `suspicion` | the family's weight in the mood cross-fade (as `LayerPose.faces`), times the face profile's `expression.strength`; a family retired to `"procedural"` gives 0 |
| `gazeL` `gazeR` | `max(0, -gx)`, `max(0, gx)` with `gx = Drive.gaze.x * range / 0.6` clamped to [-1, 1] |
| `gazeU` `gazeD` | `max(0, -gy)`, `max(0, gy)`, same scaling |

Stops: a track's keys sorted by `at` are `a1 < ... < an` (a missing `at` is 1). With `a0 = 0` meaning
the layer's own pixels: for `v` in `[a(k), a(k+1)]`, key `k+1` has weight `(v - a(k)) / (a(k+1) - a(k))`
and key `k` (if k >= 1) the rest; above `an` the last key has weight 1.

Groups, in compositing order: `face` (the six families) < `gaze` < `mouth` < `blink`.
Active keys: weight > 0.002; at most 8, the lowest weights dropped; ordered by group, then by the
key's position in `morph.keys`.

Mouth on a morph rig: `mouthMode` returns `"morph"` when the rig has a morph key on a mouth track.
The player keeps computing shape weights as today (visemes, or the level's `openMid` fallback); the
emotion's mouth bias is not applied (the expression key carries the mouth). `jawOpen` moves nothing.

## Shader
One program for the morph layer: the base program's fragment with its texture read replaced.
All coordinates below are canvas px in the layer's rest frame (before the layer's pose).

```
D(p)  = sum_i  w_i * F_i(p)                       F_i = key i's decoded flow at p (0 outside bbox / no flow)
p0    = x - D(x);   p = x - D(p0)                 two fixed-point steps of  p = x - D(p)
c     = layer(p)                                  premultiplied, as the base pass reads it
for each group g in order:
  S   = sum_{i in g} w_i * m_i                    m_i = alpha of key i's cell at q_i = p + F_i(p)
  C   = sum_{i in g} w_i * m_i * rgb_i(q_i) / max(S, 1e-4)
  c.rgb = mix(c.rgb, C * c.a, min(1, S))          the key takes the layer's alpha; it never adds coverage
```
The rest of the base fragment (recolour, gain, rim, turn light, glow source) runs on `c` unchanged;
the region map is read at `p`. Uniform arrays of length 8: cell, bbox, flowCell, weight, flowMax,
group. A frame with no active key and no sway draws the layer with the base program.

Sway: before the above, `x' = x - s(x) * amp * L` where `s` is `sway.map` at `x` and `L` the lag
vector in [-1, 1]^2 from the frame's spring (`Drive.spring`; the builder reads `spring.ts` and picks
the head's channels, plus a slow idle drift of at most 0.15). `still` (reduced motion) gives `L = 0`.

Canvas 2D: the layer, then each active key's cell drawn over its bbox with `globalAlpha = w`.

### Round 2 amendment (2026-11-11): no fixed point, a back cell, reveal
Measured in round 1: two fixed-point steps of `p = x - D(p)` only invert gentle fields, so the
builder had to scale every field down until the inversion held (`open_wide` kept 0.23 of its
motion, the gaze 0.4-0.9) and the wide mouth faded in instead of parting. The shader math above is
replaced by a scheme that needs no inversion and is exact at both ends for any motion:

```
Fh_i(x) = mix(F_i(x), -G_i(x), w_i)        F_i: flowCell at x (layer frame); G_i: backCell R,G at x
                                           (key frame); no backCell: Fh_i = F_i
D(x)    = sum_i w_i * Fh_i(x)
p       = x - D(x)                         the layer is read at p (also the region map, the rim taps)
q_i     = p + Fh_i(x)                      key i's colour, coverage m_i and reveal r_i are read at q_i
a_i     = mix(w_i, smoothstep(0, 0.4, w_i), r_i)      r_i = backCell B at q_i; no backCell: 0
groups:  S = sum a_i m_i;  C = sum a_i m_i rgb_i / max(S, 1e-4);  c.rgb = mix(c.rgb, C * c.a, min(1, S))
```
One key at weight 1: `p = x - (-G)`, `q = x`, so the key's cell is reproduced exactly. Weight 0:
the layer. A pure shift `d` (F = d, G = -d): the layer moves `w d` and the key meets it. Sway is
applied to `x` first, as before. The builder writes F and G unscaled (both faded to 0 with
coverage), and `r` from where the key does not match the layer it was warped from.

### Round 3 amendment (2026-11-11): parts, colour apart from motion, gaze yields
Seen on the first lab recordings: a smile held while the mouth speaks left the smile's creases
around a neutral mouth; a gaze key over an expression ghosted the neutral eye onto changed lids.
The declaration moved to `packages/rig/src/morphTypes.ts` (re-exported from `types.ts`).

- `MorphKey.part?: "upper" | "lower"` on the six family tracks only. A family is one whole key or
  one `upper` plus one `lower` key at the same `at` (ids `<family>_upper`, `<family>_lower`); the
  two coverages are a partition of unity across a 24 px band at the character's own cheek line
  (`faceSplitY` in the recipe: 412 on Iris, 466 on Bun), so both at weight 1 equal the whole key.
- The plan gives every active key two numbers: the motion weight `w_i` (as before) and a colour
  scale `k_i` in [0, 1]. The shader's `a_i` becomes `k_i * mix(w_i, smoothstep(0, 0.4, w_i), r_i)`;
  the Canvas 2D fallback draws with `globalAlpha = opacity * w_i * k_i`.
- `speak` in [0, 1]: the sum of the non-rest mouth shapes, eased by the player (60 ms attack,
  350 ms release). A `lower` key gets `k = 1 - speak` and `w * (1 - 0.5 * speak)`: the smile's
  mouth and creases give way to the speaking mouth while half of its cheek motion stays.
- Gaze keys get `k = 1 - E` and `w * (1 - E)` with `E = min(1, sum of the family track values)`:
  a gaze field measured on the neutral eye smears an expression's lids, so the gaze yields in
  colour and in motion while an expression is held (the layer's own drift and saccades continue).

### As built (task 2, rounds 1-2): where the builder left this page
- Field smoothing is Gaussian sigma 12, not 2: at 2 and 4 the widest mouth tore the lower lip at a
  quarter weight. The forward field is derived from the back field, so both describe one motion;
  both fade to 0 inside the head's outline and each key's coverage is widened to cover its motion.
- Gaze keys are a translation over each eye's measured opening (recipe `openings`), not optical.
- Bun's mouth and family keys are optical (clearly better than the cross-fade once the two-ended
  scheme landed); Bun's blink stays a cross-fade through the half stop.
- Layers and atlas are WebP q95. Each layer carries a region index map (`<layer>.regions.png`)
  built by `regions.py` from a recipe rule per slot: Iris head `hair`, body `jacket`; Bun head
  `hair` and `headphones`, body `hoodie` and `strings`.
- Where nothing moves and the edit is within the editor's noise, the key's colour is the
  portrait's own (removes a grey halo around Bun's widest mouth).

### Round 4 amendment (2026-11-11): the defect round
Six defects named on the owner's verdict page. Five new Codex edits (same prompt scheme) give the
tracks more stops: Iris `openWide_half` (an even oval halfway to the wide "ah"), and
`blink_quarter`, `blink_3q` on both characters.

- Iris `openWide` has two stops: `open_wide_half` at 0.5, `open_wide` at 1 (the lower lip skewed
  near a quarter weight when one field carried the whole 45 px travel).
- `blink` has four stops on both: `blink_quarter` 0.25, `blink_half` 0.5, `blink_3q` 0.75, `blink`
  1. Motion or cross-fade per character, chosen on the strips; the target is a lid that reads as
  sliding, with no doubled lid or iris smudge at any in-between weight, also over a held expression.
- Bun `gaze_d`: no ring of the old iris; Bun gazes: hair strands crossing the eye do not move with
  the iris (the head's `hair` region is excluded from the gaze fields).
- Region recolour can move lightness as well as hue, opt-in per slot: `RegionSlot.shade?: "move"`
  (omitted when absent). On such a slot the pixel's lightness goes through the piecewise-linear
  curve `(0,0) - (lr,lt) - (1,1)`, `lr` the lightness of the slot's `hex`, `lt` the target's, both
  clamped to [1/256, 1 - 1/256] (so `lt = lr` is the identity). Every other slot, and the lights
  (glow, eye, mouth), keep character-control's rule unchanged. Why opt-in: the forge splits
  near-grey pixels into lightness bands (`packages/forge/src/regions.ts`); moving one band's
  lightness tore it from its neighbours on Sister Vesper (posterised strands, a lit backdrop
  trapezoid), while material slots (the companions', Lot Ninety's suit) map cleanly. The portrait
  builder writes `shade: "move"` on every companion slot; the cast is byte-for-byte as before.

## Builder
`tools/portrait-keys/build.py` (Python 3.12: numpy, opencv-python, pillow; `requirements.txt`).
`python tools/portrait-keys/build.py <character dir> --out <built dir> [--sheets <dir>]`.

Character dir `assets/characters/companions/<slug>/`:
- `portrait.png` (1024 x 1024), `recipe.json`, `edits/<name>.webp` (each edit area-resized to 1024,
  WebP q92; raw 1254 px PNGs stay in `var/`), `NOTES.md`.
- `recipe.json`: `{ id, name, eyes: [[x,y],[x,y]], mouth: {cx, lineY, width}, regions: {<name>:
  {ellipses: [[cx,cy,rx,ry],...]} | {box: [x,y,w,h]}}, mattes: {figure: "matte", head: "head"},
  floor: "noop", keys: [{id, track, at?, edit, region, flow: "optical"|"none", optional?}],
  sway?: {amp, ...}, gates?: {...} }`.

Steps:
1. Mattes. `figure` and `head` edits replace everything else with #00FF00: alpha = soft chroma key
   on the edit (despilled), figure and head. Colour = the portrait's own pixels, un-mixed against
   the portrait's ground (ground estimated per pixel by extending the background under the figure).
   `head` = head alpha x figure alpha; `body` = figure alpha minus head alpha, then extended 40 px
   under the head's edge by pushing its own colour inward (a normalised blur), alpha fading to 0
   deeper in, so a moving head uncovers neck and collar, never a hole; `background` = the extended
   ground. Each layer cropped to its alpha box (4 px pad). Layers are WebP with alpha, q92.
2. Per key: register the edit (ECC affine on half-size greys); refuse if the affine moves a corner
   by more than 6 px. Region prior from the recipe, feathered 10 px. Support = where the registered
   edit differs from the portrait by more than 3x the floor's local level, or moves more than
   0.75 px, dilated 10 px, feathered 8 px, times the prior, times head alpha. Coverage = support.
   Gate: mean abs difference outside the prior (inside the figure) <= floor + 3 (of 255).
3. Motion (`flow: "optical"`): DIS (medium preset, finest scale 1) portrait -> registered edit on the
   region crop, Gaussian sigma 2, times coverage, sampled to 1/4 size. `flowMax` = the cell's largest
   |component| rounded up to an integer, at least 1.
4. Colour match: residual `r = blur(portrait - edit)` taken outside the support and extended across
   it; the key's colour is `edit + r`. Cell = the bbox of coverage > 0, RGB + coverage as alpha.
5. Pack the atlas and the flow image (shelf packing), write `job.json` `{ rig, built: {...figures} }`
   and `report.json` (per key: affine, corner shift, floor, outside-prior difference, support px,
   flowMax, verdict).
6. Sheets: per key a strip of five morph weights computed with the Shader section's math in numpy,
   and `contact.jpg` (every key at weight 1 on the composed character).

## Files and ownership
- Task 1 (builder A): `packages/rig/src/**` (not `types.ts` except to fix a contract error it
  reports), `packages/avatar/src/**`, `packages/pack/src/**`, the web app's `rigFiles`, the rig
  section of `docs/rig-format.md`.
- Task 2 (builder B): `tools/portrait-keys/**`, `assets/characters/companions/**`,
  `assets/replay/companions/**`, `scripts/build-packs.mjs` and its test, `scripts/portrait/**`.
- Task 3 (after 1 and 2): `apps/web/bench/**` capture page, `scripts/portrait/capture.mjs`,
  end-to-end tests, creator checks, lab scenarios.
- The Director owns this spec, `docs/provenance.md`, `docs/kiro-log.md`, the edits themselves.

## Non-goals
- The live forge (a visitor forging their own portrait-lane character with keys in the cloud): the
  builder needs OpenCV and a set of twenty edits per character; a later spec.
- Joining the Halloween cast: no briefs, shows, listings or voices for the two.
- A neural talking-head model at run time; LivePortrait as a key source (probed, not adopted: its
  face detector is licensed for research only).
- Cutting hair into rigid parts; a depth map.

## Risks
- A motion field that smears mid-morph: judged per key on the review strip; that key falls back to
  `flow: "none"` with an extra stop.
- Expression plus viseme: the mouth group covers the expression's mouth, so a smiling face speaks
  with the neutral keys' lips, displaced by the smile's motion. Judged on the capture boards.
- Editor drift on a retry: the gate names it; three refusals and the key ships absent.
- Atlas size on the photoreal face: six face keys at about 420 x 420 px plus thirteen smaller cells
  must fit 2048 x 2048; the builder fails loudly if not.
