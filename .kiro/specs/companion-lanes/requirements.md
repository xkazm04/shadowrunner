# Requirements: companion-lanes

## Introduction
The owner asked (spark `companion-lanes`, 2026-11-10) to prove the avatar tech reaches two practical
lanes beyond the Halloween cast: a realistic AI companion and an anime avatar, "higher quality
characters comparing to our current animated shapes", for virtual assistants and AI streamers. From
ten Codex concepts the owner picked **Iris** (photoreal, silver bob, headset) and **Bun** (anime,
pink hair, cat-ear headphones). Owner doctrine: redesign and experiment where the tooling reaches
its limits; Opus builders; iterate until the control is complete and without defects.

The scouts measured that the cast pipeline cannot carry these portraits: polygon cuts keyed against
near-black ground, a per-character hand recipe, a mouth that opens onto a flat toothless slot, a
blink that cross-fades a lid patch. The experiment that decides the design: Codex edits of the
portrait with one thing changed (eyes closed, mouth open, a smile) come back aligned with the source
to about 0.3 px on both portraits, identity intact. So the lane keeps the face whole and animates
it with **morph keys**: aligned repaints blended by weights, with a motion field where the art has
texture to follow.

Global rules: the three gates stay green; no behaviour change for a rig without `morph`; the replay
plane needs no keys, no GPU service and no login; secrets never reach the bundle; tokens only in
CSS; 400-line file cap; reduced motion honoured; every generated asset has a provenance row.
Builder: Claude Opus subagents (owner's instruction); the Director reviews, gates and logs.

## Requirement 1: Morph keys in the rig
1. `Rig.morph` (optional) SHALL describe the keys of one head layer as declared in
   `packages/rig/src/types.ts` (`RigMorph`, `MorphKey`, `MorphTrack`, `MorphSway`); the rig stays
   version 1 and a rig without it validates, serialises and renders exactly as before.
2. `validateRig` SHALL reject a malformed `morph` with a message naming the field (unknown layer or
   a layer that is not a visible head, duplicate id, unknown track, `at` outside (0, 1], a box
   outside the canvas, `flowCell` without `flow` or `flowMax`, more than 40 keys or 4 stops).
3. Every list of a rig's files (pack `rigFiles`, the web app's, the avatar's) SHALL include
   `morph.atlas`, `morph.flow` and `morph.sway.map`, so packs and loaders carry them.

## Requirement 2: The morph plan
1. A pure function in `@sr/rig` SHALL turn the frame's blink, gaze, mouth-shape weights and
   expression faces into one weight per key, by the stop rule of design "Tracks".
2. Mouth-shape weights above a total of 1 SHALL be normalised; `rest` is the remainder.
3. The plan SHALL list at most 8 active keys (weight > 0.002), lowest weights dropped first, in
   compositing order: expression faces, gaze, mouth, blink.

## Requirement 3: Rendering
1. The WebGL renderer SHALL draw the morph layer by design "Shader": the layer's pixels displaced by
   the weighted sum of the active keys' motion, each key's colour blended in by weight and coverage,
   a later group over an earlier one. At weight 1 of a single key the key's cell is reproduced
   (within the image codec's error) inside its coverage; at weight 0 the frame equals the frame
   without `morph`.
2. The morph layer SHALL keep everything the base pass gives a head layer: opacity, recolour
   regions, rim, depth turn bend and light, dim, glow source.
3. `MorphSway` SHALL displace loosely hanging pixels by the spring's lag (design "Sway"), zero under
   reduced motion.
4. The Canvas 2D fallback SHALL draw each active key as a patch at its weight (no motion field).
5. A morph rig SHALL need no jaw, eye or iris layer: its mouth mode is `"morph"`, the gaze driver
   runs when the rig has gaze tracks, the turn's face comes from `morph.eyes`, breathing runs.

## Requirement 4: The portrait builder
1. `tools/portrait-keys` SHALL build a character folder from a 1024 px portrait, its edits and a
   recipe by one command (design "Builder"): soft-matted layers on a transparent ground, the key
   atlas, the motion image, `job.json` with a rig that validates, and a report of every gate figure.
2. Each edit SHALL be registered to the portrait and gated: an edit that moved more than the gate
   allows, or changed the picture outside its region by more than the editor's noise floor plus the
   margin, is refused by name; the build fails unless the recipe marks the key optional.
3. Each key's colour SHALL be matched to the portrait at its coverage edge (low-frequency
   correction), so a key at any weight shows no patch outline.
4. The builder SHALL write, per key, a review strip of the morph at 0, 0.25, 0.5, 0.75 and 1 computed
   with the shader's own math, and one contact sheet per character.

## Requirement 5: Iris and Bun
1. Both characters SHALL ship as built folders under `assets/replay/companions/<slug>/` with their
   sources under `assets/characters/companions/<slug>/` (portrait, recipe, edits, notes), each with
   blink (two stops), the seven mouth shapes, the six expression faces and four gaze keys, unless a
   key is refused three times; a refused key is listed in the character's notes.
2. `scripts/build-packs.mjs` SHALL pack them into `/packs/` and its index, so the studio, the embed,
   the overlay and the lab load them by slug, and the creator imports them.
3. Neither joins the committed Halloween cast (briefs, shows, listings): the cast's tests keep their
   counts.

## Requirement 6: Control and proof
1. A capture page and script SHALL render any pack at a stated state (track weights, emotion, gaze,
   yaw, pitch, time) through the real WebGL player to PNG, headless.
2. Tests SHALL cover: the plan (stops, normalisation, the cap, ordering), validation, the shader's
   two fixed points (weight 0 and weight 1), the pack round trip of a morph rig, and an end-to-end
   render of both characters with a pixel check that the ground is transparent outside the figure.
3. The creator SHALL load both characters and every control that applies to them SHALL work
   (emotion, look, reshape, face profile, hide); a control that cannot apply is not shown.
4. `docs/rig-format.md` SHALL document `morph`; `docs/provenance.md` SHALL list every generated
   image; `docs/kiro-log.md` SHALL log each task and its builder.
