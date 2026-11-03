# Requirements: character-control

## Introduction
The creator's colour controls and the mood dial do almost nothing to the character (owner report,
2026-11-03; scout digest in `.spark/Spark/ideas/character-control.md`). The light swatches multiply
painted eye pixels (red on teal turns to mud), "Mouth light" is read by nothing, non-glowing eyes
ignore colour, the canvas2d fallback ignores every palette term, and the look never leaves the
creator. A mood only scales the eye light and nudges the eye layers by a few pixels; three moods
show nothing at all. This spec makes every control visibly change the character, everywhere the
character appears:

- **Recolour**: lights that swap hue while keeping the painted shading; per-layer colour regions
  found by the forge and recoloured from a Palette card or by clicking the glass.
- **Reshape**: per-part size, stretch, offset and tilt from a Shape card.
- **Moods**: a procedural layer for every rig (held head tilt and pitch, squint, brows, jaw set,
  glow) plus six expression families with real faces cut from image edits, generated in every live
  forge and retrofitted offline to all fourteen recorded characters after an owner verdict.
- **Reach**: "Put on air" puts the creator's active character, with its look, on CH 2 and the
  stage; the daemon's reply emotions drive its faces.

Rig stays version 1: every new field is optional and additive; an existing rig renders exactly as
before when a look carries none of the new values.

## Requirement 1: Recolour that keeps the painting
**User story:** As a streamer, I want a colour I pick to become that colour on the character, so
that red eyes are red, not a muddy mix of red and the painted teal.
1. The eye, glow and mouth lights SHALL recolour by replacing hue and saturation while keeping each
   pixel's lightness (design "Recolour"); a near-grey source gets the saturation floor so a change
   shows. The rim light stays an additive edge light, raised to a visible strength.
2. The eye light SHALL apply to every `eye` layer, emissive or not.
3. The mouth light SHALL recolour the jaw region slot named `cavity` when the rig has one, and
   Malakor's mouth-glow layer (`aperture_glow` legacy lineage); otherwise it has no effect, and the
   Palette card says so.
4. The canvas2d fallback SHALL render the same recolour as the GL renderer (pixel test, tolerance
   in design).

## Requirement 2: Colour regions
**User story:** As a streamer, I want to recolour the robe, hood or crown on their own.
1. A layer MAY carry `regions`: an index map (same size as the layer image) and at most 4 slots,
   each with an id, a name and the region's dominant colour.
2. The forge SHALL find regions offline and live with no model call (design "Regions"),
   deterministically: the same layer gives byte-identical maps.
3. `Look.regions` maps `<layer>/<slot>` to a colour; the renderer recolours that region with the
   requirement 1 rule. An absent key draws the region as painted.
4. The Palette card SHALL list every region by part with its colour chip; clicking a region on the
   glass SHALL select it and outline it.

## Requirement 3: Reshape
**User story:** As a streamer, I want to make the crown bigger, the eyes wider apart or the horns
taller.
1. `Look.shape` maps a layer name to a `PartShape` (size, stretch x/y, offset x/y, tilt), each value
   clamped to the design's ranges; followers inherit their parent's shape.
2. The Shape card SHALL edit the selected part's six values with sliders, with "Reset part" and
   "Reset all"; selection comes from the Layer stack or a click on the glass.

## Requirement 4: Moods that show
**User story:** As a streamer, I want each of the ten moods to look different at a glance.
1. Every emotion SHALL drive at least three pose channels on a rig with a head and eyes: held head
   tilt and pitch, eye squint, brow lift (brow layers when the rig has them, else the eyes as
   today), jaw set and glow gain, per the design's table; the effect is held while the emotion is
   on, not a 0.4 s pulse.
2. The ten emotions SHALL map to six expression families plus neutral (design `EMOTION_FAMILY`). A
   layer MAY carry `variants`: per family, a patch image that is drawn over or replaces the layer's
   pixels while that family is on.
3. A change of emotion SHALL crossfade the procedural values and the faces over 250 ms; with
   reduced motion the change is instant.
4. Blink, jaw drop, glow and motion SHALL keep working on a variant (it is the same named part).

## Requirement 5: Expressions in the forge
**User story:** As a streamer, I want my new character to arrive with its faces.
1. A live forge job SHALL run one image edit per family after assembly (six steps), cut each
   family's variants inside the face mask only, and record per family `ok`, `skipped` or `failed`.
   A failed edit, a spent budget or a drift over the limit skips that family; the forge never fails
   because of expressions.
2. The global daily spend cap default SHALL be 30 USD (`SR_DAILY_USD_CAP` still overrides); the
   per-visitor forge quota is unchanged and a forge counts once.
3. The offline tool SHALL produce the same variants from Codex edits, and the fourteen recorded
   characters (Malakor, the five presets, the eight cast) SHALL carry regions and the variants that
   passed the owner's verdict; a family the owner rejects twice ships procedural only.
4. The rite SHALL show the expression steps ("Expressions n / 6"; a skipped family reads
   "procedural").

## Requirement 6: The look goes on air
**User story:** As a streamer, I want the character I dressed to be the one on air.
1. "Put on air" SHALL record the active character (`sr.onAir`); CH 2's live tube and the stage SHALL
   show that character with its saved look, Malakor when none is recorded or it is gone.
2. On air, the reply's emotion SHALL drive the same procedural values and faces.

## Requirement 7: Integration
1. Gates green (`pnpm typecheck && pnpm lint && pnpm test`), 400-line cap, tokens only in CSS,
   reduced-motion twins, each file keeps its own line endings.
2. Replay plane: every recorded character's regions and variants are committed assets; a judge sees
   them with no keys.
3. `docs/rig-format.md`, the rig-core, avatar-renderer, forge-pipeline and creator designs are
   amended; `docs/provenance.md` records every expression edit; `docs/kiro-log.md` gets one row per
   task.
