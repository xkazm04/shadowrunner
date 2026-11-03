# Lot Ninety, the Auctioneer: decomposition notes (cast-forge task 8)

Style: art nouveau poster (contest supporting-cast A/4 style-1). Portrait 1024 px (from a 1254 px
render), `brief.json` as staged. Flat grey-green skin, ivory gloves and wing collar, a charcoal
pinstripe suit, inside black ink outlines as dark as the ground (luma 3-4); the emerald accent
(G - R > 60) only in the irises and the cuff flames. The ink lines are the cut lines; the cut is
near hard (`cut.feather` 1).

## Parts (parts.json, PartsV2, 13 parts -> 14 rig layers with the background)

| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| wisp_r, wisp_l | float | hand_r, hand_l | float rot 7 deg, 0.9 / 0.82 Hz (a lick about its root); pulse amp 0.45, 1.3 / 1.1 Hz (a flicker) | the emerald under each cuff, grown 5 px over its halo; `pivot` the top middle where it leaves the cuff; `fill: "extend"`; a float role so it is cut in front of its glove |
| hand_r, hand_l | float | head (default) | float [2, 7] px, 0.42 Hz, rot 5 deg, phases 0 / 0.5 (one bidder, then the other) | the glove's blob (cuff hollow filled), off the flame, closed across the rim the flame splits, traced 8 px onto the ground; `pivot` the middle of the glove's narrowest row above the cuff (the wrist); `fill: "extend"` (ground behind) |
| eye_r, eye_l | eye_r, eye_l | head | pulse amp 0.3, 0.5 Hz, in step; eye_l an own blink at 0.12 Hz (the wink), shut at t = 1.7 s | convex hull of the iris and the lid ink round it, grown 4 px |
| bowtie | accessory | torso | float rot 3 deg, 1.1 Hz about the knot | the black round the knot, the collar band opened away (7 px), over its ink; `pivot` the knot |
| collar_r, collar_l | accessory | torso | - | each ivory wing (luma >= 182) with all the ink between it and the neck; `fill: "extend"` |
| hair | hair | head (explicit) | - | the head's silhouette above row 400 that is neither the face nor an ear (each over its ink), parting included; `key: false` |
| jaw | jaw | head | drop 0.024 (25 px), `glow` #14824a | the lower teeth and lower lip: from the seam between the rows of teeth (darkest row per column, fitted) to the last row of the lower lip's dark, column by column |
| head | head | - | - | the figure above row 500 (the hair's dome closed 12 px), the face to the chin, the neck inside the collar's V grown 16 px under the wings; the collar's tips aside |
| torso | torso | - | - | the rest of the bust |

Rebuild: `node scripts/cast/recipes/lot-ninety.mjs` then `node scripts/cast-forge.mjs lot-ninety`.

## The signature: two disembodied gloves
- Each glove is a float that bobs and turns about its wrist (`pivot`), the two half a cycle apart.
  Its flame is a follower: carried rigidly with the glove (task 4), plus its own lick about its root
  and its own flicker, so it never looks glued on.
- The gloves float in the ground, so the plate behind them is just ground (`fill: "extend"`). The
  first build found the head carrying both gloves' holes (a float follows the head by default, and
  the carrier is the plate part at the root of its chain): the head layer was 978 px wide, holding
  two patches of painted ground that moved with every turn. Now a part floating on the ground is
  carried by nobody (below); the head layer is 446 px wide. At 6x gain no glove halo or ghost remains.
- They follow the head (the default), not the torso: a turn moves them at their own accessory depth
  (in front of the bust), and the head's gestures carry them like a showman's attention.

## Departures from the brief's parts plan
- `mouth_glow` is not a part: the jaw's cavity carries the emerald (`glow`), dimmed to about 58% so
  the irises and flames stay brightest. `suit` became `torso`; the wing collar is two parts (one
  outline per part, and the neck goes between them). `hair` is its own part (it separates cleanly at
  the hairline; the fill edit painted a bald scalp under it).
- Not built: "glances toward bidders", "points, 'sold' slam", "twitches on emphasis" are events or
  gaze; the rig has periodic motion only (the Tallyman's format finding). The bow tie twitches on a
  sinusoid instead; the wink is periodic.

## What was hard
1. **The gloves stretched the head.** See above; became code (`cutNamed`, parts on the ground).
2. **The neck behind a wing collar.** Cut along the wings, a turned neck either slid over a wing or
   left a static copy of its edge. The neck reaches 16 px under each wing; the edit drew a plain
   shirt collar there, whose lines showed as a second edge, so the wings take `fill: "extend"` and
   all the ink between them and the neck: what a turned neck uncovers is skin-toned extension.
3. **The jaw's ends.** A jaw between fixed columns chopped the lower lip's tails; the jaw is now the
   lower lip's own dark, column by column, under the fitted seam.
4. **The hair's top is ink.** Solid black on the ground cut notches into the head's outline; the
   head's silhouette is the figure closed 12 px above row 300.
5. **The flame splits the cuff's rim**, so the glove came out in two pieces and its outline missed
   1,000 px of cuff (left on the background); the glove is closed across the rim, the wisp cut first.

## Still wrong (honest state)
- On a turn, the extension under the wings is a little lighter than the neck, and a thin dark line
  remains where the neck's antialiased edge was; a 10 x 17 px piece of the collar's back band shows
  beside the neck at full yaw.
- The dropped lower lip's ends stop short of the mouth's corners (the corner wedges stay on the head).
- The review compositor samples rotation nearest-neighbour: the turning gloves' ink lines look
  stepped on the sheet (the app's GL renderer filters).
- At 3x gain, a slightly darker band hugs the head's traced outline on a turn (0 against the ground's 4).

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["slicked-back black hair",
"two glowing green eyes", "grinning lower teeth and lower lip", "small black bow tie", "high white
wing collar", "two floating white gloves and their green ghost flames"])` (mean difference
23.6/255 after the area resize: the whole-image re-render). It painted a bald scalp, closed lids
(used for the blink and wink), a smaller closed-lip grin and a plain shirt collar. Gloves, flames and
the wing collar are filled by extension; the rest pose matches the portrait (mean 0.28/255, no pixel
over 60).
