# Requirements: iris-hands (experiment)

The owner wants avatars that move their head and articulate with their hands. FlashHead (live) cannot draw hands. This experiment answers one question with evidence: can an open, licence-clean, audio-driven upper-body model give Iris natural hand gestures at a usable cost, for recorded videos first?

1. Survey current audio-driven half-body or upper-body models that render hands (EchoMimic V2/V3, OmniAvatar, InfiniteTalk, StableAvatar, FantasyTalking, CyberHost and newer). Record the licence of the code, the weights and every auxiliary model the inference loads; VRAM; speed; whether a pose sequence is required.
2. Generate a waist-up Iris image with her hands visible (Codex image edit of her portrait; same face, hair, headset and jacket), recorded in docs/provenance.md.
3. Run the best one or two candidates locally on a short clip (5-8 s) within the machine's limits, or report the limit and an estimated cloud cost. No accounts or paid actions without the owner.
4. Deliver clips, sheets and a verdict on hand quality, identity, motion naturalness and cost per video-minute.
