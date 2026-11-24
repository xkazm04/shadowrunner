# Implementation plan: iris-hands

Builder: Claude Opus subagent (Kiro out of quota this month). Experiment code lives under `tools/talking-head/th/experiments/hands/`; weights and outputs under `$TH_HOME` and `var/`.

- [ ] 1. Survey, waist-up Iris image, local short-clip test, verdict
- [x] 2. Round 2: hand check, generator sweep, window stitching (Flash)
- [ ] 3. Round 3: full EchoMimicV3 arm with a MediaPipe face mask; negative CFG, steps, Long Video CFG (req 9) - arm, 5 s sweep (neg CFG on/off x 2 seeds, 15/25 steps) done; the Long-CFG passage is still missing (renders halted for the memory cap)
- [x] 4. Round 3: Flash re-anchoring: per-window prompt, fresh reference per window (req 10) - plus the pose as a kept end frame (2 of 3 seeds)
- [x] 5. Round 3: gesture persistence measure (req 11), picks, verdict, docs (req 13) - missing cells marked
- [-] 6. Round 3: LongCat-Video-Avatar 1.6 probe - DROPPED by the owner 2026-11-24 (local renders too heavy for the shared PC; weights, env and clone deleted; driver code kept)
