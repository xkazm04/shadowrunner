# Requirements: iris-hands (experiment)

The owner wants avatars that move their head and articulate with their hands. FlashHead (live) cannot draw hands. This experiment answers one question with evidence: can an open, licence-clean, audio-driven upper-body model give Iris natural hand gestures at a usable cost, for recorded videos first?

1. Survey current audio-driven half-body or upper-body models that render hands (EchoMimic V2/V3, OmniAvatar, InfiniteTalk, StableAvatar, FantasyTalking, CyberHost and newer). Record the licence of the code, the weights and every auxiliary model the inference loads; VRAM; speed; whether a pose sequence is required.
2. Generate a waist-up Iris image with her hands visible (Codex image edit of her portrait; same face, hair, headset and jacket), recorded in docs/provenance.md.
3. Run the best one or two candidates locally on a short clip (5-8 s) within the machine's limits, or report the limit and an estimated cloud cost. No accounts or paid actions without the owner.
4. Deliver clips, sheets and a verdict on hand quality, identity, motion naturalness and cost per video-minute.

## Round 2 (2026-11-17): better hands for recorded videos
Owner: EchoMimicV3-Flash with a gesture prompt is promising ("right hand is malformed at the end"; the other image's movement is "not natural").
5. Per-frame hand check (MediaPipe Hand Landmarker, Apache-2.0): flag frames where a visible hand has implausible landmarks (finger count, bone-length ratios, confidence drops, sudden jumps). Score a take as the share of good hand frames.
6. Several seeds per line, picking the take with the best hand score (and SyncNet). Try the generator's levers for hand stability (steps, guidance, negative prompt) and report which help.
7. Window stitching for lines longer than one 5 s window (overlapping windows with a crossfade or the model's own motion-frame continuation), demonstrated on a 15-20 s passage. Measure the seam.
8. Deliver clips + sheets + the hand scores, with the best 15-20 s presenter clip for the owner.

## Round 3 (2026-11-24): gestures that last a whole passage
Owner: body and hands are the next frontier; research the current models and push experiments past the round-2 limit. Round 2's open problem: in a 15-20 s passage the gestures fade after the first window (hands settle into a clasped rest), and big gestures smear. Round 3 attacks that with licence-clean levers on the one RTX 4090 (24 GB), offline (recorded videos).

9. **Full EchoMimicV3 (non-Flash) arm.** Upstream `infer_preview.py` with the main `BadToBest/EchoMimicV3` transformer (Apache-2.0 card; record revision, size, licence), on the same Wan2.1-Fun base and wav2vec as the Flash arm. It has the levers Flash lacks: a hand-specific negative prompt that is really applied (phase-aware negative CFG: `neg_scale`, `neg_steps`), dynamic CFG, Long Video CFG for windows past 138 frames, and 15-25 steps for "talking body" (model card). Its face mask comes from `src/face_detect.py` (RetinaFace, InsightFace weights: non-commercial): replace it with the MediaPipe Face Detector/Landmarker (Apache-2.0) box, upstream code unedited (driver patch, as round 2). Measure negative CFG on/off, steps 15/25, Long Video CFG on a passage.
10. **Re-anchoring the Flash arm.** The two round-2 follow-ups: (a) a per-window prompt (each window of a passage gets its own gesture instruction, e.g. "raises one finger" / "opens both palms" / "counts on fingers", tied to the passage's "First / Second / And finally" beats); (b) a fresh reference each window (the CLIP identity image replaced by an open-hands pose frame, the motion frames kept, a longer crossfade if the seam needs it).
11. **Gesture persistence measure.** Per window of a passage: wrist travel (face heights) and the share of frames with both hands clasped at rest. A passage holds its gestures when every later window's wrist travel is at least 60 % of the first window's. Reported next to hand score, worst 0.5 s, SyncNet, identity and seam steps.
12. **LongCat-Video-Avatar 1.6 (gated, not installed).** MIT weights, but its project page says generated content is "for academic use only and commercial use is not permitted", and every documented run uses 2 GPUs (BF16 DiT ~30 GB; INT8 ~15 GB). Report the licence conflict to the owner; download and probe it on the 4090 (INT8, single GPU) only after an owner ruling.
13. Deliver: the same 17 s `passage.wav` and `line-short.wav` on `waist-c`, 3 seeds per arm, picks under `var/talking-head/live-review-r6/hands/`, a verdict table against round 2's `long-s7-notc-ac113` and `c8-s1116-notc-a45`, cost per finished video-minute, and the docs section.
