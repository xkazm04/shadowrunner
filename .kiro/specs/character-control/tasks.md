# Implementation plan: character-control

- [x] 0. Wire types and constants (director)
  - `types.ts` (ExpressionFamily, LayerPatch, RegionSlot, LayerRegions, PartShape; optional
    `Layer.variants`, `Layer.regions`, `Look.regions`, `Look.shape`), `control.ts` constants with
    working `clampShape`/`isIdentityShape`/`regionKey`, `Drive.mood`, `LayerPose.faces`, forge
    `ForgeStatus` "expressing" and `JobView.expressions`; gates green with no behaviour change.
  - _Requirements: 7.1_

- [x] 1. Rig: moods, faces, reshape, validation (packages/rig)
  - Extended `EMOTION_TABLE` and `EmotionDrive`; held procedural values in `poseLayers` (tilt,
    pitch, squint, jaw set, glow gain, brow layers or the eye fallback); `Drive.mood` crossfade;
    `LayerPose.faces`; `Look.shape` applied before the follow chain; `validateRig` checks variants
    and regions (files, bbox inside the canvas, 1..4 slots, ids, hex, family keys) and reports every
    error; `serialize` omits absent fields; `readLook`-style validation of `Look.regions`/`shape`
    exported for the web; docs/rig-format.md and rig-core design amended.
  - Tests: an untouched rig poses identically to before (snapshot of all ten emotions on Malakor's
    v1 rig BEFORE the change, compared after: only the new columns may differ, so the snapshot is of
    a look with neutral); each emotion moves >= 3 channels on a fixture with brow layers; followers
    inherit shape; crossfade endpoints; reduced motion.
  - _Requirements: 3.1, 4.1-4.4_

- [ ] 2. Renderer: recolour, regions, faces (packages/avatar)
  - `render/recolour.ts`; GLSL recolour in the layer program; index-map textures and a 4-slot
    colour uniform; mouth light on `cavity` and `mouth_glow`; eye light on every eye layer; rim 0.6;
    face patches with the replace/over rule; canvas2d parity via an offscreen cache; textures for
    maps and patches loaded with the layer's own, lazily for patches (a face appears when loaded).
  - Tests: red on teal eyes is red (hue within 10 degrees) in GL (headless gl or the existing GL
    test harness) and canvas2d; non-emissive eyes recolour; GL vs canvas2d within 3/255; a look
    equal to the rig draws pixel-identical to before; a replace patch hides its base.
  - _Requirements: 1.1-1.4, 2.3, 4.2_

- [x] 3. Forge: regions and expressions (packages/forge, api/_lib, scripts/cast)
  - `regions.ts`, `expressions.ts` exactly as design; live `"expressing"` steps in
    `api/_lib/forge-steps.ts` (charged, skip on failure, budget or drift); `costs.ts`
    `expression`; `DEFAULT_LIMITS.dailyUsd` 30; replay `STATUS_ORDER`; regions computed in the live
    assemble step; `scripts/cast/regions.mjs`, `scripts/cast/expressions.mjs`; forge-pipeline
    design and the ledger amended.
  - Tests: regions deterministic (golden SHA-256 of the maps for three committed layers);
    `cutVariants` leaves every pixel outside the mask equal to the base; drift flag; a live job whose
    budget runs out at family 3 finishes `done` with families 3-6 `skipped`; the prompt text pinned.
  - _Requirements: 2.1-2.2, 5.1-5.3_

- [ ] 4. Web: Look tab, Palette, Shape, glass pick, on air (apps/web)
  - As design "Creator UI" and "On air"; library persistence of `regions`/`shape`; rite
    expression progress; creator design amended.
  - Tests (DOM): tabs keyboard-reachable; region chip recolours (reducer state); glass pick selects
    the right layer and slot on a fixture; shape sliders clamp and persist; reset; on air loads the
    stored record with its look and falls back to Malakor; reduced-motion twins.
  - _Requirements: 2.4, 3.2, 5.4, 6.1-6.2_

- [ ] 5. Retrofit and verdict (director, offline)
  - Regions for the fourteen; 6 Codex expression edits per character; the owner's verdict page (7
    faces each in the real renderer); one re-edit per "redo"; commit; provenance; kiro-log rows.
  - _Requirements: 5.3, 7.2, 7.3_
