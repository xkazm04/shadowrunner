# Implementation plan: rig-core

- [x] 1. Contract types and Result
  - Write `packages/rig/src/types.ts` and `result.ts` exactly per design.md "Data model"; write `docs/rig-format.md` describing the same fields in prose and a JSON example.
  - _Requirements: 1.1, 1.3_

- [x] 2. Serialize and validate
  - [x] 2.1 Write fast-check arbitraries for valid `Rig` values (`src/__tests__/arb.ts`).
  - [x] 2.2 `serialize.ts` (drop undefined, stable key order) with a test that no `null` ever appears.
  - [x] 2.3 `validate.ts` with codes `bbox_out_of_bounds`, `duplicate_name`, `duplicate_z`, `bad_follow`, `bad_color`, `bad_shape` (defined in requirement 2.7); round-trip property; one fault-seeding property per code.
  - [x] 2.4 `packages/rig/src/index.ts` re-exports `types`, `result`, `serialize` and `validate` (the public surface of `@sr/rig`), replacing the stub export.
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 3. Legacy import and Malakor golden
  - [x] 3.1 Copy Malakor's rig into `assets/characters/malakor/rig/` from `assets/_incoming/malakor-rig/` (the orchestrator stages it there; record provenance in `docs/provenance.md`).
  - [x] 3.0 Hardening from the task 2 review (in `validate.ts`, with a fault property each): `parseRigJson(text: string): Result<Rig, RigError[]>`, the only `JSON.parse` of rig text, reporting malformed JSON as `bad_shape` at path `$`; `bad_shape` when `width`/`height` are not positive integers; `bad_shape` when a layer `file` is not a relative POSIX path inside the rig folder (no leading `/`, no `..` segment, no `:` scheme, no backslash, not empty, no empty segment), with exactly one exception: a value starting `data:image/png;base64,` (forge output per design.md) is accepted (director decision 2026-11-01); `bbox_out_of_bounds` uses a 1e-6 tolerance on the right and bottom edges.
  - [x] 3.2 `legacy.ts` per the mapping table; warnings for unknown kinds. Keep a legacy layer's measured `depth` when it is a number in `[0, 1]` (Malakor's per-layer depths drive the parallax), otherwise fall back to the kind default with a warning (director decision 2026-11-01). `index.ts` re-exports `legacy.ts`. `docs/rig-format.md` states `parseRigJson`, positive-integer `width`/`height`, the file-path rules and the 1e-6 right/bottom tolerance.
  - [x] 3.3 Golden test: imports with 0 errors, 18 layers, palette from `m8.spec.json`.
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Pose math
  - [x] 4.1 `pose.ts` per design.md (parallax, follow, jaw, blink, gesture curves, clamps).
  - [x] 4.3 (from the task 4 review) Apply the 2026-11-01 rulings in requirements 4.3/4.4 and design.md "Pose": jaw drop capped in canvas px under gestures, not inherited by jaw followers; follower parallax from own depth only. Strengthen the properties: jaw bound under any gesture, non-jaw followers of a jaw unchanged by `jawOpen`, cross-layer parallax monotonicity over all layers including followers. Re-export `pose.ts` from `index.ts`; document `Drive`, `LayerPose` and `GESTURE_DURATION_S` in `docs/rig-format.md`.
  - [x] 4.2 Properties: purity under deep-freeze; parallax monotonic in depth; jaw moves only jaw layers; hidden layers absent; followers keep relative offset at yaw 0.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. Looks
  - `look.ts`: `defaultLook`, `applyLook`, `lookToEmotionDrive` (table in design.md); non-mutation property; table test covers all 10 emotions.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Public surface for looks (director follow-up from the task 5 review)
  - Re-export `look.ts` from `packages/rig/src/index.ts` and extend the "public surface" test.
  - Document `EmotionDrive`, `applyLook` (returns a new `Rig`: the look's palette, `visible: false` on hidden layers) and the brow unit (signed table steps; the renderer maps one step to 0.004 * height px) in `docs/rig-format.md`.
  - Gesture precedence: add `resolveGesture(look): Gesture | undefined`, which returns `look.gesture` when set, otherwise the emotion's default from `lookToEmotionDrive`. Table test plus one property.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 7. Malakor's palette (director ruling from the avatar lane, 2026-11-01)
  - `importLegacyLayers` maps the m8 spec colours so the renderer reproduces the art: `eye` and `glow` from the eye light (`colors.mouth`, teal; measured `#a8ebd0` on the portrait), `rim` from `colors.line_core` (the orange monocle line). Update the golden; the WebGL2 bench must show teal eyes (avatar-renderer 7 re-shoots).
  - _Requirements: 3.3_
