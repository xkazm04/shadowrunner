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

## Round 4 (the defect round, 2026-11-11)
New edits `openWide_half`, `blink_quarter`, `blink_3q` (Codex, same prompt scheme), brought in with
`import --only` (no other edit re-encoded). 16 keys plus 6 families x 2 parts; all gates pass
(weight 1 at 1.13-1.74/255). Boards: `var/companion-lanes/round4/iris/board-*.jpg` (before | after,
the real renderer at 640 px); strips in `var/companion-lanes/round4/sheets/iris/`.
- `openWide`: `open_wide_half` at 0.5, `open_wide` at 1, both `optical` (sigma 12, F from G). Each
  field now carries at most about half the lip travel: the lower-lip skew at 0.25 is gone; the
  strip in eighths opens evenly with no step at 0.5 (`board-openwide.jpg`, `track-openWide.jpg`).
- `blink`: four stops, `blink_quarter` .25, `blink_half` .5, `blink_3q` .75, `blink` 1, all
  `optical`. Compared on the strips: `none` (cross-fade) shows the iris through a see-through lid
  at .375 and a ghost lid even at 1; the round-4 `lid` field (Bun's, below) left a broken lash line
  at .875 on this face; `optical` reads as the lid coming down, with a little dissolve left at the
  midpoints between stops (.375, .625). Chosen: `optical`.
- The gaze keys' coverage now covers their whole field (round 4 fix for Bun); on Iris the strips
  and boards are unchanged (`board-regress.jpg`).
- Region slots carry `shade: "move"` (recolour maps lightness too, design "Round 4 amendment").

## Round 6 (mouth size in speech, 2026-11-11)
Owner: the speaking mouth was too large. Each viseme drove its track to 1, so speech always showed
the edit at full size. The recipe's `mouthGain` (the Director's choice on the strength strips
`var/ms/iris-strength.jpg`) is copied to `morph.mouthGain`: openMid 0.7, round 0.6, tongue 0.7,
narrow 0.6, openWide 0.45 (an "ah" lands at 0.45 on the track: `open_wide_half` at 0.9, the wide
key never reached in speech at the default `mouth.size`). `closed` and `teeth` are not reduced.
No key's bytes changed (only `job.json`). Boards: `var/companion-lanes/round6/board-iris.jpg`
(every shape at weight 1, before | after).

## Round 7 (polish, 2026-11-11)
Boards (before | after, the real renderer at 1024 px): `var/companion-lanes/round7/keys/board-*.jpg`;
strips in `round7/keys/sheets-{before,after}/iris/`.
- Haze beside the left ear (picture right) with white hair: soft coverage claimed the skin with a
  few fine strands in front of the ear (x 646-664, y 388-440). The hair part's `without` gains
  [655, 414, 9, 26]: haze gone; the strands there keep the art's silver, and a small step remains
  where the white meets the face ellipse's cut at about (654, 440) (`board-item2-iris-ear-haze.jpg`).
- The liner's wing tips (cyan, inside the rim-light hair test) were hair: `without` [380, 340, 6, 5],
  [645, 339, 6, 5]. No eye pixel is hair now (`board-hair-slot-eyes.jpg`).
- gaze_d's second liner wing: the iris translation dragged the lid margin and liner 21 px while the
  edit moves them less, so two liners cross-faded. `gaze_d` sets `gates: {gazeLid: true}`: the upper
  lid moves by the lash line's measured travel (lid.py, 24-28 px at weight 1) and the iris below by
  its translation; the recipe sets `gazeAhead` (the vertical field grows only toward its motion).
  At 0.5 the second wing is down to a small loop at the outer tip and the doubled iris is gone
  (`board-item3-iris-gaze-d.jpg`). gaze_u changes by a few px at the lower lid, no visible change.
- Blink fade between stops (.375, .625): blink keys at field sigma 8 instead of 12 looked the same
  on the strip and in the renderer (`board-item5-iris-blink.jpg`); reverted, not fixed.
- `mouthGain.narrow` 0.6 -> 0.75 (`board-item6-narrow-strength.jpg`, forced weights .6-1 beside
  teeth): at 0.75 the mouth stretches sideways to nearly its full width with both rows of teeth and a
  modest gap; 0.8 already reads as the full grin.
- `residual: "clean"` on every key: every strip equal (re-encode noise, mean 0.1-0.5/255; the drift
  mask removed almost nothing on this face; showman 4.40 -> 4.43, anger 2.62 -> 2.62). Kept on all.
- `soft.levels` 32: head.regions.png 60528 -> 43898 bytes; no banding at 2x on the fringe or the bob
  edge (`board-item8-fringe-2x.jpg`, `board-item8-bob-edge-2x.jpg`).
- Pack 804261 bytes. 16 keys plus 6 families x 2 parts, all gates pass (weight 1 at 1.13-1.74/255).

## Known
- gaze_d at 0.5: a small loop of the second wing remains at each outer tip (past the opening, where
  the lid travel fades out).
- Blink: a little dissolve remains between stops (.375, .625).
- Recolour keeps the art's lightness (the renderer's rule): "black" hair reads dark grey-silver,
  not black; the fringe's very tips (mixed with forehead skin) stay silver-grey.

## Refused keys
None: 13 keys plus 6 families x 2 parts pass every gate.
