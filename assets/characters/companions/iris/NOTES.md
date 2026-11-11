# Iris: notes

Photoreal companion (silver bob, black headset with boom mic, charcoal ground). Built by
`tools/portrait-keys` from `portrait.png`, `recipe.json` and `edits/*.webp`; see `report.json` in
`assets/replay/companions/iris/` for every gate figure.

## Measured layout (1024 px)
- Pupils (the morph's `eyes`): (437, 346) and (589, 345). Iris radius about 21 px.
- Mouth: corners x 457-574 (width 118), parting line y 512, centre x 515. Chin bottom about y 610.
- Regions: `eyes` two ellipses 80 x 44 about the eyes (they touch at the nose bridge); `mouth`
  92 x 58 about (515, 515); `mouthWide` 100 x 85 about (515, 535) for the dropped jaw; `face`
  160 x 205 about (514, 440), brows to chin.

## Recipe decisions
- Mattes: alpha from the `matte` and `head` green-screen edits (projection keyer), never luma (the
  black headset and dark roots sit on a #16181d ground). The ground check lowers 0.7 % of the
  figure's pixels where the portrait itself shows ground. Recomposed head + body + ground vs the
  portrait: mean 0.16/255, p99 3.75/255.
- Head anchor (512, 592): top of the neck under the chin. Body anchor (512, 1024).
- Flow per key, judged on the strips (`var/companion-lanes/sheets/iris/key-*.jpg`, top row morph,
  bottom row plain cross-fade):
  - mouth keys and blink: `optical` (DIS, forward-backward checked). The lips stay one continuous
    outline at 0.5 where the cross-fade shows a double lip line.
  - face families: `optical`. The DIS fields are noisy over a whole face, so the builder scales them
    down to what the shader's two fixed-point steps invert (joy and showman to about 0.3-0.4); the
    gain over a cross-fade is small but never worse.
  - gaze: `iris`, a translation per eye measured by masked template matching (L/R 34-38 px, U 12 px,
    D 21 px), spread over the eye opening. At 0.5 one iris travels instead of two showing; the
    field is scaled to 0.42-0.86 for the shader's inversion, so a faint second iris remains at
    0.5-0.75 on gaze_l and gaze_r.
- Blink: two stops, `blink_half` at 0.5 and `blink` at 1.
- Face profile: calm (gaze range 0.5, 0.8 saccades/s, drift/tilt/gesture 0.7, breath 0.3).
  Expression strength stays 1: a held mood then shows its key at weight 1, never a permanent
  in-between.
- Turn: warp 0.4, light 0.15 (low: the relight crawls on skin texture).
- Sway: amp 8 px; 0 inside the face/skull ellipse, rising to the bob's lower edge; held at 0 on the
  ear cups and the boom mic, and on the jaw.

## What the sheets show
- Layers over magenta/white/black: clean silver strands and flyaways, no green and no charcoal
  fringe; a few thin dark strands read as dark on white (they are dark in the art). A faint blur of
  the boom mic's tip sits in the body layer under the head (hidden unless the head moves far).
- Seam (head moved 6, 4 px over the body): no line under the jaw; the neck runs on under the chin.
- open_wide: the edit drops the chin a little below the head layer's edge; the key cannot add
  coverage, so the open mouth's chin is the rest chin. Reads fine at 1.
- joy / showman: the edit rounds the whole face (cheeks up, 1.6 px register); mid-weights show a
  soft double mouth for a moment during a mood cross-fade.

## Refused keys
None: all 19 keys pass every gate.
