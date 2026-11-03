# Vicar of the Lure: decomposition notes (cast-forge task 4)

Style: leaded stained glass (contest supporting-cast A/2 style-2). Portrait 1024 px (from a 1254 px
render), `brief.json` as staged. Every pane is ringed by a black lead line (luma about 5 on a ground
of 1-2): the lead lines are the cut lines, and the default 3 px feather hides in them.

## Parts (parts.json, PartsV2, 7 parts -> 8 rig layers with the background)

| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| lure_bulb | pulse | lure_stalk | pulse amp 0.55, 0.4 Hz; float rot 5 deg, 0.31 Hz (a swing) | magenta glass in its box, its halo on the ground, convex hull; the stalk's glass taken out |
| eye_r, eye_l | eye_r, eye_l | head | - | the milky disc (luma > 150) with its lead ring, grown 5 px |
| lure_stalk | accessory | head (explicit, so it keeps the head's depth) | float rot 4 deg, 0.17 Hz (a sway) | the figure above the dome's top lead line (row 253), the bulb and its halo taken out, grown back over its own halo-tinted rim |
| jaw | jaw | head | drop 0.035 (36 px), `cavity: "fill"` | below a corridor line between the rows of teeth (below), the chin's bowl of grey panes down to the collar; the blue cheek panes stay on the head |
| head | head | - | - | the figure minus the torso and the lure |
| torso | torso | - | - | dark blue vestment panes below row 720 and everything below the collar's top (row 772), closed across the lead |

The stalk pivots on its foot on the brow and the bulb on the stalk's tip (`pivotOf`); the bulb is
carried by the stalk's sway (a float is now carried down the follow chain) and swings on its own.

Rebuild: `node scripts/cast/recipes/vicar-of-the-lure.mjs` then `node scripts/cast-forge.mjs vicar-of-the-lure`.

## Departures from the brief's parts plan
- **maw_glow is not a part.** The throat is drawn lit; when the jaw drops it uncovers the fill edit's
  painted throat (magenta glass), so the glow is "revealed as the jaw opens", not brightened. A
  painted cavity with a `glow` band was tried first and read as a zigzag (below).
- **The upper teeth stay on the head, the lower teeth go with the jaw**, as drawn: the upper row
  hangs from the snout, the lower row rises from the lower lip band.
- **The collar is torso**, not head; the barnacles stay on the vestment (no motion planned for them).
- `vestment` became `torso`; `kind` fields became roles. The brief's "slow underwater breathing" and
  the lure's "brighter in chat silence" are not built (no breathing motion or chat-driven gain in the rig).

## What was hard
1. **The lure as a chain.** A float was not inherited by followers, so a bulb following a swaying
   stalk stayed put and the stalk turned about its middle (its foot slid on the dome). Now a float is
   carried rigidly down the follow chain (`poseLayers`, rig-core amended) and an attached part pivots
   where it meets its target (`pivotOf` in `assembleRig`). The review compositor did not draw rotation
   at all, so the sway was invisible on the sheet; it draws rotation and scale now.
2. **The maw.** Upper and lower teeth interleave: upper tips reach row 555, lower tips rise to 540.
   No smooth line separates them, and the lower row (17 teeth) cannot be traced in 60 points. The
   recipe classifies tooth fragments (wider at the foot = lower), then runs a fewest-point corridor
   line (19 points) below every upper tooth and above every lower tooth, hugging the lower teeth's
   skyline; the throat between the lower teeth goes with the jaw.
3. **The cavity.** `paintCavity` hangs its lens from the jaw's top edge per column; on the corridor
   line that drew a black and magenta zigzag. The mouth is already drawn open, so the jaw takes
   `cavity: "fill"` and uncovers the edit's throat.
4. **Fragments.** The bulb's halo tints the stalk's rim near the tip; cut off by a halo test it stayed
   on the ground as a fleck, and the bulb's hull took a sliver of the stalk's tip and swung it away.
   Both fixed in the recipe (stalk grown back over its rim, stalk glass taken out of the bulb).

## Still wrong (honest state)
- Open jaw: a faint broken lead line along the corridor line in the middle of the throat, where the
  portrait's throat (above the line) meets the edit's throat (below it); the edit's panes do not
  continue the portrait's.
- Open jaw: the dropped chin covers the middle of the white collar (the jaw is in front of the torso);
  the collar's ends stay visible. Drop reduced from 0.04 to 0.035 for this.
- One or two dark pixels next to the stalk's tip at some swing phases.
- Blink and the reduced-motion view are not drawn on the review sheet (blink is 0 in every panel).

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["glowing magenta lure bulb",
"thin bony lure stalk", "two round milky eyes", "lower jaw, its lower teeth and the chin below them"])`
(mean difference 11.6/255 after the area resize), JPEG q92 by `scripts/cast/import-fill.mjs`. The edit
painted the whole lower face as lit magenta throat panes and the eyes as scales; it also re-drew the
upper teeth shorter, which never reaches the plate (only lifted regions do).
