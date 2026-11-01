# Requirements: rig-core

## Introduction
`packages/rig` owns the **Rig v1** format: the layered 2.5D description of a character's face,
plus the **Look** a user applies to it. It is pure TypeScript with no DOM and no dependencies, so
the renderer, the creator, the forge pipeline and the server all share one definition. It reads
Overlord-era `layers.json` files (Malakor's committed rig) through an importer, so the flagship
character works on day one.

## Requirement 1: The Rig v1 type
**User story:** As every other package, I want one Rig type with exact wire names, so that a rig made by the forge renders in the creator unchanged.

#### Acceptance criteria
1. `packages/rig/src/types.ts` SHALL export `Rig`, `Layer`, `LayerKind`, `Palette`, `Look`, `Emotion`, `Gesture` exactly as in design.md (field names, enum string values, optionality).
2. Optional fields SHALL be omitted when absent, never `null`; the serializer SHALL drop `undefined` keys.
3. `RIG_VERSION` SHALL be the literal `1`.

## Requirement 2: Validation at the door
**User story:** As the creator, I want malformed rigs rejected with a reason, so that a bad forge result never crashes the renderer.

#### Acceptance criteria
1. `validateRig(input: unknown): Result<Rig, RigError[]>` SHALL be the only place external rig JSON is parsed.
2. WHEN a layer's `bbox` falls outside `[0, width] x [0, height]` THEN validation SHALL fail with code `bbox_out_of_bounds` naming the layer.
3. WHEN two layers share a `name` or a `z` THEN validation SHALL fail with `duplicate_name` or `duplicate_z`.
4. WHEN a layer's `follow` names a layer that does not exist, or follows form a cycle THEN validation SHALL fail with `bad_follow`.
5. WHEN a palette value is not `#rrggbb` THEN validation SHALL fail with `bad_color`.
6. Validation SHALL accept every rig produced by `serializeRig` (round-trip property).
7. WHEN the input does not have the shape of `Rig` (not an object, a missing or wrongly typed field, `version` other than `RIG_VERSION`, an unknown `kind`, a `name` not matching `^[a-z0-9_]+$`, a `bbox` or `anchor` that is not a tuple of finite numbers, a non-positive bbox width or height, a `depth` outside `[0, 1]`, or `visible`/`fictional` present with any value other than `false`/`true`) THEN validation SHALL fail with `bad_shape`, naming the JSON path. Shape is checked first; the semantic codes above run only on shape-valid input. (Director amendment 2026-11-01: the code was listed in tasks.md but not defined.)
8. `RigError` SHALL be `{ code, message, layer?, path? }` with `code` one of the six codes above. Validation SHALL collect every error it finds rather than stopping at the first.

## Requirement 3: Import of legacy layers.json
**User story:** As the owner, I want Malakor's existing rig to load, so that the flagship character is on screen from the first build.

#### Acceptance criteria
1. `importLegacyLayers(json, spec?)` SHALL convert Overlord `layers.json` (`rig_type: "glow"`) plus optional `m8.spec.json` colours into a valid `Rig` with `source: "import"`.
2. Legacy kinds SHALL map to `LayerKind` per the table in design.md; unknown kinds map to `accessory` and are reported in a warnings array.
3. The committed asset `assets/characters/malakor/rig/` SHALL import with zero validation errors (golden test).

## Requirement 4: Compositor math
**User story:** As the renderer, I want deterministic per-frame layer transforms, so that animation is testable without WebGL.

#### Acceptance criteria
1. `poseLayers(rig, look, drive): LayerPose[]` SHALL return, per visible layer in `z` order, `{ name, x, y, scale, rotation, opacity, tint }` for a `drive = { t, headYaw, headPitch, jawOpen, blink, gesture? }`.
2. A layer with `follow` SHALL inherit its parent's translation and rotation about the parent's `anchor`.
3. `jawOpen` in `[0,1]` SHALL move only `kind: "jaw"` layers, downward, by at most `0.06 * height`.
4. Parallax: a layer's offset under `headYaw` SHALL scale with its `depth` (0 = background, 1 = nearest) and SHALL be monotonic in `depth`.
5. Layers named in `look.hidden` SHALL be absent from the output.
6. `poseLayers` SHALL be pure: identical inputs give identical outputs (property).

## Requirement 5: Looks
**User story:** As a streamer, I want my customisation saved separately from the rig, so that I can try looks without re-forging.

#### Acceptance criteria
1. `defaultLook(rig)` SHALL return the rig's palette, no hidden layers, `emotion: "neutral"`.
2. `applyLook(rig, look)` SHALL never mutate its inputs (property).
3. `lookToEmotionDrive(emotion)` SHALL return eye-light gain, brow offset and a default gesture for each of the 10 emotions per the table in design.md.
