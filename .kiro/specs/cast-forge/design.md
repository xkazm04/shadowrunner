# Design: cast-forge

## Overview
Three seams, built in this order: **motion** in the rig format (rig-core + avatar), **named parts** in
the forge cut, then the **brief and handshake** in front of the forge. Between the second and the third,
eight characters are decomposed one at a time; each one hardens the forge code and the decomposition
rules, and the last seam reuses what they taught.

```
packages/rig/src/types.ts        Layer.motion?: Motion  (FloatMotion, PulseMotion)  - additive, Rig stays v1
packages/rig/src/validate.ts     motion ranges
packages/rig/src/pose.ts         applyMotion (pure, deterministic in t), pulse -> tint
packages/rig/src/legacy.ts       keeps float/pulse curves from Overlord layers.json / m8.spec.json
packages/avatar/                 passes reduced motion as "still"; pulse tint reaches the shader / canvas2d
packages/forge/src/types.ts      PartRole, NamedPart, PartsV2
packages/forge/src/parts.ts      parseParts accepts v1 (ten names) and v2 (named parts); ROLE_KIND table
packages/forge/src/cut.ts        cutAll over named parts (order below)
packages/forge/src/assemble.ts   role -> kind, follow, motion (and a jaw's drop) into the rig
packages/forge/src/mouth.ts      liftedJaw, paintCavity: the mouth an open jaw reveals (task 3)
packages/forge/src/brief.ts      CharacterBrief, parseBrief, BRIEF_PROMPT, portraitPromptFromBrief, partsPromptFromBrief
packages/forge/src/briefParts.ts settleBriefParts, motionFromWords, fillPromptFromBrief (task 11)
scripts/cast-forge.mjs           offline: cast/<slug> -> replay job + review sheet (shares code with forge-replay.mjs)
assets/characters/cast/<slug>/   portrait.png, brief.json, parts.json, fill.png?, NOTES.md
assets/replay/forge/<slug>/      job.json + layer PNGs (as the presets)
docs/cast-forge-ledger.md        one section per character: what broke, what became code, what became a prompt rule
```

## Motion (requirement 1)
```ts
export interface FloatMotion { amp: [x: number, y: number]; freq: number; rot_deg?: number; phase?: number }
export interface PulseMotion { amp: number; freq: number; phase?: number }
export interface Motion { float?: FloatMotion; pulse?: PulseMotion }
// Layer gains: motion?: Motion   (omitted when absent, never null)
```
Ranges (validate, every error reported, path `$.layers[i].motion.<field>`): `amp` x and y in
`[0, 0.05 * width]` / `[0, 0.05 * height]` px; `freq` in `[0.02, 2]` Hz; `rot_deg` in `[0, 15]`;
`phase` in `[0, 1)` cycles; pulse `amp` in `[0, 1]`.

Amended by task 6 (the Tallyman's six eyes that count one at a time; `Drive.blink` is one scalar, so
every eye shut together): `export interface BlinkMotion { freq: number; phase?: number }`,
`Motion.blink?`, `eye` layers only (`bad_shape` at `$.layers[i].motion.blink` elsewhere; a named
part with a blink needs an eye role). Closure `ownBlinkAt` = `sin(pi * s / OWN_BLINK_S)` for
`s = frac(freq*t + phase) / freq < OWN_BLINK_S` (0.15 s), else 0; `poseLayers` squashes the eye by
`max(Drive.blink, own)`; `still` zeroes it. Periodic, not event-driven: a blink per new viewer
(the brief's hook) needs an event the rig does not carry.

Pose, with `w = 2*pi*(freq*t + phase)`: float adds, about the layer's own anchor and **after** the
inherited follow transform, a translation `(amp[0]*sin(w), amp[1]*sin(w + pi/2))` and a rotation
`rot_deg*sin(w + pi)`. Amended by task 4: a float is carried down the follow chain (a follower turns and
moves rigidly with its parent's float before its own, so a lure bulb stays on a swaying stalk's tip; the
jaw drop and the pulse stay the layer's own), and an attached part (accessory or pulse role with an
explicit follow) is anchored where it meets its target (`pivotOf`). Pulse multiplies
the layer's tint by `1 + amp*(0.5 + 0.5*sin(w))`. When the drive says still (reduced motion), both are
zero. Phases: a builder gives sibling floats different phases so a set of shards never moves in lockstep.

Legacy import: `float {amp, freq, rot_deg}` and `pulse {amp, freq}` from `layers.json` (or the m8 spec
element of the same name) are copied into `motion`, phase derived from the layer name hash so it is
stable. `docs/rig-format.md` and `.kiro/specs/rig-core/design.md` "Data model" gain the field (this spec
amends rig-core; say so in both).

## Named parts (requirement 2)
```ts
export type PartRole = PartName | "eye" | "float" | "pulse";
export interface NamedPart {
  name: string;                       // [a-z0-9_], unique, becomes the layer name
  role: PartRole;
  box_2d: [number, number, number, number];   // [ymin,xmin,ymax,xmax] 0..1000, as v1
  poly: [number, number][];                   // [y,x] 0..1000, 3..60 points, as v1
  follow?: string;                    // another part's name; default by role (below)
  motion?: Motion;                    // in 1024-px canvas units
  key?: boolean;                      // luma-key the polygon (gaps show the plate), default by role
}
export interface PartsV2 { version: 2; parts: NamedPart[] }   // at most 40 parts
```
`ROLE_KIND`: the v1 `PART_KIND` for the ten names, `eye -> eye`, `float -> accessory`,
`pulse -> accessory`. Default follow: `torso` follows nothing, `head` follows nothing, everything else
follows `head`; a part may name any other part (a heart on the chest follows `torso`, a lure bulb follows
the stalk). Cycles and unknown names are parse errors.

Cut order, front to back: `float`, `pulse`, `eye_l`/`eye_r`/`eye`, `monocle`, `accessory`, `hat`,
`crown`, `hair`, `jaw`, `head`, `torso`; within a role, file order. Cores stay disjoint (a later part
loses the pixels an earlier part took). Every non-plate part is lifted from the plate and the plate is
filled behind it (edit when available, `blurExtend` otherwise), as `FILL_PARTS` does today.
A v1 file parses to the same `Part[]` it does today: no existing test changes behaviour.

## Mouth, jaw travel and seams (amended by cast-forge task 3)
The fixed `JAW_DROP` (0.06 x height) is a skull's gape; on Cardia it dropped her whole chin 61 px onto
a soft grey smear (task 9's `MOUTH_SHADE` ramp). Now:
- **Jaw travel per layer.** `Layer.drop` (rig-core amended, `docs/rig-format.md`): jaw layers only,
  `[0.005, 0.1]` of height, default 0.06, so every existing rig is unchanged. `NamedPart.drop` (jaw
  role) becomes it. A lips-only jaw wants about 0.012-0.02.
- **Lip line.** A jaw's lifted region is its polygon grown `JAW_GROW` px down and sideways but never
  above its top edge (`liftedJaw`), and its cut layer is cleared above that edge, so the jaw's top is
  the lip line, hard, and an open jaw carries no sliver of the upper lip.
- **Cavity (a plate treatment).** `paintCavity` paints the head's surface under the jaw, inside its
  lifted region (so the rest view never shows it): for each column of the jaw, from the lip line down
  `drop px * (1 - u^2)` (`u` across the jaw, -1..1), a lens pointed at the corners and as deep as the
  drop in the middle. Tones are flat, never blended: a shadow band under the upper lip (7% of the lip's
  mean colour), the deep tone (16%, hue kept), and with the jaw part's `glow` ("#rrggbb", characters
  whose mouth glows) a flat band of the accent over the lower middle of the full opening. The corners
  of the gap show the fill plate. A layer was rejected: a cavity layer behind the jaw would need its own
  follow and depth and could slide against the head on a turn; painted into the head's surface it
  moves with the head by construction.
- **Cavity from the plate** (task 4). `NamedPart.cavity: "fill"` (jaw only, no `glow`): the open jaw
  uncovers the fill plate, unpainted. For a mouth the drawing already shows open (a maw of teeth over
  a lit throat) the jaw's top runs on a jagged line between the rows of teeth, and a lens hung from
  it reads as a zigzag; the edit paints the throat behind the jaw instead. Default `"paint"`.
- **Gap cavity** (task 5). `NamedPart.cavity: "gap"`: a mouth drawn open over a dark gap under a
  smooth lip, where the edit will not paint a throat (it redrew Reveille's case as a whole clock):
  every column of the jaw uncovers the full drop, in the column's own colour `GAP_INSET` rows under
  the lip when it is dark (`GAP_LUMA`), else the lip's tones. Hard, like the lens.
  Amended by task 7 (Sir Vacant's visor): with `glow`, a column whose colour lies within
  `GAP_LIT_NEAR` (48) of the accent in every channel is carried up too, so a gap drawn full of light
  (a helm's inner light, a furnace mouth) widens in its own light instead of turning dark.
- **Backing under a carried jaw** (task 7). A plate part's backing (`parallaxBacking`) reaches under
  everything the plate part in front covers, its carried lifted regions included: a bevor at the
  helm's foot is carried by the head, and a turned head left a line of ground beside its edge.
- **Parts floating on the ground** (task 8). A lifted part whose region lies more than
  `PLATE_DILATE` px from every plate part's polygon (a disembodied glove, a spire high above a
  crown) is carried by no plate part: only ground is behind it, which the background paints.
  Carried, it stretched the head layer out to it as a moving patch of painted ground.
- **Open ground stays ground** (task 9). `plateNamed` ends with `groundUnderKeyed`: inside a keyed
  lifted part's region, and in the ring the plate blends around every lifted region
  (`PLATE_DILATE + PLATE_FEATHER`), a pixel the portrait shows as open ground (luma at or under the
  key's floor) is the portrait's in the plate, pixel for pixel. Auntie Asp's fill painted a bald
  dome wider than the gaps between her serpents' roots, and a swaying serpent uncovered specks of
  scalp in the ground. Unkeyed parts (black hair, a dark plume) keep the fill.
- **Plate matte and pivot** (task 5). `NamedPart.matte: "plate"` (lifted parts): the part keeps only
  what differs from the plate behind it, alpha ramped from `MATTE_LO` to `MATTE_HI` on the largest
  channel difference and colour un-mixed (`plate + (portrait - plate) / alpha`), so it is the
  portrait at rest and a pulse lights the neon, not the surface. `NamedPart.pivot` `[y, x]` 0..1000
  (lifted parts) is the layer's anchor: a clock hand's hub; it wins over `pivotOf`.
- **Cut style.** `PartsV2.cut` `{ feather?: 0..8, cell?: 1..32 }`: `feather: 0` is a hard cut (pixel
  art: no smeared cluster edges), `cell` the art's pixel size, on which the cavity steps.
- **Fill per part.** `NamedPart.fill: "extend"` (lifted parts) paints the plate behind it from the
  surface around it, not from the edit (`plateNamed`): a pupil in a dark lens, where the edit draws a
  new eye.
- **Seams on a turn.** The background is painted out under the torso too (it moves at body depth;
  the plate's static copy of its outline showed as a double edge), and a plate part reaches
  `parallaxBacking` px (the most head and torso part at full yaw or pitch, 13 px at 1024) under the
  plate part in front of it, so a turned head shows torso at the seam, not painted-out ground. The
  v1 `cutAll` path is unchanged (presets keep their recorded jobs); task 11 moves live jobs onto
  `cutNamed`.

## How a character is decomposed (requirement 3, offline, by the builder)
1. Read `brief.json` (the parts plan the contest seat wrote) and look at `portrait.png`. The plan is a
   proposal: merge, split or drop parts where the drawing disagrees, and say so in `NOTES.md`.
2. Measure, do not guess: polygons come from pixel analysis of the portrait (ground key against the
   near-black, colour and edge segmentation, the style's own lines: lead lines, polygon facets, ink
   outlines, pixel clusters), written as a small script under `scripts/cast/` when it is reusable.
   Draw the polygons over the portrait (`var/cast-forge/<slug>-parts.png`) and check them by eye.
3. Fill plate: ask Codex CLI image generation to edit the portrait with `fillPrompt(<lifted part names>)`
   (same framing, the parts removed, surface painted behind); save `fill.png`, and check it by eye.
   If the edit drifts (framing, colours, identity), use the `blurExtend` fallback and say so.
4. `node scripts/cast-forge.mjs <slug>` builds the replay job and the review sheet. Iterate until the
   sheet passes requirement 3.3. Then write `NOTES.md` and the ledger section, and harden.
Codex recipe (probed 2026-11-02, about 50 s per image):
`codex exec --skip-git-repo-check --ephemeral --dangerously-bypass-approvals-and-sandbox -C <dir> - < request.txt`
where request.txt asks for the image tool with the prompt verbatim and an attached/input image path,
then a copy of the result into `<dir>` (the tool writes under `~/.codex/generated_images/`).

## Brief and handshake (requirement 4)
```ts
export interface CharacterBrief {
  name: string; one_line_request: string; archetype: string; persona_hook: string;
  accent_hex: string; secondary_hex?: string; silhouette: string;
  parts: { name: string; role: PartRole; what: string; motion?: string; follow?: string }[];  // 6..16
  style: { name: string; why: string };
  portrait_prompt: string;            // <= 900 chars
}
```
`BRIEF_PROMPT(request)` (exact; the request is cut to 400 chars):
"You design an original character to be a live 2.5D streaming co-host. It will be drawn as one portrait
and cut into animation layers. From the streamer's request below, return JSON only with the fields
name, one_line_request, archetype, persona_hook, accent_hex, secondary_hex, silhouette, parts, style,
portrait_prompt. Rules: original fiction, never a real person or an existing character, no text or
logos, horror not gore. The portrait is a frontal, centred, symmetrical head-and-shoulders bust on an
empty near-black background with the jaw and both eyes visible. parts lists 6 to 16 parts, each a
separate shape that does not overlap another, each with a role from head, jaw, eye_l, eye_r, eye,
monocle, crown, hat, hair, accessory, torso, float, pulse; always include head, jaw, eyes and torso,
and give the character one or two signature parts that float or pulse on their own, saying how they
move. Choose a hard-edged graphic art style such as leaded stained glass, low-poly planes, flat poster
fills with ink outlines, pixel art or a faceted painting, never soft painterly realism: its edges become
the cut lines. portrait_prompt is under 900 characters, describes the character and every part in that
style, and ends with the framing rules. Request: <request>"
`parseBrief` validates every field and range (hex colours, part count, roles, unique `[a-z0-9_]`
names, follow targets); an invalid answer is retried once, then `upstream`. The brief model is the
engine's Anthropic client (`SR_BRIEF_MODEL`, default the engine's model); replay returns the recorded
brief whose `one_line_request` matches, else the first cast brief, labelled RECORDED.
`portraitPromptFromBrief(brief) = HOUSE_STYLE + brief.portrait_prompt` (HOUSE_STYLE's "painterly
realism" is replaced by "in the brief's art style" for brief prompts only).
`partsPromptFromBrief(brief)`: the v2 parts request naming the brief's parts and roles, returning
`PartsV2`; the hardening rules from `docs/cast-forge-ledger.md` that apply to any character are
folded into its text (exact text and the live step: "Live decomposition from the brief" below).

Handshake, `/creator/new` (the Rite in Four Marks): mark 1 takes the request, then shows the brief as an
editable card (name, style, parts with role and motion); "Draw it" starts the portrait from the
approved brief, "Ask again" re-briefs. Wire: `POST /api/forge/brief {request} -> {brief}` (quota kind
"forge", cost constant in costs.ts) and `POST /api/forge {mode:"brief", brief}`.

## Live decomposition from the brief (requirement 4.4, task 11)
A live forge job with an approved brief (`mode: "brief"`, `job.brief`) asks the parts model for the
brief's own parts and goes down the path the eight went down offline; a job without a brief keeps
the v1 path unchanged (PARTS_PROMPT, `cutAll`, FILL_PARTS).
```
segmenting  generateJson(partsPromptFromBrief(brief), portrait) -> parseBriefPartsJson(reply, brief)
            = JSON.parse -> settleBriefParts -> parseParts (must be v2)  -> job.named, decomposition "named"
            a failed answer (not JSON, or refused) is re-asked once on the next GET; failed twice:
            decomposition "fallback", asks counted afresh, PARTS_PROMPT on the next GET (v1 rules)
cutting     fillPromptFromBrief(named, brief): the edit, or none when no lifted part needs it
filling     assembleNamed = plateNamed(portrait, parts, edit) -> cutNamed(.., {plate, ...cut}) -> assembleRig
```
`assembleNamed` (in `api/_lib/forge-steps.ts`) is the same chain `scripts/forge-lib.mjs`
`runPipeline` runs for a cast character, so the product path and the overnight path are one path.
`JobView.decomposition` (`"named" | "fallback"`, brief jobs only, from the parts step on) lets the
creator say when the brief's parts could not be found and the portrait was cut into the standard ten.

**Motion from words (decision).** The brief carries motion as words; the numbers come from the
parts model, which sees the portrait (a serpent's root, a tag's link) and is told the ranges and the
ledger's motion rules in the prompt. The forge never trusts them: `settleBriefParts` clamps every
number into the validated range (float amp 0..`LIVE_AMP_MAX` = 50 MOTION_CANVAS px, under the rig's
0.05 x 1024 = 51.2; freq 0.02..2 Hz; rot_deg 0..15; phase taken mod 1; pulse amp 0..1; jaw drop
0.005..0.1; pivot rounded into 0..1000; cut feather 0..8, cell 1..32), drops a blink off a non-eye
role and every field a role may not carry (drop, glow, cavity off the jaw; fill, matte, pivot off
head and torso; glow with cavity "fill"), and drops a curve it cannot read. A lifted part whose brief
words say it moves but whose answer has no readable motion gets `motionFromWords(name, role, words)`,
a deterministic mapping to safe defaults: pulse words (glow, flicker, beat, light...) a pulse of amp
0.5 at 0.5 Hz (a flicker 1.3, a beat 1.1); sway words (sway, swing, nod, turn, tick...) rotation only,
4 degrees at 0.3 Hz; float words (float, bob, drift, rise, breath...) a bob of [1.5, 4] px and 1.5
degrees at 0.3 Hz; blink words on an eye an own blink at 0.2 Hz; every frequency spread 0.85x-1.15x by
the part's name and phases left to `motionOf` (from the name), so siblings never move in lockstep.
A clause about an event ("when chat...", "toward the speaker") maps to nothing; head and torso never
get word motion (the stage moves them). Float and pulse roles with no motion at all keep the default
`motionOf` gives them. So a live rig's motion always passes `validateRig`.

**Settling against the brief.** The answer may be `{version: 2, parts, cut?}` or a bare array. Parts
the brief does not plan are dropped (counted in a log note, the name never echoed); a kept part takes
the brief's role and the brief's follow (else the answer's, when it names another kept part). Polygons
and boxes are never repaired: an outline the parser refuses fails the answer, and the step re-asks.

**The fill edit for named parts.** `fillPromptFromBrief(parts, brief)` = `fillPrompt(phrases)` over the
lifted parts that do not take `fill: "extend"`, in file order, each phrase the brief part's `what`
(its name with spaces when the brief has none), an eye's followed by "(paint closed eyelids where they
were)" (ledger: a squashed eye reads as a shut lid). No phrase, no edit: the plate is the pure fallback.

### partsPromptFromBrief (exact)
`<name>` is `brief.name`, `<style>` is `brief.style.name`, `<parts>` the brief's parts in order joined
with " | ", each `<name> (<role>): <what>`, then `; moves: <motion>` and `; follows <follow>` when the
part has them (`briefPartLine`). The lines below are joined with single spaces. Every prompt rule of
`docs/cast-forge-ledger.md` "General rules for any character" is in it (Outlines, Cuts, Follows,
Motion, Mouth, Keys and fills, Events); the forge-code rules there need no asking.
```text
This is the portrait of <name>, a character drawn in <style>, to be cut into animation layers for a
live 2.5D co-host. Return JSON only: {"version": 2, "cut": {"feather": integer, "cell": integer},
"parts": [{"name": string, "role": string, "box_2d": [ymin,xmin,ymax,xmax], "poly": [[y,x],...],
"follow": string, "motion": object, "key": boolean, "drop": number, "glow": string, "cavity":
string, "fill": string, "matte": string, "pivot": [y,x]}]} with coordinates as integers normalized
to 0-1000 and 8-60 points per polygon, clockwise; name, role, box_2d and poly are required, leave
out every other field a part does not need. Name exactly these parts with exactly these roles and no
others, and leave out only a part that is not visible: <parts>. Fields: follow is another part's
name. motion is {"float": {"amp": [x, y], "freq": number, "rot_deg": number, "phase": number},
"pulse": {"amp": number, "freq": number, "phase": number}, "blink": {"freq": number, "phase":
number}}: float amp in px of a 1024 px canvas, 0-50 each; freq 0.02-2 Hz; rot_deg 0-15 degrees;
phase 0-1 of a cycle; pulse amp 0-1, a light gain; blink on an eye only. Turn each part's motion
words into these numbers, and give motion only to a part whose words say it moves on its own (the
stage moves the head, jaw, eyes and torso). drop (0.005-0.1 of the height), glow ("#rrggbb") and
cavity ("paint", "fill" or "gap") are for the jaw only; fill ("edit" or "extend"), matte ("plate")
and pivot ([y,x], the point the part turns about) for any part but head and torso; key false keeps a
part's dark pixels instead of keying them out against the ground; cut feather is 0-8 px, cell 1-32
px, the art's own pixel size. Outlines: trace a part whose edge meets the background a few px
outside its silhouette, so its rim light and ink are inside the polygon; a polygon is one outline,
so a part drawn in two pieces is two parts; grow each part over its own ink, never into a
neighbour's fill; extend an eye's outline 6 px past the iris; take a lit 3D object by its whole
body, shaded side included. Cuts: cut the head from the body along a fold or hem ending in a concave
corner, never straight across a hood, veil or hair; a collar, ruff or gorget around the neck is its
own front part following torso, and the neck, in the head's outline, reaches under it and stops
short of its outer edges; parts growing out of the head with no ink at the root (strands, serpents,
horns) end at the scalp, the middle of the root their pivot. Follows: anything worn on the chest
follows torso; anything rooted on the head (horn, stalk, plume, serpent, spectacles) has follow
"head"; a floating finial follows what it tops; a hanging chain is a follow chain (the stalk follows
the head, the bulb the stalk); a glow's halo belongs to the glowing part; a trail (flame, ribbon,
ectoplasm) follows what it trails from and is listed before it. Motion: sibling floats get different
frequencies and phases (shards, gloves, serpents, tags never move in lockstep); hanging tags and
charms swing as pendulums (rot_deg only, amp [0, 0], pivot at the link); a plume or strand sways on
its foot (rot_deg only, pivot at the foot); disembodied hands float with no follow, pivot at the
wrist, a pair half a cycle apart; a part that turns on a hub names its pivot; many eyes that count
blink on their own phases; one neon circuit pulses in phase, a cracked tube flickers alone; floats
stay under 2 Hz, never a rattle. Mouth: a human jaw is the lower lip under the seam's ink (the chin
too only for a skull or a puppet), drop about 0.012-0.02; a grin of teeth drops the lower teeth and
lip, drop about 0.024; a maw drawn open takes cavity "fill" and drop about 0.035; a mouth drawn open
over a dark gap takes cavity "gap", over light the same with glow; a glowing mouth names glow on the
jaw, never a separate light part; a character with no face names what plays it (a visor is the jaw,
a slit's light the eye). Keys and fills: glowing parts and thin dark parts on a light surface take
matte "plate"; small parts on a flat field, parts floating on the ground and collars take fill
"extend"; a dark plume or hair on a dark ground takes key false; a machine with a hollow takes
cavity "gap" and fill "extend"; pixel art takes cut {"feather": 0, "cell": its pixel size}, flat
fills with ink outlines cut {"feather": 1}. Events are not motion: words such as "when chat ...",
"on a timeout" or "turns toward the speaker" become no motion; give a slow periodic stand-in or
none.
```
Limits found by the offline proof (task 11): a brief plans 6..16 parts with exactly one jaw, so the
Tallyman (18 parts) and Reveille (teeth and jaw, two jaw roles) cannot be planned by a brief as they
were decomposed; the other six run through the live steps to their committed replay rigs exactly.

## Testing strategy
- fast-check: motion offsets bounded by amp and periodic in `1/freq`; `still` gives the identity;
  `validateRig` accepts every in-range motion and rejects each out-of-range field; v2 cut cores
  disjoint for arbitrary named part sets; assembled v2 rigs always valid; `parseBrief` rejects
  malformed answers.
- Golden: Malakor legacy import now carries 13 float layers and 1 pulse; each cast rig loads, poses at
  t = 0 and t = 1.7 s and passes `validateRig`.
- Every seeded fault proven red once (say which in the kiro-log row).
