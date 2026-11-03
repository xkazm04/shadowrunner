# cast-forge ledger

One section per decomposed character (cast-forge requirement 3.4): what broke, what became code in
`packages/forge` (with a test proven red once), and what became a rule for the decomposition prompt
(`partsPromptFromBrief`, task 11). The next character starts from this.

## Tooling (task 2)
- Named parts (`PartsV2`) parse, cut (`cutNamed`), fill (`liftedNamed` + `composePlate`) and
  assemble (`assembleRig`) in `packages/forge`; the offline build is `node scripts/cast-forge.mjs
  <slug>`; measurement helpers are `scripts/cast/measure.mjs`, the labelled overlay
  `scripts/cast/overlay.mjs`, fill import `scripts/cast/import-fill.mjs`, one recipe per character
  under `scripts/cast/recipes/`.
- Procedure for the next character:
  1. `mkdir -p var/cast-forge/<slug>-fill && cp assets/characters/cast/<slug>/portrait.png var/cast-forge/<slug>-fill/`
  2. write `req.txt` there from `scripts/cast/fill-request.txt`, `<FILL_PROMPT>` replaced by
     `fillPrompt(<lifted part phrases>)` verbatim, then
     `cd var/cast-forge/<slug>-fill && codex exec --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox -i portrait.png -C . - < req.txt` (about 50 s)
  3. `node scripts/cast/import-fill.mjs <slug> var/cast-forge/<slug>-fill/fill.png` (prints the
     mean difference: about 9/255 is the re-render; much more means drift)
  4. copy `scripts/cast/recipes/saint-cardia.mjs` to `<slug>.mjs`, measure, run it, open
     `var/cast-forge/<slug>-parts.png`
  5. `node scripts/cast-forge.mjs <slug>`, open `var/cast-forge/<slug>.png` and the per-pose PNGs
     `var/cast-forge/<slug>-{rest,jaw,left,right,t0,t1}.png` at full size; iterate.
  4b. (task 3) give the jaw part a `drop` (a lips-only human jaw about 0.012-0.02; omit for a skull) and a `glow` if the mouth glows; for hard-edged pixel art set `cut: { feather: 0, cell: <px> }` and trace ground-meeting parts at least one cell out; mark small parts on a flat field `fill: "extend"`.
  4c. (task 4) a mouth drawn open (rows of teeth over a throat) takes `cavity: "fill"` and a jaw top between the rows of teeth (`corridor` in `recipes/vicar-of-the-lure.mjs`); hanging chains get explicit follows (stalk follows head, bulb follows stalk); the sheet draws rotation, so check sways at t0/t1.
  4d. (task 5) a glowing or dark part on a lit surface (neon on a dial, a clock hand) takes `matte: "plate"` and, when the edit drifts in tone, `fill: "extend"`; a part that turns on a hub names `pivot`; a mouth drawn open over a dark gap with a smooth upper lip takes `cavity: "gap"` when the edit will not paint a throat; plate parts on a glowing ground are traced onto it by the halo's width.
  4e. (task 6) many eyes that blink one at a time take an own `motion.blink` each (one freq,
     staggered phases); a lit 3D object (a bead, a button) is measured by its whole body, shaded half
     included, never by its highlight; a collar or ruff that wraps the neck is a front part on the
     torso, and the torso starts under it.
  4f. (task 7) a mouth drawn open over light (a helm's inner light) takes `cavity: "gap"` with the
     light as `glow`, the jaw's top on the upper edge of the light; a glow inside an ink frame (a visor
     slit) grows onto the frame by less than the ink's width minus 3 px (the extension fill's reach), so
     the shut eye is dark ink; after taking a jaw out, check that every piece of the head beside it
     (hinges, bosses, ears) is still on the head; open `var/cast-forge/<slug>-blink.png`.
  4g. (task 8) a part floating free on the ground (a glove, a charm) is a float with `fill: "extend"`,
     traced 8 px onto the ground so the outline's chords cut no tip off; its glow is a follower
     listed before it (a float role, so it is in front), pivoted on its root; check `uncovered` is 0
     for every part, a polygon is ONE outline (split a part in two pieces, e.g. collar wings); a neck
     inside a collar reaches under it by the head's travel (16 px) and the collar takes
     `fill: "extend"` and all the ink between it and the neck.
  4h. (task 9) parts that grow out of the head with no ink at the root (serpents, tentacles,
     antlers) are cut along the fill edit's bald scalp: the part is the figure outside it, its root
     reaching 4 px inside, pivoted on the root's middle, rotation only; check per part the pixels it
     must carry (body, tongue, iris), not only `uncovered` (its 1 px erosion hides a 3 px tongue), and
     that every figure pixel is in some outline; render a pose one layer at a time
     (`compositeRig` over a rig holding only that layer) to find which layer holds a ghost.
  6. add the slug to `CAST` in `packages/forge/src/cast.golden.test.ts`.
     and to `SLUGS` in `api/_tests/forge-replay.test.ts` (it pins the recorded job list), `CAST_FORGE`
     and the cast order in `apps/web/src/creator/gallery/notes.test.ts`, the hours in
     `apps/web/src/channels/Listings.dom.test.tsx` (sorted by name without "The"), and a 320 px
     still `assets/replay/thumbs/<slug>.webp`.
  7. If a web replay test then sees one job fewer than the folder holds, the vitest module cache
     is stale on the glob import: `rm -rf node_modules/.vitest-cache`.

## Saint Cardia of the Glass Heart (faceted gothic painting)
**What broke**
- The first sheet: a bright line beside the turned head (the hood's rim light left on the static
  background, because the simplified outline cut inside the silhouette) and a step across the hood
  where a horizontal head/torso cut met the outer edge.
- A part on the chest that followed the head (the default) would slide over the robe on a turn;
  even following the torso, its accessory depth (0.75) slid it against the torso (0.3).
- The property test found a follow cycle that runs through a *default* follow (a second head-role
  part following a part that follows the head by default) which parse accepted.
- The image edit re-renders the whole picture (mean diff 9/255) and nudges thin lines.

**What became code** (`packages/forge`)
- `PartsV2`/`NamedPart`/`PartRole`, `ROLE_KIND`, v2 `parseParts` (names, roles, follow with
  unknown/self/cycle errors including cycles through defaults, motion via the rig's ranges, key).
- `cutNamed`: every non-plate part lifted; **the lifted region is carried by the plate part at the
  root of the part's follow chain** (`carrierOf`), so the heart's filled hole moves with the torso.
- `assembleRig`: **a part with an explicit follow takes its target's depth**, so a heart on the chest
  moves with the chest; follows pass over targets with no layer; cycles are broken defensively.
- Float and pulse parts with no motion get a default; phases from `phaseFromName`.
- `compositeRig` takes per-layer gains (the review sheet shows the pulse).
- Seeded faults red: core blocking removed (disjoint property), follow not resolved to present
  layers (valid-rig property), default-follow cycle not checked (parse test).

**What became a decomposition-prompt rule** (fold into `partsPromptFromBrief`)
- Outline a part whose edge meets the background a few px *outside* its silhouette, so the rim
  light is inside the polygon (the tool's equivalent is `ontoGround`).
- Cut the head from the body along a fold or hem that ends in a concave corner of the silhouette,
  never straight across a hood, veil or hair that continues past the cut.
- A worn object on the chest follows `torso`; a floating finial follows the object it tops.
- Floating pieces are the thin ends that stand free against the background (finials, shards),
  not pieces cut out of a connected filigree.

## Mouth hardening (task 3, from the director's review of Cardia's sheet)
**What broke**
- JAW OPEN dropped Cardia's whole chin 61 px (the fixed `JAW_DROP`, a skull's 0.06 x height) onto a
  soft grey-black smear (task 9's `MOUTH_SHADE` ramp): wrong size and wrong style for any human face.
- The jaw's lifted region grew 6 px *up* too, so an open jaw would carry a sliver of the upper lip.
- On a turn, the trailing shoulder showed a double edge (the plate's static copy of the torso's
  outline: only the moving layers above the torso were painted out of the background); painting the
  torso out then exposed the head/torso seam as a dark line (cores are disjoint, so the torso had
  nothing under the head's edge).

**What became code**
- `Layer.drop` (rig-core amended): per-jaw travel, `[0.005, 0.1]`, default 0.06; `NamedPart.drop`.
- `mouth.ts`: `liftedJaw` (no growth above the lip line), the jaw layer cleared above its lip line in
  `cutNamed`, `paintCavity` (hard lens from the lip line, flat dark tones of the lip's own colour,
  optional accent glow `NamedPart.glow`), replacing `shadeMouthIn` for named parts.
- `backgroundOf` paints under the torso too; `cutNamed` lets a plate part reach `parallaxBacking` px
  under the plate part in front of it.
- Seeded faults red: pose ignores `drop`; validate accepts `drop` on a non-jaw; cavity not clipped to
  the lifted region; jaw not cleared above the lip; smooth shade instead of the cavity (golden on
  Cardia); no backing; backing unbounded.

**What became a decomposition-prompt rule**
- A human jaw is the lower lip (plus chin only for a skull or a puppet jaw): its top edge is the lip
  line, its width the mouth's width; set its drop to about 0.012-0.02 of the height.
- Name the mouth's glow on the jaw (`glow`) when the character's mouth glows; do not plan a separate
  mouth-light part.

## The Redactor (16-bit pixel art)
**What broke**
- A feathered cut (3 px) smears the hard cluster edges of pixel art.
- A 60-point outline of a stair-stepped silhouette cuts cells off; they stayed on the background as
  white slivers beside the turned head.
- The fill edit drew realistic eyes behind the spectacles (a style drift inside a lifted region).
- The mouth glow placed per column made a W; a glow layer following a floating bar would not bob with
  it (float is not inherited).

**What became code** (`packages/forge`)
- `PartsV2.cut` `{ feather, cell }`: a hard cut per style, and the cavity stepped on the art's cell.
- `NamedPart.fill: "extend"` and `plateNamed`: a part's plate from the surface around it, not the edit.
- The cavity's glow lies flat along the bottom of the full opening.
- Seeded fault red: `plateNamed` ignoring `fill: "extend"`; parse tests for drop, glow, fill and cut.

**What became a decomposition-prompt rule**
- Pixel art: ask for a hard cut and the cell size; trace parts on the ground at least one cell out.
- A glowing edge on a floating part is the same part (float + pulse), not a follower.
- Eyes behind dark glasses are the pupils; the lenses stay on the head (a blink narrows the pupil).
- A hanging pendant swings without its chain; the chain stays on the torso.
- Small parts on a flat field (pupils in a lens) are filled by extension, not by the edit.

## Vicar of the Lure (leaded stained glass)
**What broke**
- The lure: a bulb following a swaying stalk did not move with it (a float was not inherited), and the
  stalk turned about its centroid, so its foot slid on the dome. The review sheet drew no rotation,
  so the sway could not be seen at all.
- The maw: interleaved rows of needle teeth (upper tips lower than lower tips) cannot be split by a
  smooth line, and 17 lower teeth do not fit a 60-point outline tooth by tooth.
- A painted cavity hung from that jagged line read as a black-and-magenta zigzag in a mouth that is
  already drawn open over a lit throat.
- The bulb's halo tints the stalk's rim; a halo cut left a fleck on the ground, and the bulb's hull
  swung a sliver of the stalk's tip away.

**What became code**
- `poseLayers` (rig-core amended): a float is carried rigidly down the follow chain, before the
  layer's own parallax (which stays a pure shift); pulse and jaw drop stay the layer's own.
- `pivotOf` / `assembleRig`: an accessory or pulse part with an explicit follow is anchored where it
  meets its target (within `PIVOT_REACH` px); a part lying wholly on its target keeps its centroid,
  so Cardia's and the Redactor's rigs rebuild unchanged.
- `NamedPart.cavity: "fill"` (jaw only, never with `glow`): the open jaw uncovers the fill plate.
- `compositeRig` `turns`: rotation and scale about the moved anchor; `scripts/cast-forge.mjs` passes
  the pose's rotation and scale, so sways and swings show on the sheet.
- Seeded faults red: follower not carried (rig property), compositor ignores turns, no pivot
  (anchor at the centroid), cutNamed ignores `cavity: "fill"`.

**What became a decomposition-prompt rule**
- A part rooted on the head (a lure stalk, a horn, an antenna) names `follow: "head"` explicitly, so it
  keeps the head's depth and does not slide on a turn.
- A chain of hanging parts is a follow chain: the stalk sways (float with `rot_deg`, no amp), the bulb
  follows the stalk and pulses; give the bulb its own small swing at another frequency.
- A mouth drawn open (rows of teeth over a throat): upper teeth stay on the head, lower teeth go with
  the jaw; the jaw's top runs between the rows; ask the fill edit to remove "the lower jaw, its lower
  teeth and the chin" (it paints the throat) and set `cavity: "fill"`. A big maw drops about 0.035.
- A glowing part's halo on the ground belongs to the glowing part, never to its neighbour.

## Reveille, the Alarm of the Ninth (smoked brass and neon)
**What broke**
- Neon on a lit dial: an opaque eye polygon carried a disc of dial, which a pulse brightened; a
  turning clock hand slid a lozenge of cream over the dial. Both edits (two Codex runs) redrew the
  case as a whole round clock, the dial 30-60 levels too bright, with no throat behind the jaw.
- The clock hands lie wholly on the head, so they turned about their centroid, not their hub.
- The cavity lens is sized on the jaw's whole width: on a wide jaw frame its corners showed the
  edit's dial; a glow band read as a stripe across a mouth already drawn open over a dark gap.
- Ghosts: the hands' lit rim stayed on the dial when they turned; the eye discs (cut first) kept a
  piece of each hand; the brass halo beside the head stayed on the ground on a turn.
- A name holding ", " broke the CH 4 test's label split; a fixed 10-tick settle raced the tenth
  recorded job's load in the full run (it now waits for the wall's `aria-busy`).

**What became code** (`packages/forge`)
- `matte.ts`: `NamedPart.matte: "plate"`, alpha from the largest channel difference to the plate
  (MATTE_LO 18 .. MATTE_HI 56), colour un-mixed so the part over the plate is the portrait at rest.
- `NamedPart.pivot` `[y, x]`: the layer anchor of a part that turns on a hub (before `pivotOf`).
- `NamedPart.cavity: "gap"` (`MouthOptions.gap`): the drawn gap carried up, the full drop in every
  column, each in its own colour GAP_INSET rows under the lip when dark (GAP_LUMA), else the lip tones.
- Seeded faults red: cutNamed ignores matte; matte without un-mixing (property and rest composite);
  assemble ignores pivot; parse accepts pivot on a plate part; gap as a lens; gap ignores the
  column's colour; cutNamed ignores `cavity: "gap"`. Cardia, the Redactor and the Vicar rebuild
  byte-identical.

**What became a decomposition-prompt rule**
- Glowing parts (neon eyes, a lit crack) and thin dark parts on a light surface (clock hands) are
  matted against the plate; never cut a glow on a lit surface as an opaque disc.
- A part that turns on a hub or boss (clock hands, a wind-up key) names its pivot.
- Neon that is one circuit (eyes, teeth) pulses in phase; a cracked tube flickers on its own, faster.
- Teeth that must glow are their own jaw-role part with the jaw's drop, in front of the jaw.
- When the character is a machine with a hollow, the fill edit redraws the machine whole: plan
  `cavity: "gap"` and `fill: "extend"` for such mouths and dials instead of relying on the edit.

**Format finding (not widened)**
- Float is one sinusoid at most 2 Hz (design.md Motion). A bell's rattle is 10-20 Hz; at 2 Hz with
  3.5 deg the bells read as an agitated wobble, not ringing. A rattle needs a higher frequency cap or
  an event gesture ("ring"); left for the owner.

## The Tallyman (low-poly 3D)
**What broke**
- Six eyes, one blink: `Drive.blink` is one scalar and `poseLayers` squashed every eye by it, so the
  census-taker's eyes could not count one at a time.
- `motionOf` (named.ts) rebuilt a part's motion from `float` and `pulse` only, so any new curve on a
  named part would have been dropped silently before it reached the rig.
- The beads were measured by their lit half (bone luma > 112): the shaded half is the rods' own
  colour and stayed on the frame, so a slide split every bead and left dark arcs.
- The turned neck slid over the stand collar's corner (the collar is in front of the neck in 3D);
  the torso's parallax backing pushed a strip of neck up beside the collar; the collar's top rim rode
  the head as a fleck.
- A tight eye outline let the cut's feather blend the iris's bottom into the head's plate: a
  chartreuse fleck under a shut eye.

**What became code**
- `Motion.blink { freq, phase? }` (rig-core amended, additive, eye layers only; `bad_shape` at
  `$.layers[i].motion.blink` elsewhere): `ownBlinkAt` (motion.ts), a half-sine over `OWN_BLINK_S`
  (0.15 s) once per cycle; `poseLayers` squashes the eye by `max(Drive.blink, own)`; `still` zeroes
  it; validate and serialize carry it; `parseParts` refuses it on a part without an eye role and
  `motionOf` keeps it (`packages/forge`); the cast golden checks it reaches the layer.
- Seeded faults red: pose ignores the own blink; validate accepts a blink on a non-eye; the closure
  not gated to `OWN_BLINK_S`; `motionOf` drops the blink; parse accepts a blink on a monocle.
- Tried and reverted: cutting a lifted part behind a floating one from the filled surface. The ghost
  arcs were the beads' unmeasured shaded half, not the cut, and the feather zone lies outside the
  lifted region, where the plate is the portrait anyway.

**What became a decomposition-prompt rule**
- A character with many eyes gives each eye its own blink phase in the parts plan when the eyes
  "count", "scan" or "blink in turn"; the driver's blink still shuts them together. A blink per event
  (one per viewer) is not in the rig.
- Ask for a fill edit that closes the eyes rather than painting skin: a squashed eye then reads as a
  shut lid (the Tallyman's edit did this unasked with "remove the eyes").
- Lit 3D objects are cut by their whole body including the shaded side; a string of beads is one
  part per run of touching beads, sliding along its rod (`float` amp x only, `fill: "extend"`).
- A collar, ruff or gorget that wraps the neck is its own front part following `torso`, and the torso
  part starts under it, so a turned neck goes behind it.
- An eye outline is grown past the iris by at least the cut's feather plus 3 px.

**Format findings (not widened)**
- Events: the brief's "each eye blinks once per new viewer" and "beads slide on new follows" are
  driven by chat events; the rig carries only periodic motion (as the Redactor's slam). An engine
  event that fires a part's motion once would carry both.

## Sir Vacant (naive heraldic miniature)
**What broke**
- The open visor turned the drawn light grey: `cavity: "gap"` took a column's own colour only when
  dark, so a gap drawn full of white light fell back to the bevor's tones (grey bars).
- A line of ground beside the turned helm: the bevor (the jaw) is the helm's foot and borders the
  gorget; the head carries its lifted region, but the torso's backing reached only under the head's
  own polygon, so it stopped short along the bevor's edge.
- The hinge bosses were on no part (separated from the visor once the bevor was out, dropped by
  `keepBig`) and stayed on the background as a ghost on a turn; the bevor's sideways jaw growth
  smeared the head's copy of a boss with the extension fill.
- Eye slits grown by ledger 4e's feather + 3 px: the extension fill reached the pewter past the ink
  frame, and a blink showed a brown-grey slit instead of a dark one.
- The cast golden counted only translation and tint as motion, so pendulum tags (rotation only) failed.

**What became code** (`packages/forge`)
- `mouth.ts`: `GAP_LIT_NEAR` (48); with `glow`, a gap sample within it of the accent in every channel
  is carried up (`gapTone(..., lit)`), so a lit gap widens in its own light.
- `cutNamed`: a plate part's carried shape (its lifted regions grown `PLATE_DILATE` + feather) counts
  as in front for the backing of the plate parts behind it.
- Tooling: `scripts/cast-forge.mjs` writes `<slug>-blink.png` (the driver's blink, shut); the cast
  golden counts rotation as motion.
- Seeded faults red: gap ignores the lit accent (property); torso backing ignores the carried jaw.
  Vicar of the Lure and Reveille (jaws at the foot of the head) rebuild with torsos reaching under
  the jaw (rest unchanged: p99 0 and 8/255); Cardia, the Redactor and the Tallyman byte-identical.

**What became a decomposition-prompt rule**
- A character with no face names what plays the face: a visor or bevor that lifts or drops is the
  jaw, the light in a slit is the eye (the frame stays on the head).
- A mouth drawn open over light: `cavity: "gap"` with `glow` the light's colour; the jaw's top edge
  is the upper edge of the drawn gap, so the gap rides on the jaw.
- Hanging tags, charms and pendants swing as pendulums: float with `rot_deg` only, `pivot` at the
  top of the link they hang by, `follow` the chain; each at its own frequency.
- A plume or crest sways on its foot: `follow: "head"`, `pivot` the foot's middle, `key: false` on a
  dark ground (a luma key would thin a dark plume).
- Flat fills with ink outlines: grow each part over ink only (never into a neighbour's fill), cut
  with feather 1, trace outer edges onto the ground by the ink's width.

## Lot Ninety, the Auctioneer (art nouveau poster)
**What broke**
- The head layer was 978 px wide: the two disembodied gloves follow the head by default, so the
  head carried their filled holes, two patches of painted ground out in the dark that moved with
  every turn (the same was true, unseen, of Cardia's spires and the Vicar's bulb).
- The flame splits the glove's cuff rim, so the glove mask was two pieces and its single outline
  missed about 1,000 px of cuff, which stayed on the background as a ghost when the glove bobbed.
  The wing collar likewise (two wings, one outline): one wing was on no part.
- The neck inside the wing collar: the edit drew a plain shirt collar under the wings, and the neck
  reaching under them carried its lines as a second edge on a turn; the collar's top tips above the
  neck row rode the head as flecks.
- A jaw between fixed columns chopped the lower lip's tails; a full-strength accent glow read as a
  green tongue.

**What became code** (`packages/forge`)
- `cutNamed`: a lifted part whose region lies more than `PLATE_DILATE` px from every plate part's
  polygon is carried by no plate part; the background paints the ground behind it. The head layer
  is 446 px wide. Cardia's spires and the Vicar's bulb rebuild uncarried (rest unchanged, mean
  0.27 and 0.25/255, no pixel over 60); the other four rebuild byte-identical.
- Seeded fault red: the ground check removed (the head layer reached the glove, x 96 against < 50).

**What became a decomposition-prompt rule**
- Disembodied parts (hands, gloves, orbiting charms) are floats with no follow and a `pivot` at the
  joint they would turn on (the wrist); pairs move half a cycle apart; whatever trails from them
  (ectoplasm, a flame, a ribbon) is a follower with its own small sway about its root and a flicker.
- A part that is two pieces in the drawing is two parts (a wing collar, a split cuff closed across).
- A neck that disappears into a collar reaches under it; ask the fill edit for the collar removed,
  but plan `fill: "extend"` for the collar when the edit redraws its own collar there.
- A grin of teeth over a closed bite: the jaw is the lower teeth and lower lip under the seam between
  the rows, a drop of about 0.024, the default cavity with the accent at about 60% as `glow`.
- A wink is an own `motion.blink` on one eye at a slow frequency (about 0.12 Hz).

**Format finding (not widened)**
- "Points at bidders", "slams down SOLD", "glances" are chat events and gaze; the rig carries only
  periodic motion (as the Tallyman's), so the gloves only bob and turn.

## Auntie Asp, Keeper of the Stone Stacks (art nouveau poster, six serpents)
**What broke**
- Six serpents grow out of the scalp with no ink at the root. Cut along the fill edit's bald dome,
  they come out as six clean components, but the dome is wider than the scalp the drawing shows:
  the black wedges between the roots were bald scalp in the plate, and a swaying serpent uncovered
  specks of it (the key keeps a ground pixel when the plate under it differs).
- The edit drew ground under the collar's back band, and the neck reaching under the band pulled a
  black bar out from under it on a turn; the extension fill painted there instead spread a grey haze
  over the ground beside the band (the plate blends PLATE_DILATE + PLATE_FEATHER px past a lifted
  region), and a neck reach longer than the band is wide hung out over the ground at full yaw.
- 60-point outlines: the chords along a curved scalp left a 1 px sliver of each root on the head; the
  frill's wavy top ink and the neck's antialiased edge beside the band fell outside their outlines.
- The lip seam's ink, dropped with a lips-only jaw, drew a line across the lower lip and two dashes
  under the mouth's corners.

**What became code** (`packages/forge`)
- `groundUnderKeyed` (cutNamed.ts), applied last in `plateNamed`, pixel for pixel: the plate is the
  portrait's open ground (luma at or under the key's floor) inside a keyed lifted part's region and in
  the ring the plate blends around every lifted region. Unkeyed parts (black hair, a dark plume) keep
  the fill. The other seven rebuild with rest unchanged (max 5/255); turned, only Cardia differs
  (79 px inside the crown's open filigree, now ground through the gaps).
- Seeded faults red: the rule removed (a keyed part over ground keeps the edit), applied to unkeyed
  parts too (a dark plume loses its fill), the ring term removed (beside an unkeyed part the plate
  blends toward the edit on the ground).

**What became a decomposition-prompt rule**
- Hair made of separate creatures (serpents, tentacles) is one part per strand, role `hair`,
  `follow: "head"`, pivot at the root, float with `rot_deg` only (4-5 deg), each strand its own
  frequency and phase; the lower strands are listed first (in front). Ask the fill edit for the
  strands removed: it paints the bald scalp the cut runs along.
- Spectacles are a monocle-role part following the head with no motion: the filled rings, bridge and
  arms; the eyes inside are cut off the wire.
- A neck in a stand collar whose back band shows beside the neck: the collar is three parts (front,
  two back sides); the back sides take `fill: "extend"` and the ink between them and the neck; the
  neck reaches under the collar but stops the head's travel (13 px) inside the collar's outer edges.
- A closed mouth: the jaw starts under the seam's ink (the seam stays with the upper lip) and spans
  only where the lower lip has body; the corners stay on the head.

**Format findings (not widened)**
- The 60-point cap held for long thin curving parts: a serpent of about 1,000 px of outline with a
  3 px forked tongue fits 53-56 points with no body or tongue pixel missed when traced 8 px onto the
  ground. Parts bordered by another figure part, not ground (a frill, a neck beside a band), need
  their outline traced a few px over a neighbour that moves with them or is in front of them.
- Parallax backing copies the portrait: a plate part reaching under the one in front (the torso under
  a neck) shows the front part's edge, ink included, on a turn (Lot Ninety's faint line, Auntie Asp's
  3 x 13 px stub beside the neck). Painting the backing from the plate part's own surface would
  remove it; it changes every rig's torso, so it is left for the owner.
- "Turns toward whoever speaks" and "glare on timeouts" are gaze and events (the Tallyman's finding).

## General rules for any character (folded into `partsPromptFromBrief`, task 11)
What the eight taught, for a streamer's character. **Forge code** does the first list on its own; the
**parts prompt** must say the second. Task 11 folded the prompt rules into `partsPromptFromBrief`
(design.md "partsPromptFromBrief (exact)"); the eyes-closed half of the fill-edit rule is
`fillPromptFromBrief`'s.

**Forge-code behaviour (automatic in `packages/forge`, nothing to ask for)**
- Cut order front to back by role, disjoint cores; every non-plate part lifted and the plate filled
  behind it; a lifted region carried by the plate part at the root of its follow chain, and by none
  when the part floats on the ground (task 8).
- A part with an explicit follow takes its target's depth; a float is carried rigidly down the follow
  chain; an attached accessory or pulse part turns where it meets its target (`pivotOf`) unless it
  names a `pivot`.
- A jaw's lifted region stops at its lip line and its layer is clear above it; the mouth it uncovers
  is painted (`paintCavity`), or the fill (`cavity: "fill"`), or the drawn gap (`"gap"`, lit with `glow`).
- The background is painted under the torso; a plate part reaches `parallaxBacking` px under the plate
  part in front of it and under what that part carries.
- `matte: "plate"` keys a part against the plate; `fill: "extend"` paints its plate from around it;
  the plate keeps the portrait's open ground under keyed lifted parts and around every lifted part.
- Own eye blinks (`motion.blink`) combine with the driver's blink; reduced motion stills every curve;
  float and pulse parts without motion get a default, phases from the part's name.

**Prompt rules (the parts model must be told)**
- Outlines: trace a part whose edge meets the background a few px outside its silhouette (rim light
  and ink inside the polygon); a polygon is one outline, so a part drawn in two pieces is two parts;
  grow each part over its own ink, never into a neighbour's fill; extend an eye outline past the iris
  by the feather plus 3 px; take lit 3D objects by their whole body, shaded side included.
- Cuts: cut the head from the body along a fold or hem ending in a concave corner, never straight
  across a hood, veil or hair; a collar, ruff or gorget around the neck is its own front part
  following `torso`, and the neck reaches under it, stopping the head's travel short of its outer
  edges; parts growing out of the head with no ink at the root (strands, serpents, horns) end
  at the scalp, the root's middle their pivot.
- Follows: anything worn on the chest follows `torso`; anything rooted on the head (horn, stalk,
  plume, serpent, spectacles) names `follow: "head"`; a floating finial follows what it tops; a hanging
  chain is a follow chain (stalk, then bulb); a glow's halo belongs to the glowing part; a trail
  (flame, ribbon, ectoplasm) follows what it trails from and is listed before it.
- Motion: sibling floats get different frequencies and phases (shards, gloves, serpents, tags never in
  lockstep); hanging tags and charms swing as pendulums (`rot_deg` only, pivot at the link); a plume
  or strand sways on its foot (`rot_deg` only); disembodied hands float with no follow, pivot at the
  wrist, pairs half a cycle apart; a part that turns on a hub names its pivot; many eyes that count
  blink on their own phases; one neon circuit pulses in phase, a cracked tube flickers alone; floats
  stay under 2 Hz (no rattles).
- Mouth: a human jaw is the lower lip under the seam's ink (plus the chin only for a skull or a
  puppet), a drop of about 0.012-0.02 of the height; a grin of teeth drops the lower teeth and lip
  (about 0.024); a maw drawn open takes `cavity: "fill"` and drops about 0.035; a mouth drawn open
  over a dark gap takes `cavity: "gap"`, over light the same with `glow`; a glowing mouth names `glow`
  on the jaw, never a separate light part; a character with no face names what plays it (a visor is
  the jaw, a slit's light the eye).
- Keys and fills: glowing parts and thin dark parts on a light surface take `matte: "plate"`; small
  parts on a flat field, parts floating on the ground and collars whose plate the edit redrew take
  `fill: "extend"`; a dark plume or hair on a dark ground takes `key: false`; pixel art asks for
  `cut: { feather: 0, cell }`, flat fills with ink `feather: 1`.
- The fill edit: ask for the parts removed (it paints the bald scalp, the throat, the neck under a
  collar); ask for the eyes closed, not skin, so a squashed eye reads as a shut lid; for a machine
  with a hollow, plan `cavity: "gap"` and `fill: "extend"` instead of trusting the edit.
- Events are not motion: "when chat...", "on a timeout", "turns toward the speaker" do not become rig
  motion; plan a periodic stand-in or leave it to the engine.
