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

## Round 2 (open)
- Idle motion (FlashHead freezes in silence; noise input does not help), the 0.96 s chunk-seam pop, live matting for a transparent Iris, out-client flush on stop.
