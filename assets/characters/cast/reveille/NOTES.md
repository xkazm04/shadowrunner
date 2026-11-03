# Reveille, the Alarm of the Ninth: decomposition notes (cast-forge task 5)

Style: smoked brass and neon (contest supporting-cast A/10 style-3). Portrait 1024 px (from a 1254 px
render), `brief.json` as staged. Dim brass tubes with a warm halo on a ground of luma 0, a cream dial,
and cyan neon (blue well above red) that tints the dial around it. The brass edges and the neon's
colour are the cut lines.

## Parts (parts.json, PartsV2, 13 parts -> 14 rig layers with the background)

| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| crack | pulse | head | pulse amp 0.6, 2 Hz (a flicker) | blue - red > 5 between the eyes, pieces of 30 px or more bridged in a 3 px run, grown 4; `matte: "plate"`, `fill: "extend"` |
| eye_r, eye_l | eye_r, eye_l | head | pulse amp 0.45, 0.5 Hz, phase 0 | the neon disc (ring, halo, dark socket), grown 3, the hands over its rim taken out; matte, extend |
| bell_r, bell_l | accessory | head (explicit) | float [1.5, 1] px, 2 / 1.9 Hz, rot 3.5 deg, phases 0 / 0.37 | the figure above row 250 outside the case circle (fitted to the ring's outer edge), each side; pivot at the stem's foot (`pivotOf`) |
| hammer | accessory | head (explicit) | float [2, 0] px, 2 Hz, rot 2 deg, phase 0.6 | the figure above the case's top bracket (row 152) |
| brow_r, brow_l | accessory | head (explicit) | float rot 6 deg, 0.12 Hz, phases 0 / 0.5 (mirrored) | the dark hand (luma < 50) beside each eye off the socket, hub filled, grown 6 over its lit rim; `pivot` the hub; matte, extend |
| key | accessory | torso | float rot 6 deg, 0.2 Hz | brass (R > 30, R - B > 25) on the chest; `pivot` the boss in the bow's middle; matte, extend |
| teeth | jaw | head | drop 0.03, pulse with the eyes | the bright cyan zigzag (B - R > 60) as a band from its tips' envelope to its feet; `cavity: "fill"` (it uncovers the jaw) |
| jaw | jaw | head | drop 0.03 (31 px), `cavity: "gap"` | the figure and the dark gap under the upper rim (the gap's first near-black row, fitted), down to the neck; its sides start at the jaw frame's loops; `fill: "extend"` |
| head | head | - | - | the figure minus the bells, hammer, jaw and torso, traced 9 px onto the ground (the brass halo) |
| torso | torso | - | - | the figure below the jaw's bottom rim (row 751), traced 9 px onto the ground |

Rebuild: `node scripts/cast/recipes/reveille.mjs` then `node scripts/cast-forge.mjs reveille`.

## Departures from the brief's parts plan
- **dial_glow is not a part.** The gap is drawn lit; the open jaw uncovers that gap carried up
  (`cavity: "gap"`). **brow_hands** became two parts, each turning on its own hub.
- **teeth** are their own layer (a second jaw role with the jaw's drop) so they pulse with the eyes
  without lighting the brass and the lower dial; the neon is one circuit (eyes and teeth in phase).
- **crack** (the brief's "cracked tube") is a pulse part; the brief named it only in the style prompt.
- `bell_*` are accessories with an explicit follow, not crowns: they pivot on their stem's foot.
- `body` became `torso`; the key is its own part. The head's "jittery tilts, shakes when ringing" are
  not built (no event-driven motion in the rig).

## What was hard
1. **Neon on a lit dial.** An opaque eye polygon carries a disc of dial with it; a pulse brightened
   the whole disc and a turning clock hand slid a cream lozenge over the dial. New `matte: "plate"`
   (`matte.ts`): the part keeps only what differs from the plate behind it, colour un-mixed so the
   rest pose is the portrait again (p99 difference 8/255, nothing above 40).
2. **Clock hands turn on their hubs.** Lying wholly on the head they took their centroid; new
   `NamedPart.pivot` names the hub (and the key's boss).
3. **The fill edit drifted twice.** Both Codex edits redrew the case as a whole round clock (a full
   dial where the jaw was, mean difference 14.6/255) and the dial 30-60 levels brighter than the
   portrait's. Every dial part takes `fill: "extend"`; the edit reaches only the bells' and the
   hammer's ground.
4. **No throat to uncover.** The default lens is sized on the whole jaw frame and showed the edit's
   cream dial at its corners; a cyan glow band read as a stripe. New `cavity: "gap"`: the drawn dark
   gap carried up, full drop in every column, sampled two rows under the lip.
5. **Ghosts.** The hands' lit rim stayed on the dial when they turned (grown over the rim); the eye
   discs, cut first, kept a piece of each hand (the hands are now taken out of them); the bracket's
   brass halo stayed on the ground beside the turned head (plate parts traced 9 px onto the ground).

## Still wrong (honest state)
- **The rattle is a 2 Hz wobble.** Float is one sinusoid capped at 2 Hz (design.md Motion); a bell's
  rattle is 10-20 Hz. The bells shake out of step, which reads as agitation, not as ringing. This is a
  format finding, left for the owner: a higher cap or an event gesture ("ring"), not widened here.
- Faint polygon facets in the brass halo beside the turned head, visible only at 3x brightness.
- The crack's flicker lifts its halo blots to near white at the peak.
- The open gap shows faint vertical texture (each column carries its own sampled colour).
- Blink and reduced motion are not drawn on the review sheet.

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["two brass bells on top and their
stems", "small T-shaped striker handle between the bells", "two black clock-hand eyebrows", "two
glowing cyan ring eyes", "cracked cyan neon line on the dial", "lower jaw, its cyan neon teeth and the
lower dial below them", "brass winding key on the chest"])` (mean difference 14.6/255 after the area
resize), JPEG q92 by `scripts/cast/import-fill.mjs`. A second edit naming "the dark empty hollow inside
the clock case" drew the same whole clock and was not used.
