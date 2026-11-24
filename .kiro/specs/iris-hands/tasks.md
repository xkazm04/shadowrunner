# Implementation plan: iris-hands

Builder: Claude Opus subagent (Kiro out of quota this month). Experiment code lives under `tools/talking-head/th/experiments/hands/`; weights and outputs under `$TH_HOME` and `var/`.

- [ ] 1. Survey, waist-up Iris image, local short-clip test, verdict
- [x] 2. Round 2: hand check, generator sweep, window stitching (Flash)
- [ ] 3. Round 3: full EchoMimicV3 arm with a MediaPipe face mask; negative CFG, steps, Long Video CFG (req 9)
- [ ] 4. Round 3: Flash re-anchoring: per-window prompt, fresh reference per window (req 10)
- [ ] 5. Round 3: gesture persistence measure (req 11), picks, verdict, docs (req 13)
- [ ] 6. Round 3: LongCat-Video-Avatar 1.6 probe - BLOCKED on the owner's licence ruling (req 12)
