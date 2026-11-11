# Bun: notes

Anime streamer (pink hair, side ponytail, cream cat-ear headphones, sky-blue ground). Built by
`tools/portrait-keys` from `portrait.png`, `recipe.json` and `edits/*.webp`; see `report.json` in
`assets/replay/companions/bun/` for every gate figure.

## Measured layout (1024 px)
- Pupils (the morph's `eyes`): (432, 417) and (598, 417). Iris radius about 40 px (big anime eyes).
- Eye openings x 347-472 and 560-680, y 367-450. Mouth: x 489-542 (width 54), line y 527, centre
  515. Chin point about y 602.
- Regions: `eyes` two ellipses 82 x 54; `gaze` the same widened to 120 x 56 (room for a gentle
  motion ramp); `mouth` 58 x 42 about (515, 530); `mouthWide` 66 x 60 about (515, 545); `face`
  190 x 175 about (515, 450), fringe to chin (the face edits redraw fringe strands over the brows).

## Recipe decisions
- Mattes: as Iris. The ground check (pink against sky blue) lowers 1.1 % of the figure's pixels:
  gaps between strands that the matte edit painted over now show the ground, with no blue inside the
  layer. Recomposed vs the portrait: mean 0.27/255, p99 4.6/255.
- Head anchor (515, 600), body anchor (512, 1024).
- Flow per key, judged on the strips:
  - blink, mouth keys, face families: `none` (cross-fade). Flat fills give DIS nothing to follow
    (the prototype's smear); on the strips a cross-fade of flat anime art reads as a quick dissolve.
  - gaze: `iris` (translation per eye, L/R 39-46 px, U 13 px, D 33 px). Better than the cross-fade
    (one iris travels further before the second appears), but the shader's two-step inversion holds
    only 0.37-0.92 of the move, so gaze_l / gaze_r still show a second, fainter iris at 0.5-0.75.
    See "Open" below.
- Blink: two stops, `blink_half` at 0.5 and `blink` at 1.
- Face profile: lively (gaze range 0.7, 1.6 saccades/s, drift and tilt 1.3, gesture 1.4, breath 0.4,
  expression strength 1).
- Turn: warp 0.5, light 0.3.
- Sway: amp 9 px; hair ends and the ponytail (boosted to at least 0.8), cat ears capped at 0.3,
  headphone cups and the face/jaw held at 0.

## What the sheets show
- Layers: clean pink edges over all three grounds; thin strands keep a little lilac where they are
  semi-transparent. Hoodie bits visible between hair strands at the shoulders are in the art.
- Seam: no line under the chin with the head moved 6, 4 px; a 1-2 px light sliver shows at the right
  side of the neck where hair meets neck (the body colour pushed under the hair edge).
- open_wide: a faint grey halo round the open mouth at weight 1 (the edit's own shading).

## Open
- The anime gaze would be clean with half-way gaze edits as extra stops (gaze_l_half at 0.5, the
  design's "extra stop" fallback) or with more fixed-point steps in the shader.

## Refused keys
None: all 19 keys pass every gate.
