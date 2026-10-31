# Requirements: landing

## Introduction
**Blocked on the owner's verdict** in the landing contest `shadowrunner-cellar-dread` (arena
`.contest/arena/shadowrunner-cellar-dread/`, local to the owner's machine and not in the repo).
Two seats built three variants each of The Cellar Exchange pushed toward dread and photoreal
material, each with the avatar creator as a nested layer. This spec promotes the chosen variant
into the app: the landing a stranger arrives at, leading into the creator in one action, and the
halloween theme values taken from it. The variant is a static prototype; the port is a rewrite into
React and CSS Modules on role tokens, not a copy.

## Requirement 1: Record the verdict
**User story:** As a builder, I want the chosen variant named in the spec, so that I port the right thing.

#### Acceptance criteria
1. Task 0 SHALL record the owner's verdict, the variant id and its path, and any owner notes verbatim, before any other task starts.
2. The chosen variant's `index.html`, `NOTES.md` and assets SHALL be copied to `assets/_incoming/landing-winner/` (reference only, never imported by the app).

## Requirement 2: Port to the app
**User story:** As a visitor, I want the landing to feel as dreadful and real as the prototype, so that the first three seconds sell the product.

#### Acceptance criteria
1. `apps/web/src/landing/` SHALL render the winner's composition in React + CSS Modules, consuming role tokens only (stylelint green).
2. The halloween theme values in `packages/theme/themes/halloween.json` SHALL be updated from the winner's palette and type; the baseline theme SHALL still bind every role.
3. Plates and textures the winner uses SHALL move to `assets/plates/` with provenance (generator, model, date, prompt) in `docs/provenance.md`, and SHALL be labelled stylised wherever presented.
4. Every status element in the landing (on air, engine status) SHALL read the real plane/health state, not a fake toggle; the sample-state toggle MAY remain on replay only, labelled.

## Requirement 3: Intro, motion and access
**User story:** As any visitor, I want control within seconds and a calm version when I ask for it.

#### Acceptance criteria
1. The intro SHALL be skippable by any key or click and SHALL hand over control within 4 s.
2. WHEN `prefers-reduced-motion: reduce` THEN the landing SHALL render a static composition with no flicker or camera moves.
3. The intro SHALL end where the visitor navigated, never yanking them back (Overlord trap).
4. Lighthouse accessibility SHALL score >= 90 on the deployed landing; working text >= 14 px equivalent with AA contrast.
5. The composition SHALL hold from 1280x800 to 2560x1440 and at 390x844 without clipping or overlapping the corner controls.

## Requirement 4: Into the creator
**User story:** As a streamer, I want one action from the landing to forging my co-host.

#### Acceptance criteria
1. The landing SHALL offer one primary action that opens `/creator` with a choreographed transition and a visible way back.
2. WHEN JavaScript fails to load WebGL THEN the landing SHALL fall back to the static plate composition with the same action.

## Requirement 5: Screenshot test
**User story:** As the owner, I want both themes guarded, so that a token change cannot silently ruin the first frame.

#### Acceptance criteria
1. A Playwright screenshot test SHALL capture the landing at 1600x900 in `halloween` and `baseline` themes, reduced motion, on the replay plane, and compare against committed baselines with a 2% pixel tolerance.
2. The test SHALL run in `pnpm test:visual` (not in the default `pnpm test`), and CI SHALL run it.
