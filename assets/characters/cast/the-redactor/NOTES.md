# The Redactor: decomposition notes (cast-forge task 3)

Style: 16-bit pixel art (contest supporting-cast B/6 style-3). Portrait 1024 px (from a 1254 px render,
so the art's cells are about 7 px with a 1 px blend between them), `brief.json` as staged.

## Parts (parts.json, PartsV2, 7 parts -> 8 rig layers with the background)
`cut: { feather: 0, cell: 7 }`: a hard cut (no feathered edge smears a pixel cluster) and a mouth
cavity stepped on the art's 7 px cell.

| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| censor_bar | float | head (default) | float amp [0, 6] px, 0.22 Hz, rot 0.6 deg; pulse amp 0.35, 0.45 Hz | the figure above row 128 (slab, rim and yellow edge line), traced a cell onto the ground |
| eye_r, eye_l | eye_r, eye_l | head | - | the yellow pinprick in each lens box, grown 3 px; `fill: "extend"` |
| inkstamp | accessory | torso | float amp [2, 0.5] px, 0.35 Hz, rot 2.5 deg (a swing) | gold (R - B > 35) below the chain's ring |
| jaw | jaw | head | drop 21 px (3 cells, 0.0205), glow #ffd60a | the face under the mouth line (darkest row) between the mouth's corners |
| head | head | - | - | the figure above the collar's top (row 560), below it only the chin's light dither; a cell onto the ground |
| torso | torso | - | - | the figure below the collar's top, the head taken out |

Rebuild: `node scripts/cast/recipes/the-redactor.mjs` then `node scripts/cast-forge.mjs the-redactor`.

## Departures from the brief's parts plan
- **censor_bar + bar_glow merged** into one layer carrying both a float and a pulse. A float is not
  inherited by followers, so a separate glow layer following the bar would stay put while the bar bobs.
  The pulse lifts the yellow edge line; on the near-black slab it is barely visible, as wanted.
- **mouth_glow became the jaw's `glow`**: the yellow is painted into the mouth cavity, flat, at the
  bottom of the opening. There is no separate layer, so it does not "brighten as the jaw opens"; it is
  revealed as the jaw opens.
- **eyes are the pupils, not the lenses.** A blink squashes the eye layer to a tenth of its height;
  squashing a round black lens looks like broken glass, squashing the yellow pinprick reads as a
  narrowed eye behind dark glass. The lenses and frames stay on the head.
- **inkstamp without its chain**: the chain stays on the torso; only the stamp swings. A swinging chain
  would tear where it meets the collar.
- `collar_robe` became `torso`; `kind` fields became roles.
- **The slam is not built.** The brief's bar "drops across the mouth on a forbidden word". The rig
  carries only periodic float motion; an event-driven slam is a gesture the format does not have yet
  (a candidate for the engine's gesture list, not for this task).

## What was hard
1. **Mouth.** The first sheet (after the cavity code) showed a W-shaped yellow band: the glow was
   placed under each column's own depth. It now lies flat along the bottom of the full opening.
2. **Head fragments on a turn.** A 60-point outline of a stair-stepped pixel silhouette cuts cells off;
   the cut-off cells stayed on the background and showed as white slivers beside the turned head. The
   head is now traced a whole cell (7 px) onto the ground, and it is the whole figure above the collar
   (the ears' dark shading included), not only the light face.
3. **Chin against the collar.** The collar's grey rim (luma 70-90) is a few px from the chin; below the
   collar's top the head takes only the chin's light dither (luma > 120).
4. **Fill drift.** The Codex edit painted realistic eyes behind the spectacles (a style change); the
   pupils therefore take `fill: "extend"` (the dark lens around them) instead of the edit.

## Still wrong (honest state)
- The open mouth's corners show the fill plate (the edit's re-render of the lip, slightly soft and
  JPEG-compressed), not crisp pixel clusters; the cavity itself is crisp.
- The art was resized 1254 -> 1024 before staging, so cells are 7.1 px with a blended column between
  some of them; the cut cannot be cell-exact, and polygons are quantised to 1/1000 of the canvas.
- The avatar renderer samples layers with linear filtering (GL) / smoothing (canvas2D); at fractional
  offsets the pixels soften. A nearest-neighbour option per rig is not built (it belongs to the avatar
  package, outside this task's scope).
- Blink, rotation and the review of reduced motion were not drawn by the review compositor.
- A tiny static tick remains at the right cheek's lower edge at yaw -15.

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["floating black censor bar and its
yellow edge line", "the round black spectacles and their yellow pupils", "the brass inkstamp and its
chain", "the lower lip and chin"])` (mean difference 8.4/255 after the area resize), JPEG q92 by
`scripts/cast/import-fill.mjs`. Only the lifted regions reach the plate, and not the pupils'.
