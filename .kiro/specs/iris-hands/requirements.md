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
