# Sir Vacant: decomposition notes (cast-forge task 7)

Style: naive heraldic miniature (contest supporting-cast B/10 style-2). Portrait 1024 px (from a
1254 px render), `brief.json` as staged. Flat pewter, rust and cream fills inside brown-black ink
outlines (luma 0-15, as dark as the ground), star-white light in the visor slits and in the gap
between visor and bevor. The ink lines are the cut lines; the cut is near hard (`cut.feather` 1).

## Parts (parts.json, PartsV2, 12 parts -> 13 rig layers with the background)

| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| slit_r, slit_l | eye_r, eye_l | head | pulse amp 0.3, 0.3 Hz, phase 0.25 (a slow flare, in step) | the white light in each slit (luma > 180), grown 2 px onto the slit's ink frame; `fill: "extend"` (the shut slit is dark ink) |
| tag_1..3 | float | chain | float rot 4 deg, 0.42 / 0.5 / 0.46 Hz, phases 0 / 0.6 / 0.66 (pendulums) | the cream paper (seal filled in) and the short link it hangs by (rust or ink 30 px above the paper), grown over its ink; `pivot` the link's top; `key: false` |
| chain | accessory | torso | - | the rust round the middle link (end rings included), off the tags, grown over its ink |
| pauldron_r, pauldron_l | accessory | torso | float [0, 1.5] px, 0.2 Hz, in phase (the breath) | pewter (luma > 70) or rust in each shoulder box with its spikes, off the chain, grown over its ink and onto the ground |
| plume | hair | head (explicit) | float rot 3 deg, 0.3 Hz | the figure above the crest band (row 264), traced onto the ground; `pivot` the middle of its foot; `key: false` |
| bevor | jaw | head | drop 0.02 (20 px), `cavity: "gap"`, `glow` #f2f6ff | from the visor's lower edge (the first row of the white gap, or the dark gap's top past the ink) down to the bevor plate's own lower ink edge (the light region round (470, 585), breathing slits filled), 8 px off the hinge bosses; `fill: "extend"` |
| head | head | - | - | the helm (the figure above row 600 between x 360 and 665) minus plume and bevor, plus the hinge bosses, traced onto the ground |
| torso | torso | - | - | the rest of the figure (gorget, surcoat), traced onto the ground |

Rebuild: `node scripts/cast/recipes/sir-vacant.mjs` then `node scripts/cast-forge.mjs sir-vacant`.

## What is his face
- **Jaw: the bevor.** He has no mouth; the hinged lower plate is the jaw, its top edge the visor's
  lower edge, so the drawn gap (light in the middle, dark at its pointed ends) rides on the jaw. When it
  drops, the opening is that gap carried up in each column's own colour: the light widens (the
  brief's "visor opens wider", "inner light brightens as the jaw opens"), the dark ends stay dark.
  This needed code (below). A dark lens with a glow strip was the other choice; under a gap drawn
  full of light it would have read as a second, dark mouth.
- **Eyes: the light in the slits.** The ink frame stays on the visor; the light is the eye layer
  and the slit behind it is filled from its own ink. A blink squashes the light to a thin line in a
  dark slit (checked on `var/cast-forge/sir-vacant-blink.png`); the pulse dims and flares it.

## Departures from the brief's parts plan
- `inner_light` is not a part: it is the bevor's lit gap (one light, carried up when it opens).
- `vow_tags` became three tags, each swinging on its own link; the chain is its own static part.
- `surcoat` became `torso`. "Trails behind every head turn" (plume inertia) and "one tag lifts when a
  goal is met" are not built: the rig has no inertia and no events (the Tallyman's format finding).

## What was hard
1. **The lit gap went dark.** `cavity: "gap"` took a column's colour only when dark (Reveille's
   gap): Sir Vacant's white gap fell back to the bevor's tones, grey bars over the light. With `glow`,
   a sample near the accent is now carried up too (`GAP_LIT_NEAR`).
2. **A line of ground beside the turned helm.** The bevor is the helm's foot and borders the gorget;
   the head carries its lifted region, but the torso's backing reached only under the head's own
   polygon, so the torso stopped short and a turn showed ground along the bevor's edge. The backing
   now reaches under what the head carries.
3. **The hinge bosses were on no part.** With the bevor taken out they stood apart from the visor;
   `keepBig` dropped them from the head and the torso, so they stayed on the background and a turn
   left a pewter ghost. The head takes them explicitly; the bevor keeps 8 px off them (its lifted
   region grows sideways and smeared the head's copy of the boss).
4. **The shut slit filled with pewter.** Grown 4 px (ledger 4e), the extension fill's hole reached
   past the 6 px ink frame and blurred the visor's pewter into the slit. Grown 2 px it stays dark.
5. **A swing that did not count.** The tags only rotate; the cast golden counted only translation and
   tint as motion. Rotation counts now.

## Still wrong (honest state)
- The widened light is carried column by column: faint vertical streaks, and its ends are square
  where the drawn light ends in points (the dark ends stay dark beside it).
- At full drop the bevor's top corners beside the bosses show a few px of dark interior.
- The pulse on near-white slits shows only as a dimming; brightening is clipped.
- Reduced motion is not drawn on the review sheet; the driver's blink is its own PNG, not a panel.

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["tall black horsehair plume on
top of the helm", "two spiked shoulder pauldrons", "rusted iron chain across the chest", "three
wax-sealed paper tags hanging from it"])` (mean difference 12.0/255 after the area resize, the
whole-image re-render), JPEG q92. It kept the crest band and painted the surcoat's shoulders under
the pauldrons. The slits and the bevor are filled by extension. The rest pose matches the portrait
(p99 0/255).
