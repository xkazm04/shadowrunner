# Requirements: cast-forge

## Introduction
Arch-Lich Malakor is the only character in the app with a rig good enough to be a live 2.5D co-host:
13 crown shards that float on their own, a monocle that pulses, a jaw with light behind it. The five
presets are a coarser forge cut. On 2026-11-02 the owner ran a character contest (two seats, 20
characters, three art styles each) and advanced **eight characters, one style each**. This spec turns
those eight into Malakor-class rigs, **one at a time**, and turns what each one teaches into product
code. When the spec is done, the same path runs in the app for a streamer's own character: a vague
request becomes a detailed character brief, the streamer approves it (the handshake), and the portrait
is decomposed into customisable parts the way Malakor is.

The eight (portrait and brief staged in `assets/characters/cast/<slug>/`, contest record in
`.contest/Contest/contests/supporting-cast.md`, which is git-ignored):

| slug | character | chosen style |
|---|---|---|
| `saint-cardia` | Saint Cardia of the Glass Heart | Faceted gothic painting |
| `vicar-of-the-lure` | Vicar of the Lure | Leaded stained glass |
| `the-tallyman` | The Tallyman | Low-poly 3D |
| `reveille` | Reveille, the Alarm of the Ninth | Smoked brass and neon |
| `lot-ninety` | Lot Ninety, the Auctioneer | Art nouveau poster |
| `auntie-asp` | Auntie Asp, Keeper of the Stone Stacks | Art nouveau poster |
| `the-redactor` | The Redactor | 16-bit pixel art |
| `sir-vacant` | Sir Vacant | Naive heraldic miniature |

Owner pattern from the verdict: every advancing style is hard-edged (lead lines, polygon planes, flat
fills with ink outlines, pixels). The edges in the art are the cut lines.

## Requirement 1: Motion the format can carry
**User story:** As a streamer, I want floating and pulsing parts to move on their own, so that the
character is alive between lines and Malakor's shards stop being frozen.
1. A rig layer MAY carry an optional `motion` with `float` (a bob and sway: amplitude x/y in canvas px,
   frequency in Hz, rotation in degrees, phase) and/or `pulse` (a light-gain oscillation: amplitude,
   frequency, phase). Absent `motion` behaves exactly as today. The field is additive: Rig stays
   version 1; every existing rig and test stays valid.
2. `validateRig` checks `motion` ranges and reports every error; `serialize` omits it when absent.
3. `poseLayers` applies motion as a pure function of `t` (deterministic, no randomness), after the
   follow chain, so a floating part still follows its parent's gestures. Reduced motion sets float and
   pulse amplitude to 0.
4. Legacy import keeps Malakor's float and pulse curves (`m8.spec.json` / `layers.json`) instead of
   dropping them; Malakor's shards float in the app.

## Requirement 2: Named parts beyond the fixed ten
**User story:** As a builder of a character, I want to name the parts the character actually has (a
lure, six eyes, two gloves, a heart, a black bar), so that each one can be cut, moved and customised.
1. A parts file MAY list named parts, each with a **role** from the forge's ten part names plus
   `float` and `pulse`, a polygon, and optional motion and follow. The ten-name format stays valid.
2. The cut supports any number of named parts (cap stated in design), in a stated front-to-back
   order, with disjoint cores; floating parts are cut out of the plate and the plate behind them filled.
3. `assembleRig` maps roles to layer kinds, writes motion into the rig, and the result always passes
   `validateRig`.

## Requirement 3: The eight characters as rigs, one at a time
**User story:** As the owner, I want each chosen character on the replay plane as a living rig, so that
I can review it in the morning and a judge can open it with no keys.
1. Each character has, in `assets/characters/cast/<slug>/`: `portrait.png`, `brief.json`, `parts.json`
   (named parts, the decomposition), a fill plate when an edit was used, and a `NOTES.md` that names
   what was hard and what was turned into code.
2. Each character has a replay job (`assets/replay/forge/<slug>/`) built offline by the real pipeline,
   and a review sheet in `var/cast-forge/<slug>.png`: portrait, rig at rest, jaw open, head turned left
   and right, motion at two phases.
3. A character is done only when its review sheet shows no hole, ghost edge or orphaned fragment at
   any pose, every part named in its parts file is its own layer, and its float/pulse parts move.
4. **Hardening:** whatever a character needed by hand that a streamer's character would also need
   becomes code in `packages/forge` (with a test proven red once) or a rule in the decomposition
   prompt, and is recorded in `docs/cast-forge-ledger.md`. The next character starts from that code.

## Requirement 4: The brief and the handshake
**User story:** As a streamer, I want to type a vague idea and see a detailed character brief I can
approve or edit before anything is drawn, so that the portrait matches what I meant and can be cut.
1. A brief step turns a vague request (<= 400 chars) into a `CharacterBrief` (the shape of the staged
   `brief.json`: name, archetype, persona hook, accent, silhouette, parts plan with roles and motion,
   style, portrait prompt) through one LLM call with an exact prompt in design.md; the result is
   schema-validated, never trusted raw.
2. The portrait prompt built from a brief carries the rig-fitness rules (frontal centred bust, empty
   near-black ground, jaw and eyes visible, every planned part a separate shape) and the owner's
   hard-edge style rule.
3. `/creator/new` shows the brief for approval: the streamer can edit name, style and parts, or ask
   again; only an approved brief starts the portrait. On the replay plane the eight characters' one-line
   requests return their recorded briefs, with the RECORDED label.
4. The decomposition step in a live forge job uses the approved brief's parts plan to ask for named
   parts (requirement 2), so a streamer's character gets the same anatomy the eight got.

## Requirement 5: Integration
1. Gates green (`pnpm typecheck && pnpm lint && pnpm test`), 400-line cap, tokens only in CSS,
   reduced-motion twins.
2. The eight appear in the creator gallery and the CH 4 listings as cast members.
3. `docs/provenance.md` records each portrait (Codex CLI image generation, 2026-11-02, contest entry)
   and each fill edit; `docs/kiro-log.md` gets one row per task.
