# Implementation plan: avatar-renderer

- [x] 1. Driver state and step (pure)
  - [x] 1.1 `driver/rng.ts`, `driver/state.ts` (types, named constants, `initialState(seed)`).
  - [x] 1.2 Write fast-check arbitraries for input sequences and the properties from design.md (blink gaps, ranges, reduced-motion zero drift, purity) before the implementation.
  - [x] 1.3 `driver/step.ts`: blinks, drift, micro-saccades, gaze easing, gesture start/replace, jaw attack/release from `level`.
  - [x] 1.4 `driver/drive.ts`: `toDrive` folding gaze + drift + saccade into `headYaw`/`headPitch`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 5.1, 5.2_

- [x] 1.5 Follow-ups from the task 1 review (director, 2026-11-01)
  - Import rig as `@sr/rig`: add `"@sr/rig": "workspace:*"` to `packages/avatar/package.json`, switch every `../../../rig/src/...` import, and add an eslint `no-restricted-imports` rule (in `eslint.config.js`) that bans relative imports reaching into another workspace package's `src/` from any package or app, with a gate fixture in `scripts/gate-fixtures/` so `pnpm test:gates` covers it.
  - Reduced-motion toggle: when `reducedMotion` flips mid-session, drift and saccade amplitude ease to the new level over 400 ms instead of jumping (property: no frame-to-frame yaw change above the full-motion maximum step at the toggle).
  - (`blinkDuration` is now in design.md "Contracts"; nothing to do.)
  - _Requirements: 3.3, 5.1_

- [x] 2. Audio level tap
  - `audio/level.ts`: `attachAudio` with an AnalyserNode, RMS per frame clamped to [0, 1], `detach()`; unit test with a fake AudioContext.
  - _Requirements: 4.1_

- [ ] 3. WebGL2 renderer
  - [ ] 3.1 Counting WebGL2 stub for tests (`src/__tests__/glStub.ts`).
  - [ ] 3.2 `gl/context.ts`, `gl/programs.ts` (base + glow shaders).
  - [ ] 3.3 `gl/layers.ts`: one texture per layer uploaded in `setRig`, one quad per `LayerPose`, premultiplied alpha, rim and eye-gain uniforms.
  - [ ] 3.4 `gl/glow.ts`: half-res extract, separable blur, additive composite tinted by `palette.glow`.
  - [ ] 3.5 `gl/renderer.ts`: `createRenderer`, `setLook` without context recreation, `dispose` frees everything; exact-count test (draws = visible layers + 4 per frame, uploads once).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.1, 7.2_

- [ ] 4. Canvas2D fallback and context loss
  - `canvas2d/renderer.ts` with the same interface; `createRenderer` falls back when `webgl2` is null or throws, and on `webglcontextlost`; test via stub that `info().mode === "2d"`.
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 5. React wrapper
  - `react/AvatarCanvas.tsx`: owns canvas, renderer, driver, rAF loop; `drive` override; reads `prefers-reduced-motion` and `[data-motion]`; gesture prop edge-triggers; cancels loop and disposes on unmount. Test with React Testing Library + the GL stub.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 5.3_

- [ ] 6. Bench page
  - `apps/web/bench/avatar.html` + `avatar.ts`: Malakor idle 10 s, prints median/p95 frame time and `info()`; excluded from the app bundle. Record the measurement in `docs/kiro-log.md`.
  - _Requirements: 7.3_
