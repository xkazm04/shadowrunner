# Bun: notes

Anime streamer (pink hair, side ponytail, cream cat-ear headphones, sky-blue ground). Built by
`tools/portrait-keys`; gate figures in `assets/replay/companions/bun/report.json`, sheets in
`var/companion-lanes/sheets/bun/`.

## Measured layout (1024 px)
- Pupils (the morph's `eyes`): (432, 417) and (598, 417). Iris radius about 40 px. Eye openings:
  ellipses 74 x 34 about (410, 414) and (620, 414); the iris is taller than its opening.
- Mouth: x 489-542 (width 54), line y 527, centre 515. Chin point about y 602.
- Regions: `eyes` 82 x 54; `gaze` 120 x 56; `mouth` 58 x 42; `mouthWide` 66 x 60; `face` 190 x 175
  about (515, 450), fringe to chin.
- Cheek line (`faceSplitY`): y 466, a 24 px band (454-478), below the lower lashes (about 450) and
  above the mouth (527); there are no creases in this style.

## Recipe decisions (round 2)
- Mattes as Iris, plus the ground check (pink on sky blue). The neck under the hair takes its colour
  from the nearest clear neck pixel: the light sliver at the right of the neck when the head moves
  is down to a faint line. Keys snap to the portrait where nothing moves and the edit is within
  the editor's noise: the grey halo round `open_wide` is gone.
- Motion: mouth keys and the six families `optical` (sigma 12, F from G); on the strips they beat
  the cross-fade (one mouth shape, one pair of eyes, no double outlines). Blink and blink_half stay
  `none`: optical blink smeared the iris under the lid (a purple crescent at 0.75-1.0). Gaze `iris`
  (L/R 39-46 px, U 13, D 33); a vertical field may reach 2.5 times the opening's half height
  (`gazeReach`) so the whole iris travels.
- Weight 1 at codec error (0.7-2.2/255); upper + lower 1.3-1.7/255.
- Recolour: head `headphones` (cat ears whole; cream, mint and outline pixels above y 300 and in
  the cups), `hair` (pink, hue 0.86-0.985, lightness 0.36-0.97; lips left out); body `strings`
  (mint drawstrings and grommets), `hoodie` (all but pink hair bits and the neck skin).
- Face profile lively; turn warp 0.5, light 0.3; sway amp 9 px.
- WebP q95: head sharpness 0.971 of the portrait, keys 0.98-1.02.

## What the strips show
- gaze_l/r: one iris travels; strands crossing the eye bend with it at 0.25-0.75 and the lash line
  slides a little. gaze_d: the iris moves down whole; its lower part is a shade lighter mid-way.
- open_wide / open_mid / round: the mouth opens as one shape (reveal brings the inside in early).
- blink (round 2): a cross-fade through the half stop; replaced in round 4 (below).

## Round 4 (the defect round, 2026-11-11)
New edits `blink_quarter`, `blink_3q`, brought in with `import --only`. 15 keys plus 6 families x 2
parts; all gates pass (weight 1 at 0.75-1.96/255). Boards: `var/companion-lanes/round4/bun/board-*.jpg`
(before | after, the real renderer at 640 px); strips in `var/companion-lanes/round4/sheets/bun/`.
- `blink`: four stops (.25 .5 .75 1), new flow `lid` (`portrait_keys/lid.py`): per eye and column
  the portrait's upper lash line is found in the edit (a column template matched downward, a
  running median across columns); the key's back field is one monotone remap per column: the lid
  stretched from `lidReach` (1.6) x ry above the lash down to the new lash, the open eye below it
  moving with it over `lidHold` (0.7) of what is left and then pressed into the lower lash; blurred
  `lidSigma` 16 px down, 1.5 across. Travel at weight 1: 67-70 px (quarter 23-28, half 44-45,
  3q 51-62). Why: the cross-fade doubles the lid at every midpoint (.125, .375, .625, .875);
  `optical` (DIS) smeared the iris under the lid; a field where the lid simply covers the eye (a
  fold) is exact for one key but tears when two stops mix their fields; sigma 8 left more doubling
  than 16, 24 no better than 16. Result: on the stops the lid sits where the edit has it, with no
  ghost (`board-blink.jpg`); between .25 and .5 a faint grey second lash remains (`track-blink.jpg`
  at .375: the two keys' lids land a few px apart, as the shader reads each field at the mixed
  point); .625 and .875 are close to one lid.
- Over held expressions (`board-blink-expr.jpg`: furious, delighted, bored at blink .25/.5/.75)
  the ghost lids are gone; the blink keys now replace the expression's eyes with the neutral
  stop's lids (furious at .25 shows calm, wide eyes; bored at .25 opens wider than bored itself).
  A runtime rule is needed (see the round-4 report), not a key.
- `gaze_d`: the ring of the old iris under each eye is gone. Cause: the iris field reaches 2.5 x
  the opening's half height below the eye, past the `gaze` region prior, so the key's coverage
  there was thin and the moved iris showed through. A gaze key's coverage now holds its whole field.
  Mid-way (0.5) the lower part of the iris is still a shade lighter, less than before.
- Fringe strands crossing an eye still bend with the iris on a glance. Tried: the head's `hair`
  slot held out of the gaze fields (field 0 there, the key's colour the portrait's strand,
  reveal 1 beside it), also only inside the openings: the strands stood still, but the field's
  step at each strand tore the lash line and the iris mid-gaze (worse than the bend), so it was
  taken out. A clean fix needs the strand drawn over the moved eye (a separate strand layer or a
  hair-held region the shader reads at x, not at the displaced point).
- Region slots carry `shade: "move"`.

## Round 6 (mouth size in speech, 2026-11-11)
Owner: Bun's mouth too large only when wide open. Her `open_wide` key arrives as colour (its field
moves the lips 7-9 px), so a gain on one key cannot shrink it. New edit `openWide_half` (a calm
"ah", Codex, `import --only`, no other edit re-encoded) as `open_wide_half` at 0.5, `optical`
(weight 1 at 0.93/255, 11 px of motion); `mouthGain` openWide 0.5 (the Director's, on
`var/ms/bun-strength.jpg`), so a full "ah" in speech lands exactly on the half key. The other
shapes keep gain 1 (0.36-0.65 of the mouth width, right for the style).
- The faint grey smudges either side of the wide mouth: the wide edit drops the chin line, outside
  the `mouthWide` prior; the colour match blurred that change (sigma 12) into the key's drift and
  carried it across the coverage. `open_wide` now has `residual: "clean"` (the drift sampled only
  where the edit is within twice the support level of the portrait): smudges gone, colourShift
  3.94 -> 2.49/255 (`var/companion-lanes/round6/board-bun-wide-key.jpg`).
- Strips (`round6/board-bun-eighths.jpg`): the shape in eighths opens evenly to the half key with
  no step. On the track above 0.5 (reached only with `mouth.size` above 1) the wide key still fades
  in as a cross-fade between two drawn mouths (`board-bun-track-eighths.jpg`, 5/8-7/8), as before.

## Known
- At blink 0.75 and 1 a faint purple line can show just under the lower lash (the pressed iris at
  the bottom of the lid field).
- Recolour reads the region map at the displaced point: under a gaze key, eye-white pixels whose
  back motion lands on a strand take a faint hair tint at the eye corners. "Black" hoodie reads light
  grey (the rule keeps lightness).

## Refused keys
None: 16 keys plus 6 families x 2 parts pass every gate (round 6).
