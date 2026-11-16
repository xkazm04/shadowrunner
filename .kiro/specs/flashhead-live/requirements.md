# Requirements: flashhead-live

Live Iris on SoulX-FlashHead Lite, chosen by the owner from the talking-head comparison (best mouth movement; resolution and likeness to improve). Spark: `.spark/Spark/ideas/flashhead-live.md`.

## 1. Quality
1.1 Iris is fed to FlashHead bust-framed (head and shoulders), which measured likeness 0.976 vs 0.901 for the wide portrait.
1.2 An optional 2x upscaler (Real-ESRGAN compact; NVIDIA Maxine/RTX VSR if its licence allows) is switchable live and compared by measurement.
1.3 Iris never freezes: while silent she shows idle motion.

## 2. Live modes
2.1 Typed lines: text to local Kokoro speech to live Iris.
2.2 Conversation: typed chat to Claude (server-side key) to speech to live Iris; a new message interrupts the old reply.
2.3 Puppet: the operator microphone drives the mouth; the voice plays back in sync.
2.4 Slides: a folder of slide images plus a script; Iris narrates and the slides advance with her lines.

## 3. Delivery
3.1 A local server streams frames and audio on one clock over WebSocket (`fhl/1`); lip-sync holds by construction.
3.2 The web app gets `/live` (control) and `/live?out=1` (a clean, transparent OBS view).
3.3 Only local origins (plus explicitly allowed ones) may connect.

## 4. Measurement
4.1 `th live-bench` measures first-frame latency, sustained fps, chunk and upscale time, SyncNet, likeness and sharpness for each variant.
