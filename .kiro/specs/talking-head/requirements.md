# Requirements: talking-head

An alternative human avatar built on a different technical approach than the morph-key lane:
open, permissively licensed audio-driven video models running locally on the RTX 4090, compared
against today's Iris morph face on the same script. Spark: `.spark/Spark/ideas/human-avatar-alt.md`.

## 1. Tool and runtime
1.1 `tools/talking-head` is a uv Python 3.12 project with a `th` CLI (`fetch`, `audio`, `render`, `board`).
1.2 Model weights download to `$TH_HOME/models/<arm>/` (default `~/.talking-head`), never into git; each arm dir holds `licence.json`.
1.3 Only permissive weights (Apache-2.0, MIT; Audio2Face-3D under the NVIDIA Open Model License, accepted by the owner). Non-commercial models are refused.
1.4 An arm runs natively on Windows or, when it cannot, in a Docker Desktop CUDA container behind the same CLI (`--runtime docker`).
1.5 GPU jobs hold `$TH_HOME/gpu.lock`; `run.json.gpuExclusive` records whether timings were taken alone on the GPU.

## 2. Arms
2.1 `noop`: repeats the portrait (pipeline test). 2.2 `baseline`: today's product face (analyseSpeech visemes -> morph player -> capture).
2.3 `diffusion-it`: InfiniteTalk image-to-video. 2.4 `diffusion-sa`: StableAvatar. 2.5 `realtime-fh`: SoulX-FlashHead Lite in streaming mode, with a per-frame callback and time-to-first-frame.
2.6 `dub-ls`: our rig renders Iris idle with the mouth neutral; LatentSync 1.6 paints the mouth.
2.7 `a2f-keys`: Audio2Face-3D weights drive our morph face: mouth shapes + mouthGain, brows/squint -> expression families, energy -> nod/tilt.

## 3. Outputs and measurement
3.1 Every run writes `raw.mp4` (native), `video.mp4` (1080x1080 H.264 30 fps + AAC), `alpha.webm` (VP9 with alpha, BiRefNet matte) and `run.json` (`th-run/1`).
3.2 Alpha is verified on decoded pixels: background corner alpha 0, face centre 255.
3.3 Metrics: SyncNet confidence/offset, DINOv2 identity cosine of MediaPipe face crops vs the portrait (mean/min/p5), render seconds and real-time factor, time to first frame, VRAM peak.
3.4 Test material: Kokoro-voiced scripts `pitch-45s` and `long-180s`, one voice for every arm.
3.5 `th board` writes a blind, seeded, synced grid video with a key file and a verdict template.
3.6 The Avatar Lab imports a run as an external run (`external: "talking-head"`) so the existing measure and A/B board apply.
