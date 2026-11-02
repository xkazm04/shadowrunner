# Saint Cardia of the Glass Heart: decomposition notes (cast-forge task 2.3)

Style: faceted gothic painting (contest supporting-cast A/6 style-3). Portrait 1024 px, `brief.json` as staged.

## Parts (parts.json, PartsV2, 13 parts -> 14 rig layers with the background)
| part | role | follow | motion | how it was measured |
|---|---|---|---|---|
| spire_1 .. spire_5 | float | crown | float amp [1, 3] px, 0.25-0.37 Hz, rot 1.5 deg, phases by name | edit difference, each finial above the knot where its tracery joins |
| heart | pulse | cage | pulse amp 0.6, 1.1 Hz (a slow heartbeat) | saturated red inside the cage, closed and hole-filled |
| eye_r, eye_l | eye_r, eye_l | head | - | edit difference in each eye box, opened, convex hull, +2 px |
| cage | accessory | torso | - | edit difference on the chest |
| crown | crown | head | - | edit difference over the crown box, band region opened (see below) |
| jaw | jaw | head | drop 0.016 (16 px) | task 3, lips only: the lower lip, from the lip line (a quadratic through the darkest rows between the lips) down through the lip's red (R - B > 18) |
| head | head | - | - | figure above the hood hem, crown taken out, traced 4 px onto the ground |
| torso | torso | - | - | figure below the hem, 8 px under the head, traced 4 px onto the ground |

Rebuild: `node scripts/cast/recipes/saint-cardia.mjs` (parts.json and the overlay) then
`node scripts/cast-forge.mjs saint-cardia` (replay job and the review sheet).

## Departures from the brief's parts plan
- **crown split into crown + five floating spire finials.** The brief has one crown that "catches
  light, slight sway"; the finials are what can float without tearing the tracery, so they bob a
  few px on their own (Malakor's shards, smaller). The rest of the crown follows the head.
- **heart split into heart (pulse) + cage (accessory).** The cage is silver and static; only the
  glass heart pulses. Both hang on the torso (`follow`), not the head: a heart on the chest that
  followed the head would slide across the robe whenever she turns.
- `robe` became `torso` (role torso); `kind` fields of the brief became roles.

## What was hard
1. **Head/torso seam.** A horizontal cut at the collar put a parallax step across the hood's outer
   edge (head depth 0.6 vs torso 0.3: 8 px at 15 deg yaw). The cut now follows the hood's hem to the
   concave corner where the drape meets the shoulder; the step sits in that corner.
2. **Rim-light ghost.** The 60-point head outline cut inside the silhouette, so the hood's bright
   rim stayed on the static background and showed as a line beside the turned head. Parts on the
   ground are now traced 4 px out onto it (`ontoGround`), and the recipe prints any part pixels an
   outline misses (`uncovered`).
3. **Edit misalignment.** The fill edit re-renders the whole image (mean diff 8.9/255) and moves
   the hood's fold lines by a px or two, which the crown's difference mask picked up as thin lines.
   An opening (r = 2) below the crown band drops them; the spires' thin needles are above it.
4. **Chin.** The chin edge on faceted shading is noisy; a robust quadratic fit gives a clean line.

## Still wrong (honest state)
- ~~Open jaw reads as a soft dark smudge~~ (fixed in task 3): the jaw is now the lower lip only,
  dropping 16 px, and the forge paints a hard-edged lens of dark lip-coloured tones under it
  (`paintCavity`). The lens's corners show a little of the fill plate (skin) between the lips.
- The shoulder-corner seam (task 3): the double edge on the trailing shoulder (the plate's static
  copy of the robe's outline) is gone, the background is painted under the torso now; the dark line
  along the hood's hem is covered by the torso reaching `parallaxBacking` px under the head. A small
  notch remains at each hood tip at 15 deg yaw, inherent in two rigid layers at different depths.
- Floating finials show a 1-3 px dark gap above the crown at the top of their bob (intended as
  levitation; may read as detached).
- The review compositor draws no rotation (spires' 1.5 deg sway) and no blink; blink was not
  reviewed. The fill painted the eyes out, so a shut eye shows smooth lid, not a second eye.

## Fill
`fill.jpg`: Codex CLI image edit of `portrait.png` with `fillPrompt(["crown and its spires", "the
glass heart and its silver reliquary cage on the chest", "the eyes", "the lower lip and chin"])`,
1254 px, area-resized to 1024 and stored as JPEG q92 by `scripts/cast/import-fill.mjs` (122 KB).
Only the lifted regions (+12 px, feathered) reach the plate (`composePlate`).
