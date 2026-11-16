# Implementation plan: flashhead-live

Builder: Kiro CLI, probed once per spark; fallback Claude Opus builders under this spec. The Director commits the protocol and interface stubs (design "Interfaces") first; then tasks 1-4 build in parallel on disjoint files.

- [x] 1. Engine, protocol and bench (Python)
  - _Requirements: 1.1, 1.3, 2.1, 2.3, 3.1, 3.3, 4.1_
- [x] 2. Upscalers (Python)
  - _Requirements: 1.2_
- [x] 3. Web /live (TS)
  - _Requirements: 2.1-2.4, 3.2_
- [x] 4. Conversation (Python)
  - _Requirements: 2.2_

## Round 2 (done, 2026-11-16)
- [x] Idle loop with crossfades, seam blend, adaptive look-ahead, matting hook (d41f4c9)
- [x] Live matting (903efc9)
- [x] Web: alpha composite, matte switch, flush on stop (028ae37)
- [x] Iris-trained sharpener, an option; Maxine stays the default (d80d398)

Open follow-ups: small colour step between chunks in speech; foreground colour estimation for semi-transparent hair over bright slides; idle loop is calm (one blink per 12 s).
