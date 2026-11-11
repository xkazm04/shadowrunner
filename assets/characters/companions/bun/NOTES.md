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
- blink: a cross-fade through the half stop, short enough not to read as a ghost.

## Known
- Recolour reads the region map at the displaced point: under a gaze key, eye-white pixels whose
  back motion lands on a strand take a faint hair tint at the eye corners. "Black" hoodie reads light
  grey (the rule keeps lightness).

## Refused keys
None: 13 keys plus 6 families x 2 parts pass every gate.
