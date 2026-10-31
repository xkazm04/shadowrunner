# Implementation plan: landing

- [ ] 0. Record the owner's verdict and the chosen variant path here
  - Verdict: _(pending - contest `shadowrunner-cellar-dread`)_
  - Variant id and path: _(pending)_
  - Owner notes (verbatim): _(pending)_
  - Copy the variant into `assets/_incoming/landing-winner/`. Done by the orchestrator, not a builder.
  - _Requirements: 1.1, 1.2_

- [ ] 1. Theme and plates from the winner
  - [ ] 1.1 Update `packages/theme/themes/halloween.json` (and new roles in `roles.json` + `baseline.json`) from the winner's palette and type; theme tests stay green.
  - [ ] 1.2 Move the used plates to `assets/plates/` as WebP, record provenance in `docs/provenance.md`.
  - _Requirements: 2.2, 2.3_

- [ ] 2. Static composition
  - `LandingPage.tsx`, `Room.tsx`, `StatusObjects.tsx` (bound to `usePlane()` and health), `landing.module.css`; register `landing` as `live` in the manifest; holds at 1280x800, 2560x1440 and 390x844.
  - _Requirements: 2.1, 2.4, 3.5_

- [ ] 3. Intro and motion
  - `Intro.tsx` (skip on any key/click, hands over <= 4 s, never yanks navigation), `fx/` lazy effects behind `data-motion`, reduced-motion static twin; component tests with fake timers.
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. Into the creator
  - `Enter.tsx` primary action with choreographed transition to `/creator` and a visible way back; static fallback when WebGL is unavailable.
  - _Requirements: 4.1, 4.2_

- [ ] 5. Guards
  - [ ] 5.1 Playwright visual test (`pnpm test:visual`): both themes, reduced motion, replay plane, 2% tolerance, committed baselines.
  - [ ] 5.2 Lighthouse accessibility >= 90 on the deployed URL, recorded in `docs/kiro-log.md`.
  - _Requirements: 3.4, 5.1, 5.2_
