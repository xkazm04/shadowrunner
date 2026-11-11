# Iris: notes

Photoreal companion (silver bob, black headset with boom mic, charcoal ground). Built by
`tools/portrait-keys` from `portrait.png`, `recipe.json` and `edits/*.webp`; every gate figure is in
`assets/replay/companions/iris/report.json`, the sheets in `var/companion-lanes/sheets/iris/`.

## Measured layout (1024 px)
- Pupils (the morph's `eyes`): (437, 346) and (589, 345). Iris radius about 21 px. Eye openings
  (white + iris): ellipses 52 x 18 about (436, 349) and (590, 348).
- Mouth: corners x 457-574 (width 118), parting line y 512, centre x 515. Chin bottom about y 610.
- Regions: `eyes` 80 x 44 about each eye; `mouth` 92 x 58 about (515, 515); `mouthWide`
  100 x 85 about (515, 535); `face` 160 x 205 about (514, 440), brows to chin.
- Cheek line (`faceSplitY`): y 412, a 24 px band (400-424), between the lower lids (about 362) and
  the nostril wings (about 455). The smile's nasolabial creases and corner dimples start at the
  nose wings (about 440) and lie wholly in the lower part (checked on `key-joy_lower.jpg`,
  `key-showman_lower.jpg`); crow's feet and raised lids are in the upper part.

## Recipe decisions (round 2)
- Mattes from the green edits (alpha never from luma); recomposed vs portrait mean 0.16/255.
  `headOnly` box over the boom mic: its tip no longer leaks into the body layer.
- Motion: every key moves. Mouth, blink and the families: `optical`, DIS both ways, sigma 12,
  F the inverse of G (`flowFrom: back`). Sigma 2 and 4 tore the lower lip of `open_wide` at 0.25
  (the lip travels about 45 px, DIS loses it); 12 keeps the lip one piece and the mouth parts
  (lips apart, teeth and tongue uncovered at 0.5). Gaze: `iris`, one translation per eye
  (L/R 34-38 px, U 12, D 21) over the eye opening.
- At weight 1 every key is reproduced at codec error (1.1-1.7/255); upper + lower at weight 1 vs
  the whole key 1.2-2.0/255.
- Recolour: head `hair` (cool or neutral pixels, R - B < 0.03, plus cyan rim light; face, eye
  openings, ear studs and ear cups left out), body `jacket` (all but warm skin and the neck).
- Face profile: calm, expression strength 1. Turn: warp 0.4, light 0.15. Sway: amp 8 px, 0 on the
  face, jaw, ear cups and mic.
- WebP q95 (layers, atlas): head sharpness 0.995 of the portrait in the face, keys 0.99-1.23.

## What the strips show (0.25 / 0.5 / 0.75)
- open_wide, open_mid, round, narrow, tongue: the lips move apart and the inside is uncovered;
  0.25 of open_wide still shows a slight skew of the lower lip.
- blink_half, blink: the lid comes down as a dissolve more than a slide (the lid is new surface;
  reveal makes it arrive early); the two stops keep it short.
- gaze_l/r/u/d: one iris travels; the eyeliner moves a little with it at 0.25-0.5 (it lies inside
  the opening ellipse); gaze_d drags the lid and liner down with the iris, as the edit does.
- joy, showman: the smile widens and the cheeks rise as one face; no double mouth.

## Known
- Recolour keeps the art's lightness (the renderer's rule): "black" hair reads dark grey-silver,
  not black; the fringe's very tips (mixed with forehead skin) stay silver-grey.

## Refused keys
None: 13 keys plus 6 families x 2 parts pass every gate.
