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

Pose, with `w = 2*pi*(freq*t + phase)`: float adds, about the layer's own anchor and **after** the
inherited follow transform, a translation `(amp[0]*sin(w), amp[1]*sin(w + pi/2))` and a rotation
`rot_deg*sin(w + pi)`; it is not inherited by the layer's followers (like the jaw drop). Pulse multiplies
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
folded into its text.

Handshake, `/creator/new` (the Rite in Four Marks): mark 1 takes the request, then shows the brief as an
editable card (name, style, parts with role and motion); "Draw it" starts the portrait from the
approved brief, "Ask again" re-briefs. Wire: `POST /api/forge/brief {request} -> {brief}` (quota kind
"forge", cost constant in costs.ts) and `POST /api/forge {mode:"brief", brief}`.

## Testing strategy
- fast-check: motion offsets bounded by amp and periodic in `1/freq`; `still` gives the identity;
  `validateRig` accepts every in-range motion and rejects each out-of-range field; v2 cut cores
  disjoint for arbitrary named part sets; assembled v2 rigs always valid; `parseBrief` rejects
  malformed answers.
- Golden: Malakor legacy import now carries 13 float layers and 1 pulse; each cast rig loads, poses at
  t = 0 and t = 1.7 s and passes `validateRig`.
- Every seeded fault proven red once (say which in the kiro-log row).
