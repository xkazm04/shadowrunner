# Implementation plan: cast-forge

- [x] 0. Record the owner's verdict and stage the eight
  - Verdict (2026-11-02, Casting Call artifact): advance A/2 style-2, A/3 style-3, A/4 style-1, A/6 style-3,
    A/9 style-2, A/10 style-3, B/6 style-3, B/10 style-2; the twelve others failed in every style, no notes.
  - Staged by the director: `assets/characters/cast/<slug>/portrait.png` (1024 px from the 1254 px render)
    and `brief.json` (the seat's character.json with the chosen style only, plus provenance).
  - _Requirements: 3.1_

- [x] 1. Motion in the rig format
  - `Motion` on `Layer`, validate, serialize, `poseLayers`, legacy import keeps Malakor's curves, avatar
    renderer (GL and canvas2d) shows float and pulse, reduced motion still; rig-format.md and rig-core
    design amended. Malakor's shards float in the app.
  - _Requirements: 1.1-1.4_

- [x] 2. Named parts and the offline tool, proven on `saint-cardia`
  - [x] 2.1 `PartsV2`, `ROLE_KIND`, parse, cut order, fill behind lifted parts, assemble with follow and motion.
  - [x] 2.2 `scripts/cast-forge.mjs <slug>` and the review sheet; shares code with `forge-replay.mjs`.
  - [x] 2.3 Decompose `saint-cardia`; NOTES.md; ledger section; hardening.
  - _Requirements: 2.1-2.3, 3.1-3.4_

- [x] 3. Decompose `the-redactor` (pixel art) and harden
  - Mouth hardening first (director's review of Cardia's sheet): per-layer jaw travel `Layer.drop`, a
    hard-edged mouth cavity painted from the lip line (`mouth.ts`), the jaw's top edge is the lip line;
    Cardia re-cut with a lips-only jaw (drop 0.016). Turn seams: background painted under the torso,
    `parallaxBacking`. Pixel art: `PartsV2.cut` (feather 0, cell 7), `fill: "extend"` per part.
- [ ] 4. Decompose `vicar-of-the-lure` (stained glass) and harden
- [ ] 5. Decompose `reveille` (brass and neon) and harden
- [ ] 6. Decompose `the-tallyman` (low-poly) and harden
- [ ] 7. Decompose `sir-vacant` (heraldic miniature) and harden
- [ ] 8. Decompose `lot-ninety` (art nouveau) and harden
- [ ] 9. Decompose `auntie-asp` (art nouveau, serpents) and harden
  - Each: the procedure in design.md "How a character is decomposed"; done per requirement 3.3; the
    ledger names what became code and what became a prompt rule.
  - _Requirements: 3.1-3.4_

- [ ] 10. The brief and the handshake (parallel lane after task 2)
  - `brief.ts`, `/api/forge/brief`, `mode: "brief"`, replay briefs for the eight, handshake card in
    `/creator/new`.
  - _Requirements: 4.1-4.3_

- [ ] 11. Live decomposition from the brief
  - `partsPromptFromBrief` with the ledger's general rules; live forge job asks for v2 parts when it has a
    brief; replay unchanged.
  - _Requirements: 4.4_

- [ ] 12. Integration
  - Lanes merged; the eight in the gallery and CH 4 listings; provenance; kiro-log rows; gates green;
    a review page of all eight rigs for the owner.
  - _Requirements: 5.1-5.3_
