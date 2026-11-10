# Implementation plan: perfection-pass

Lanes: A = tasks 1-3, B = tasks 4-6, C = tasks 7-9, D = tasks 10-11 (design "Lanes and file
ownership"). Builder: Claude Opus, one per task; the Director reviews, gates and logs.

- [x] 1. Renderer runtime, P1 (lane A)
  - As design "Task 1"; bench figures before and after.
  - _Requirements: 1.1-1.5_

- [x] 2. Secondary motion, V1 (lane A)
  - As design "Task 2"; all thirteen cast rigs checked; before/after sheet.
  - _Requirements: 2.1-2.4_

- [x] 3. Depth turn and lighting, V2 (lane A)
  - As design "Task 3"; per-character contact sheet; `docs/rig-format.md` section.
  - _Requirements: 3.1-3.4_

- [x] 4. Real lip-sync, F1 (lane B)
  - As design "Task 4"; lab imports re-pointed; one analyser tap on the stage.
  - _Requirements: 4.1-4.5_

- [x] 5. Never dead air, V3 (lane B)
  - As design "Task 5"; live paths tested with fakes.
  - _Requirements: 5.1-5.5_

- [x] 6. Studio director, F4 (lane B)
  - As design "Task 6"; transparent export only if proven on pixels.
  - _Requirements: 6.1-6.4_

- [x] 7. Creator history, F2 (lane C)
  - As design "Task 7".
  - _Requirements: 7.1-7.4_

- [x] 8. Replay honours the request, F3 (lane C)
  - As design "Task 8".
  - _Requirements: 8.1-8.2_

- [x] 9. Editor cost, P3b (lane C)
  - As design "Task 9"; render-count test.
  - _Requirements: 9.1-9.2_

- [x] 10. Load diet, P2 (lane D)
  - As design "Task 10"; fresh build measured before and after.
  - _Requirements: 10.1-10.6_

- [x] 11. Set paint cost, P3a (lane D)
  - As design "Task 11"; before/after trace.
  - _Requirements: 11.1-11.4_

- [x] 12. Served art as lossy WebP (follow-up)
  - _Requirements: 12.1-12.4_

- [x] 13. Briefs for the unmatched cast (follow-up)
  - _Requirements: 13.1-13.4_

- [x] 14. Cleanup (follow-up)
  - _Requirements: 14.1-14.4_

- [x] 15. Announcer hood gap (follow-up)
  - _Requirements: 15.1-15.2_

- [ ] 16. The forge cut keeps every piece (follow-up)
  - _Requirements: 16.1-16.5_
