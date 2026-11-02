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
  6. add the slug to `CAST` in `packages/forge/src/cast.golden.test.ts`.
     and to `SLUGS` in `api/_tests/forge-replay.test.ts` (it pins the recorded job list).
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
