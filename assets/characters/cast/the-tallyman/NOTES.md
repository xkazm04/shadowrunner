# The Tallyman: decomposition notes (cast-forge task 6)

Style: low-poly 3D (contest supporting-cast A/3 style-3). Portrait 1024 px (from a 1254 px render),
`brief.json` as staged. Flat-shaded grey facets under one cold top light, a frock barely above the
near-black ground (luma 14-30 on 2-5), chartreuse irises, olive brass, bone beads. The tone steps
between facets and the material colours are the cut lines.

## Parts (parts.json, PartsV2, 18 parts -> 19 rig layers with the background)

| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| eye_r1..3, eye_l1..3 | eye_r / eye_l | head | own `blink` 0.25 Hz, phases 0.019, 0.934, 0.849, 0.764, 0.679, 0.594 | each chartreuse iris (G > 140, R > 110, B < 90) marks an eye; the eye is the convex hull of the dark almond round it (luma < 40 with the iris), grown 6 px over the lid lines |
| pince_nez | monocle | head (explicit) | pulse amp 0.5, 0.25 Hz (a glint) | brass (R - B > 12) between the middle and bottom eyes, rings filled, off the eyes; `matte: "plate"` keeps only the wire |
| beads_1l .. beads_3r | float | abacus | float [4, 0] px (a slide along the rod), 0.16-0.26 Hz, phases 0, 0.37, 0.74, 0.11, 0.48, 0.85 | the beads' whole body (luma > 70, opened 5 px so the rods drop out) inside the frame's verticals; each bead to the row whose middle is nearest its centroid; closed across the rod between; grown 2 px off the other groups; `fill: "extend"` |
| abacus | accessory | torso | - | the brass frame and rods round the beads |
| collar | accessory | torso | - | the stand collar: the frock above the shoulders' line (row 648), in front of the neck |
| jaw | jaw | head | drop 0.014 (14 px), glow #6d8c19 | the lower lip: from the lip line (darkest row between the lips, fitted) down 13 px (to the shadow under the lip), a lens between the mouth's corners |
| head | head | - | - | the figure above row 540 and the grey neck (luma > 40) inside the collar's V, traced 4 px onto the ground |
| torso | torso | - | - | the figure below the shoulders' line, traced 4 px onto the ground |

Rebuild: `node scripts/cast/recipes/the-tallyman.mjs` then `node scripts/cast-forge.mjs the-tallyman`.

## Departures from the brief's parts plan
- **Six eyes blink one at a time.** The brief's "cascade, one per counted viewer" is event-driven;
  the rig has no events. Each eye carries its own periodic blink (new `Motion.blink`, below): every
  4 s the six shut in reading order 0.34 s apart, the census-taker counting. Phases are set so eye 1
  is shut at t = 0 and eye 6 at t = 1.7 s, the sheet's two motion frames. The driver's own blink still
  shuts all six together.
- **mouth_glow became the jaw's `glow`**, dimmed to about 55% of the accent ("faint chartreuse
  light"): at full accent the band was brighter than the irises.
- **abacus_collar became 8 parts:** six sliding bead groups (a row's five beads on each side of the
  middle), the frame, and the frock's stand collar (not in the brief; see "What was hard" 3). The
  beads' slide is a sinusoid, not the discrete flick of a count.
- `frock` became `torso`. The pince-nez's "glint when a count is finished" is a slow pulse.

## What was hard
1. **Every eye blinked together.** `Drive.blink` is one scalar and `poseLayers` squashed every eye
   layer by it. New `Motion.blink { freq, phase? }` on eye layers (rig-core amended, additive): a
   closure of the eye's own, `max`ed with `Drive.blink`. The fill edit drew a closed lid where each
   eye was, so a squashed eye reads as a shut lid.
2. **Beads measured by their lit half.** A bone threshold (luma > 112) took only the upper half of
   each bead; the shaded lower half is the rods' own colour (88, 81, 64) and stayed on the frame,
   so a slide split every bead in two with dark arcs. The beads are now the whole body (luma > 70)
   opened wider than a rod is thick; rows curve, so each bead goes to its nearest row by centroid.
3. **The neck slid over the collar.** In 3D the stand collar is in front of the neck; as a seam the
   turned head's neck covered the collar's corner. The collar is a front part on the torso, the
   torso starts under it (so its parallax backing no longer pushes a strip of neck up beside the
   collar), and the head takes only the grey neck below row 540 (the collar's top rim was riding the
   head as a dark fleck).
4. **Eye outlines.** The dark almond at a looser threshold ran into the shadow facets beside it, and
   the edit difference was ragged (the edit re-rendered the facets round each eye): the hull of the
   almond's core is clean. Grown 3 px, the feathered edge blended the iris's bottom into the head's
   plate, a chartreuse fleck under a shut eye; grown 6 px it is gone.

## Still wrong (honest state)
- A dark gap of a few px opens between the collar's inner edge and the neck on the trailing side of
  a turn (the painted-out ground behind the neck); it reads as the collar's inside.
- Faint smudges at the ends of a sliding bead group (the extension fill), visible at 2x zoom.
- Faint jagged ground halo beside the turned head, visible only at 4x brightness.
- The blink cascade is periodic; it does not count real viewers (an engine event, not a rig field).
- Blink from the driver and reduced motion are not drawn on the review sheet.

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["six round eyes with their
glowing chartreuse irises", "small brass pince-nez on the nose", "thin lower lip", "bone abacus beads
on the collar rods"])` (mean difference 5.4/255 after the area resize), JPEG q92. It drew closed
lids where the eyes were (used as is), redrew the abacus with four bare rods instead of three (the
beads take `fill: "extend"`), and kept the lips. The rest pose matches the portrait (p99 0/255).
