# Implementation plan: costume

- [x] 0. Record the owner's verdict
  - Verdict (2026-11-01, triage bay rounds r1 and r2): landing R2 C, creator R1 B, forge-new R2 A,
    characters R1 C, daemon R2 C, sealed R1 C, air R2 B. Reference copies in `assets/_incoming/costume/`.
  - Owner notes, round 1 (verbatim): landing "Next round redesign bottom menu items from pumpkins into different theme on main On Air page. We may need small navigation on other pages too for the  content switching"; creator "This page looks great, next round can focus on nested pages. One for new character generation no matter what is implemented now in the app"; characters "TV frames look very basic and thick, we can improve those."; daemon "Rework whole background theme of rotted pumpkins, into more horror/dreadful theme"; sealed "Ok for now, do not include in next round"; air "Similar to daemon lets experiment with different background, remove smoke animation as it does not work well".
  - Owner notes, round 2 (verbatim): characters "no pick, baseline is better". Owner instruction: "proceed with migration into app. We will not start next round".
  - _Requirements: 1.1, 1.2_

- [x] 1. Shared seams
  - [x] 1.1 Fonts and roles: `@fontsource` packages and `font-condensed`, `font-hand`, `font-old`; any roles the channel strip needs; both themes; theme and contrast tests green.
  - [x] 1.2 `forge-new` page in `PAGES`; keymap and router tests; Shell renders a placeholder for it until task 3.
  - [x] 1.3 `ChannelStrip` (frame and stage variants) and `ChannelFrame` using it; component test (current frame lit, daemon-lost lamp, keyboard).
  - [x] 1.4 `lookAt` in `@sr/avatar` with its pure mapping and property test (seeded fault proven red once).
  - _Requirements: 2.1-2.4, 9.1, 9.2, 10.1, 10.2_

- [ ] 2. On air: the lantern slides (landing lane)
  - Port `r2/landing-c.html` per design.md; remove the gourds and pumpkin art; re-baseline the landing visual test.
  - _Requirements: 3.1-3.5, 10.3, 10.4_

- [ ] 3. Forge: anatomy under glass and the rite (creator lane)
  - [ ] 3.1 `/creator` per `r1/creator-b.html`.
  - [ ] 3.2 `/creator/new` per `r2/creator-a.html`, wired to `forgeClient`; handoff to `/creator`.
  - _Requirements: 4.1-4.4_

- [x] 4. Characters: the wall of sets (characters lane)
  - _Requirements: 5.1, 5.2_

- [x] 5. Daemon and Sealed (channels lane)
  - [x] 5.1 CH 6 per `r2/daemon-c.html`.
  - [x] 5.2 CH 9 per `r1/sealed-c.html`.
  - _Requirements: 6.1-6.3, 7.1, 7.2_

- [x] 6. The stage: candles of the catacomb (air lane)
  - _Requirements: 8.1-8.4_

- [ ] 7. Integration
  - Merge lanes, resolve role appends, gates, contrast, landing visual baseline, full-site walk at 1440x900 and 390x844; kiro-log rows and writeup paragraph.
  - _Requirements: 10.5_
