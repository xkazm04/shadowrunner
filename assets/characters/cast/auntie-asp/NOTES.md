# Auntie Asp, Keeper of the Stone Stacks: decomposition notes (cast-forge task 9)

Style: art nouveau poster (contest supporting-cast A/9 style-2). Portrait 1024 px (from a 1254 px
render), `brief.json` as staged. Flat stone-grey skin and serpents with fine crack and scale ink, a
charcoal cardigan, a pale ribbed blouse with a ruffled stand collar; the molten orange accent only in
her eyes and the serpents' eyes. The ink lines are the cut lines; the cut is near hard (`cut.feather` 1).

## Parts (parts.json, PartsV2, 15 parts -> 16 rig layers with the background)

| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| eye_r, eye_l | eye_r, eye_l | head | pulse amp 0.25, 0.4 Hz, in step | the orange iris (R - B > 100) closed, grown 4 px, off the spectacles' ring wire, every orange pixel kept; `fill: "extend"` |
| spectacles | monocle | head (explicit) | - | two circles fitted to the wire (120/120 samples dark), filled, with the bridge and arms (the wire's components in their zones, up to the ears), traced 3 px out over the skin; `key: false` |
| serpent_r3, l3, r2, l2, r1, l1 | hair | head (explicit) | float rot 4-5 deg about the root, 0.26-0.45 Hz, six frequencies and phases | the six components of the figure above the brow outside the fill's bald dome, each root reaching 4 px into the dome, traced 8 px onto the ground; `pivot` the middle of the root on the dome's edge |
| collar | accessory | torso | - | the frill and the ribbed stand between the neck's columns: from the frill's top ink (the widest ink component under the chin, its highest row per column) to the stand's lower ink line (fitted), traced 3 px out over the neck |
| collar_back_r, collar_back_l | accessory | torso | - | the back band's two sides beside the neck, with the ink between them and the neck; `fill: "extend"`, keyed |
| jaw | jaw | head | drop 0.014 (14 px) | the lower lip: 2 rows under the seam's darkest row (fitted) to the last row of the lip's grey, only where the lip has 5 rows of body |
| head | head | - | - | the fill's bald dome, the face and ears, the neck down to the frill, reaching 16 px under the collar but never within 14 px of its lit outer edges |
| torso | torso | - | - | the rest of the figure |

Rebuild: `node scripts/cast/recipes/auntie-asp.mjs` then `node scripts/cast-forge.mjs auntie-asp`.
The recipe prints, per part, the pixels its outline misses (rim aside, and of what it must carry:
a serpent's body and tongue, an eye's orange, the wire), and the figure pixels in no outline: all 0
for the serpents, eyes, spectacles and the collar's front; 0 figure pixels in no outline.

## The signature: six serpents
- **The cut between head and serpents is the fill's bald dome.** The serpents grow out of the scalp
  with no ink at the root. The fill edit painted a bald, cracked dome; the serpents are the figure
  outside it, six clean components. Each root reaches 4 px inside the dome (the chords of a 60-point
  outline along a curve otherwise left a 1 px sliver of the root on the head), and the root's stub
  inside the dome stays on the head as drawn scalp.
- **Each sways on its own root.** Rotation only (`rot_deg` 4-5, no translation), pivot the middle of
  the root, so the root stays on the scalp and the head moves 25-35 px. Six frequencies
  (0.26-0.45 Hz) and phases, so no two move together; the sheet's diff panel shows all six.
- **Order**: the lower tiers are listed first, so they are in front where a sway crosses a
  neighbour (nearer the face). In the drawing no serpent overlaps another; the recipe checks
  that no outline takes another serpent's pixels.
- **The 60-point cap held.** Traced 8 px onto the ground, every serpent (about 1,000 px of outline,
  a 3 px forked tongue) fits 53-56 points with no pixel of body or tongue missed. No format change.
- **What is behind them.** On the ground, the plate is ground. Between the roots the fill's dome
  is wider than the scalp the drawing shows: the black wedges between roots were bald scalp in the
  plate, and a swaying serpent uncovered specks of it. Fixed in code (below).

## Departures from the brief's parts plan
- `cardigan` is the torso; the ruffled collar is its own part (in three pieces, below) so a turned
  neck goes behind it (ledger 4e/4g). The chain stays on the torso: it hangs between two buttons,
  so a swing would detach its ends.
- Not built: "they turn toward whoever speaks", "glare flares on timeouts", "shushes" (as a gesture),
  "glint" are gaze and events; the rig carries periodic motion only (the Tallyman's format finding).
  The eyes pulse slowly in step instead. A pulse on the spectacles would light the skin in the lenses.

## What was hard
1. **Specks of scalp between the roots.** See above. Became code: `plateNamed` keeps the portrait's
   open ground under keyed lifted parts and in the ring the plate blends around every lifted part.
2. **The collar.** One outline of the frill's waves cut its top ink, which would ride the neck on a
   turn: the frill's top is measured as the top of its ink and traced 3 px over the neck. The edit
   drew a clean neck and round neckline under the front (used), but ground under the back band's
   sides, so a turned neck pulled a black bar out from under the band. The back band is its own two
   pieces with `fill: "extend"`, keyed (so the ground they are traced over stays ground). The neck's
   reach under the collar stops 14 px inside the band's lit edge row by row, else at full yaw
   it hung out over the ground as a grey haze.
3. **The spectacles sit on the eyes.** The rings' top arc crosses the upper lids: the eyes are cut
   off the ring wire, and the spectacles are the filled rings (skin inside moves with the head, so
   it is invisible), traced over skin so no wire is left on the face when they are hidden.
4. **The lips.** The darkest row is the seam's ink; dropped with the jaw it drew a line across the
   lower lip and two dashes under the corners. The jaw starts 2 rows under it and only where the lip
   has body; the corner wedges stay on the head.

## Still wrong (honest state)
- At full yaw a stub of the neck's edge (about 3 x 13 px) stays beside the neck just above each
  back band: the torso's parallax backing reaches 13 px up into the neck and copies the portrait
  there. Same class as Lot Ninety's faint line; a fix would paint the backing from the torso's own
  surface, which changes every rig's torso (ledger format finding).
- A turned neck slides over band-grey extension at the sides (slightly blurred).
- The open mouth shows a thin light band (the fill's lips) between the cavity and the dropped lip.
- The review compositor samples rotation nearest-neighbour: swaying serpents' edges look stepped.
- The blink shuts the orange to a glowing slit over a dark, extension-filled lid (the edit drew
  open grey eyes, unusable for a shut lid).

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["six grey serpents rising from
her head", "two glowing orange eyes", "round wire spectacles", "lower lip", "high ruffled blouse
collar"])` (mean difference 11.6/255 after the area resize). It painted a bald cracked dome, open grey
eyes, the neck continuing to a round neckline, and kept the lips. The eyes and the back band are
filled by extension. Rest matches the portrait (mean 0.00/255, max 3).
