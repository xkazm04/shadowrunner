# Implementation plan: landing

- [x] 0. Record the owner's verdict and the chosen variant path
  - Verdict: the owner chose **The Harvest Floor** on 2026-10-31. The contest family:
    1. `shadowrunner-cellar-dread`: Dead Air won.
    2. Round 2: Root Cellar won.
    3. `shadowrunner-root-cellar-r4`: A/1 won.
  - Variant id and path: `shadowrunner-root-cellar-r4` A/1. Reference copy in `assets/_incoming/landing-winner/`.
  - Owner notes (verbatim): "1 is the winner (.../shadowrunner-root-cellar-r4/entries/claude-claude-opus-5-5_xhigh/variant-1), scope it into plan so the Kiro will follow this design."
  - Round 4 brief (verbatim): "1. Menu bottom bar 2. column with title/description/on air sign - I would delete whole column and move stats into top header row. Then we can have more space to redesign other idea 3. TV screen does not fit angle of generated image very well"
  - _Requirements: 1.1, 1.2_

- [ ] 1. Tokens, fonts and plates
  - [ ] 1.1 Add the new roles (design.md "Tokens") to `roles.json`, `halloween.json` (values from the reference) and `baseline.json`; theme and contrast tests stay green. Add contrast pairs for the new roles: `paper-ink` and `paper-ink-signal` on `paper` at 4.5:1 (16 px chat text, not the 3:1 large-label rule that `signal-*` uses), and `phosphor` text on the glass at 4.5:1.
  - [ ] 1.2 Self-host Barlow Semi Condensed, Inter and Courier Prime through `@fontsource`, and bind them to `font-display`, `font-body` and `font-type`.
  - [ ] 1.3 Convert the stills used (`cellar-wide`, `crt-frontal`, `root-pile`, `root-eye`, `paper`) to WebP under `assets/plates/`, each at most 300 KB at 1920 wide. Provenance is already in `docs/provenance.md`.
  - _Requirements: 4.1, 9.5, 9.6_

- [ ] 2. Manifest channels and keymap (amends m0-spine)
  - Add `channel` and `subtitle` to `PageDef`. Add the `daemon` and `sealed` pages and the channel table from design.md. Keys `2 3 4 6 9`, `←`/`→`, `Esc` and `D` (replay only) are derived from the manifest. Keymap test.
  - _Requirements: 5.3, 8.1_

- [ ] 3. World and room (static)
  - `World.tsx` (1600x900 scale-to-fit, 420x910 portrait below 0.78), `Room.tsx`, `Spiral.tsx` and `Eye.tsx` without motion. The composition matches `R4-1-1600x900-load.png` and `R4-1-390x844-load.png`.
  - _Requirements: 4.1, 4.2, 4.3, 9.1_

- [ ] 4. Status bar
  - `StatusBar.tsx` bound to `usePlane()` and health: ON AIR lamp, viewers, channel, live-since clock or dead-air timer, daemon pill. Component test for both health states.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 5. The set and the glass
  - [ ] 5.1 `superellipse.ts` with its property test.
  - [ ] 5.2 `Set.tsx` and `Glass.tsx`: CRT plate, superellipse clip, `<AvatarCanvas>` inside, phosphor grade, glare, rim shadow, lower third, hover caption. Requires `avatar-renderer`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 6. Gourds and legend
  - `Gourds.tsx`: five channel buttons cut from `root-pile` with carved numbers (AA contrast) and labels, burn and ember states, hover and focus writing on the glass, legend box.
  - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [ ] 7. Chat strip
  - `ChatStrip.tsx` with `chatScript.ts` (replay lines from the reference), typed in line by line, with a top fade mask that never renders under the header. On live, reads the engine stream once `voice-and-air` lands.
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 8. Daemon lost and motion
  - [ ] 8.1 `daemon.ts` state table with fake-timer tests (fast-check over health sequences).
  - [ ] 8.2 Choreography: fold to dot, NO CARRIER, gourds going out one by one, the eye that keeps burning and follows with no lag, relight sweep.
  - [ ] 8.3 `fx/` dust, flicker and typing as a lazy chunk behind `data-motion`; the reduced-motion static twin; an intro that can be skipped within 4 s and never pulls the visitor back.
  - _Requirements: 4.4, 4.5, 7.1, 7.2, 7.3, 7.4, 9.2, 9.3_

- [ ] 9. Channels behind the set
  - `ChannelFrame.tsx` ("Back to the set · Esc", breadcrumb), CH 4 `Listings.tsx`, CH 6 `Daemon.tsx`, CH 9 sealed door, all matching `screenshots/ch-*.png`. CH 3 is restyled by `creator` task 8.
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 10. Guards
  - [ ] 10.1 Playwright visual test (`pnpm test:visual`): 1600x900 in both themes, 390x844 in halloween and daemon-lost at 1600x900, all with reduced motion on the replay plane, 2% tolerance, baselines committed.
  - [ ] 10.2 Lighthouse accessibility of 90 or more and a first load of 2 MB or less on the deployed URL, recorded in `docs/kiro-log.md`.
  - _Requirements: 9.4, 9.5, 10.1, 10.2_
