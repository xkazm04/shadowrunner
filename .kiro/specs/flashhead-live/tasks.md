# Implementation plan: flashhead-live

Builder: Kiro CLI, probed once per spark; fallback Claude Opus builders under this spec. The Director commits the protocol and interface stubs (design "Interfaces") first; then tasks 1-4 build in parallel on disjoint files.

- [ ] 1. Engine, protocol and bench (Python)
  - _Requirements: 1.1, 1.3, 2.1, 2.3, 3.1, 3.3, 4.1_
- [ ] 2. Upscalers (Python)
  - _Requirements: 1.2_
- [ ] 3. Web /live (TS)
  - _Requirements: 2.1-2.4, 3.2_
- [ ] 4. Conversation (Python)
  - _Requirements: 2.2_
