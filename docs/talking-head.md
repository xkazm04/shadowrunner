# Talking head (`tools/talking-head`)

A local tool that renders the Iris portrait speaking a script through alternative arms (open,
permissively licensed audio-driven video models, and our own rig), then measures every run the same
way and puts them side by side on one blind board. Spec: `.kiro/specs/talking-head/`.

Arms (`ARM_IDS`): `noop` (pipeline test), `baseline` (today's morph face), `diffusion-it`
(InfiniteTalk), `diffusion-sa` (StableAvatar), `realtime-fh` (SoulX-FlashHead Lite), `dub-ls`
(rig idle + LatentSync), `a2f-keys` (Audio2Face-3D driving our morph keys). WP1 ships `noop` and a
stub per other arm; tasks 2 and 3 replace the stubs.

## Set up

Python 3.12 through uv; the project venv is `tools/talking-head/.venv` (git-ignored), with torch
2.6.0 + CUDA 12.4 wheels from the PyTorch cu124 index. ffmpeg and ffprobe must be on PATH
(libx264, libvpx-vp9, libopus, drawtext).

```
cd tools/talking-head
uv sync                      # core venv: torch cu124, transformers, mediapipe, kokoro-onnx, ...
uv run th fetch metrics      # BiRefNet, DINOv2-small, MediaPipe Face Landmarker, SyncNet (~600 MB)
uv run th --help
```

Kokoro: `th audio` uses the same `kokoro-v1.0.onnx` and `voices-v1.0.bin` as the Avatar Lab, read
from the MAIN checkout's `var/lab/models` (found with `git rev-parse --git-common-dir`, so a worktree
uses them too). `TH_KOKORO_DIR` points elsewhere. If they are missing, run `pnpm lab setup` in the
main checkout.

## Commands

```
uv run th fetch <metrics|birefnet|dinov2|mediapipe|syncnet|<arm>> [--force]
uv run th audio --script pitch-45s [--force]
uv run th render --arm noop --script pitch-45s [--seed 1116] [--runtime native|docker]
                 [--portrait <png>] [--no-alpha] [--no-metrics]
uv run th board --runs <runDir>,<runDir>,... --seed 3 --out <dir>
```

- `fetch` downloads into `$TH_HOME/models/<name>/` and writes `licence.json` there (a list of
  `{name, licence, url, revision}`, the same rows that land in `run.json.weights`). Hugging Face
  models are pinned to a commit; URL files are pinned by sha256.
- `audio` writes `$TH_HOME/audio/<script>.wav` (24 kHz mono) and `<script>.txt` (the spoken text),
  and reuses them while the text is unchanged.
- `render` takes the GPU lock, runs the arm, then post-processes into a run dir and prints its path.
- `board` builds the blind grid (below).

## Where things live

```
$TH_HOME (default ~/.talking-head; outside every checkout so worktrees share it)
  gpu.lock                       file lock held by every render
  audio/<script>.wav, .txt       Kokoro renders
  models/<name>/licence.json     weights per core model or arm
  repos/<arm>/, envs/<arm>/      a heavy arm's upstream clone and its own venv (see Adding an arm)

<main checkout>/var/talking-head/runs/<UTC stamp>-<arm>-<script>/   (TH_RUNS_DIR overrides)
  raw.mp4      the arm's native output
  video.mp4    1080x1080 H.264 30 fps + AAC 48 kHz: letterboxed (never stretched), on the audio clock
  alpha.webm   VP9 yuva420p (+ Opus): video.mp4's pixels with the BiRefNet matte as alpha
  run.json     th-run/1
  log.txt      every command and its output, plus "stage <name>: <s>" timings
```

## run.json (`th-run/1`)

Every key is always present; a value the run could not measure is `null` (the lab and the board
show it as n/a). Pydantic model: `th/schema.py` (`RunRecord`, `load_run`, `json_schema`).

| key | meaning |
| --- | --- |
| `schema`, `arm`, `script`, `seed`, `runtime` | what ran; `script` is the script id (text in `tools/talking-head/scripts/<id>.txt`) |
| `portrait` | repo-relative path of the input image |
| `width`, `height`, `fps`, `durationS` | read back from video.mp4 with ffprobe |
| `renderS`, `rtf` | wall seconds of the arm call alone (post-processing excluded); `rtf` = renderS / audio seconds |
| `ttffMs` | time from the arm call to its first `on_frame` callback; null when the arm has none |
| `vramPeakMiB` | peak `memory.used` (nvidia-smi, sampled every 250 ms during the arm call) minus the value at its start |
| `gpuExclusive` | true when no other process held more than 500 MiB of VRAM at the arm's start and end; null if unmeasurable |
| `sync.conf`, `sync.offsetFrames` | SyncNet confidence and offset (below) |
| `identity.mean/min/p5` | DINOv2 cosine of face crops vs the portrait (below) |
| `faceRoi` | `[x, y, w, h]`, integer pixels of video.mp4: the union over the clip of the lip box grown 25% per side; null if no face was found |
| `weights` | the arm's licence rows plus the core models' |
| `notes` | free text: the arm's note, measurement caveats, contention found |

## How each number is measured

- **Faces.** MediaPipe Face Landmarker (478 landmarks) on every frame at 25 fps. The face box is
  the landmark extent; the lip box is the extent of the lip contour landmarks.
- **Sync.** The original SyncNet v2 evaluation (joonson/syncnet_python, MIT; the same code
  LatentSync vendors in `eval/syncnet`), weights `syncnet_v2.model` from VGG. LatentSync's Hugging
  Face repos carry the same file but are tagged OpenRAIL++-M, so they are not used. Crops follow
  syncnet_python's `crop_video` (median-filtered box, crop scale 0.4, 224 px, BGR), audio is 16 kHz
  MFCC, offsets are searched over +-15 frames. `conf` = median minus minimum of the mean distance
  curve (LSE-C). `offsetFrames` is in 25 fps frames (40 ms); positive means the picture runs late.
  Below conf 1.0 the offset is noise and is written as null. Positive control (a test): their
  `example.avi` gives offset 3 and conf 10.05 here (their README: 3 and 10.021); the same clip with
  the picture delayed 5 frames gives offset 8. A still face (noop) scores conf 0.05.
- **Identity.** Every 25th frame (1 fps): a square crop around the face box (15% margin), DINOv2-small
  CLS embedding, cosine against the same crop of the portrait letterboxed exactly as video.mp4 is.
  `p5` is the 5th percentile. noop scores mean 0.9965 (encoding loss only).
- **Alpha.** BiRefNet (1024 px input, fp16) per frame of video.mp4, resized back to 1080. ffmpeg's
  native VP9 decoder drops the alpha plane; decode with `-c:v libvpx-vp9`
  (`th.post.alpha.decoded_alpha`). The e2e test checks decoded alpha 0 at three corners and 255 on
  the face.
- **Exclusivity.** On Windows (WDDM) `nvidia-smi --query-compute-apps` reports per-process memory as
  `[N/A]`, so the per-process figure comes from the "GPU Process Memory(*)\Dedicated Usage"
  performance counter (typeperf). `dwm.exe` is skipped: its counter reports committed memory
  (measured 27,953 MiB on the 24,564 MiB card while the adapter held 1,304 MiB in total). Linux uses
  nvidia-smi's per-process column. Contention found is listed in `notes`.

Cost of post-processing on the 4090 (noop, pitch-45s, 1347 frames): about 2 min 15 s in total for
normalise, BiRefNet + VP9 alpha and metrics; see `stage` lines in `log.txt` for any run.

## Scripts and voice

Scripts are plain text in `tools/talking-head/scripts/<id>.txt`; blank lines separate paragraphs,
`#` lines are comments. Each sentence is synthesised separately and joined with 0.22 s (sentence)
and 0.6 s (paragraph) gaps, plus 0.3 s of silence at both ends. The voice is Kokoro `af_heart` at
speed 1.0: Iris's pack voice is `velvet` (`scripts/build-packs.mjs` COMPANION_VOICES), which the lab
maps to `af_heart` (`apps/lab/src/director/voice/kokoro.ts`).

| id | content | measured |
| --- | --- | --- |
| `pitch-45s` | Iris presents Hearth (a home calendar hub): explanation, excited beat, concerned beat, rhetorical question | 44.89 s |
| `long-180s` | a calm explainer of the same product | 177.97 s |
| `smoke-6s` | one line for the end-to-end test | 5.04 s |

## Board

`th board --runs a,b,... --seed n --out dir` stacks up to six runs' video.mp4 in a 3x2 grid
(540 px tiles, 1620x1080) with letters A-F burned in, reading order. Which run sits behind which
letter is a seeded shuffle written only to `key.json` (`th-board/1`: seed, audioFrom, durationS,
letters -> run, arm, script, seed). Shorter runs hold their last frame up to the longest; empty
tiles are dark. The soundtrack is the first run on the command line, padded with silence.
`verdict.md` is the template: one section per letter (pick: keep / maybe / drop, notes) and an
overall winner.

## Adding an arm

1. Each arm owns one module, `th/arms/<module>.py` (`noop.py`, `baseline.py`, `infinitetalk.py`,
   `stableavatar.py`, `flashhead.py`, `dub.py`, `a2f.py`). The registry `th/arms/__init__.py`
   imports them all; replace your module and leave `__init__.py` alone.
2. Subclass `th.arms.base.Arm`, keep `id`, and implement:
   - `fetch() -> list[Weight]`: set up and download, return the licence rows (`th fetch <arm>`
     writes them to `$TH_HOME/models/<arm>/licence.json`).
   - `render_native(job, on_frame) -> RawResult`: write `job.raw` (raw.mp4; picture only is fine,
     the normaliser always muxes the job audio). `Job` carries `script`, `script_text`, `audio` (wav),
     `audio_s`, `portrait`, `seed`, `run_dir` and `log`. Call `on_frame(rgb)` per frame as soon as a
     frame exists if the arm streams; the first call sets `ttffMs`.
   - `render_docker(...)` only if the arm runs in a container; list `"docker"` in `runtimes`.
     Without it, `--runtime docker` fails with "docker runtime not implemented for <arm>".
   - `preflight(runtime)` runs before the audio, the run dir and the GPU lock; the default checks
     `runtimes`. Override it to also check fetched weights or a built env, so a missing setup fails
     in a second instead of after waiting for the lock.
3. Heavy arms add no dependencies to `tools/talking-head/pyproject.toml`. Use `ArmEnv(arm_id)`:
   - `.repo` (`$TH_HOME/repos/<arm>`) and `.clone(url, revision)` for the upstream code, pinned;
   - `.env` / `.python` and `.make_venv(python, requirements, *extra)` for its own venv
     (`$TH_HOME/envs/<arm>`, built with uv);
   - `.run(["python", script, ...], cwd, log)` runs the arm's python (or any program), streaming
     stdout and stderr into the run's `log.txt` and the console, and raises on a non-zero exit;
   - `.docker_run(image, args, mounts, log)` is `docker run --rm --gpus all` with bind mounts.
4. Licences: Apache-2.0 or MIT only (Audio2Face-3D under the NVIDIA Open Model License is accepted
   by the owner). A non-permissive model is a blocker to report, never a workaround.
5. The GPU lock is taken by `th render`; an arm never takes it itself.

## Tests

`cd tools/talking-head && uv run pytest` (about 30 s). Unit tests always run; the end-to-end noop
render over `smoke-6s` (layout, ffprobe, decoded alpha pixels, run.json validation, identity, sync)
and the SyncNet positive control need CUDA, `th fetch metrics` and the Kokoro files, and skip with
the reason otherwise.

## Licences of the core models

| model | licence | source |
| --- | --- | --- |
| BiRefNet (`ZhengPeng7/BiRefNet`) | MIT | Hugging Face, pinned commit |
| DINOv2-small (`facebook/dinov2-small`) | Apache-2.0 | Hugging Face, pinned commit |
| MediaPipe Face Landmarker | Apache-2.0 | storage.googleapis.com, sha256 pinned |
| SyncNet v2 (`syncnet_v2.model`) | MIT (joonson/syncnet_python) | robots.ox.ac.uk, sha256 pinned |
| Kokoro v1.0 | Apache-2.0 | shared with the Avatar Lab |

## Diffusion arms (task 2): `diffusion-it`, `diffusion-sa`, `realtime-fh`

Each arm clones its upstream repo at a pinned commit into `$TH_HOME/repos/<arm>`, builds its own uv
venv in `$TH_HOME/envs/<arm>` (torch 2.6.0+cu124 for all three, one resolve so nothing swaps torch
for a CPU wheel) and downloads only the weight files it reads, each from its own pinned Hugging Face
repo, into `$TH_HOME/models/<arm>/<repo name>/`. `th fetch <arm>` does all three steps and writes
`licence.json`; `preflight` refuses to render (in a second, before audio or the GPU lock) until the
clone, the venv and every needed file exist. All three run natively on Windows; no container.

```
uv run th fetch diffusion-sa          # clone + venv + weights + licence.json
uv run th render --arm diffusion-sa --script smoke-6s --no-alpha --no-metrics   # 5 s look
uv run th render --arm diffusion-sa --script pitch-45s
```

### diffusion-it: InfiniteTalk (MeiGen-AI/InfiniteTalk, Apache-2.0)

- Image-to-video, `--mode streaming`, 81-frame chunks with 9 motion frames, 25 fps.
- Fits 24 GB through the repo's own FP8 single-person checkpoint (`--quant fp8`: the DiT and the T5
  both quantised by MeiGen, `quant_models/infinitetalk_single_fp8.safetensors` + `t5_fp8`) and block
  offload (`--num_persistent_param_in_dit 0`). The quantised path never reads the fp32 Wan DiT shards
  (65 GB) or the bf16 T5 (11 GB), so they are not fetched; from Wan2.1-I2V-14B-480P only the config,
  the VAE, the CLIP encoder and the tokenizers are.
- `--max_frame_num` is set from the audio length (upstream caps at 1000 frames = 40 s).
- Knobs (environment; the run notes record them): `TH_IT_SIZE` (`infinitetalk-480` = 640x640, default;
  `infinitetalk-720` = 960x960), `TH_IT_STEPS` (40), `TH_IT_TEACACHE=1`, `TH_IT_PERSISTENT` (DiT
  parameters kept on the GPU; 0 streams them all from RAM every step), `TH_IT_MARLIN=1` (below).
- Windows specifics (dependencies only, upstream code untouched):
  - optimum-quanto turns fp8 weights on an sm80+ GPU into Marlin tensors and JIT-builds their CUDA
    kernels from GCC-only sources (`__asm__`), which MSVC + nvcc cannot build. The arm starts upstream
    through a short launcher (`python -c`) that keeps the weights as plain `WeightQBytesTensor`:
    quanto's own torch fallback (fp8 -> bf16 x scale, then matmul), the same arithmetic without the
    fused kernel. Render time is therefore not representative of the stock Linux path (the run notes
    say so). `TH_IT_MARLIN=1` runs the stock path where the kernels build (Linux/docker).
  - `wan/modules/clip.py` asserts flash-attn 2, which has no Windows wheel on PyPI: the venv takes the
    community Windows build of the same BSD-3-Clause source (kingbri1/flash-attention v2.7.4.post1,
    cu124 / torch 2.6 / cp310), plus `triton-windows<3.3` because flash-attn's rotary module imports
    triton.
- Cost (RTX 4090, 480p, 40 steps, 3 CFG passes per step, fallback path): ~112-120 s per denoising
  step, compute-bound (GPU 98-100 %, 13.7 GB), so ~75-85 min per 81-frame chunk. smoke-6s needs 2
  chunks (~2.7 h); pitch-45s needs 16 (81 + 15 x 72 frames), projected ~20 h, so it was not run.
- No distilled variant: MeiGen's `quant_models/*_lora` checkpoints have FusionX merged in (MeiGen
  collaborator, MeiGen-AI/InfiniteTalk issue #43), and FusionX is research / non-commercial (below).

### diffusion-sa: StableAvatar (Francis-Rings/StableAvatar, MIT)

- Wan2.1-Fun-1.3B based, `transformer3d-square.pt`, 512x512 at 25 fps, 50 steps, the sample
  configuration of the repo's `inference.sh` (text CFG 3, audio CFG 5, 81-frame clips, overlap 5).
- `--GPU_memory_mode model_cpu_offload` by default so it fits beside another GPU user.
- The vocal separator (`Kim_Vocal_2.onnx`) is not fetched: Kokoro audio has no music.
- Knobs: `TH_SA_SIZE` (`512x512` | `480x832` | `832x480`), `TH_SA_MEMORY` (the repo's four modes),
  `TH_SA_STEPS`.
- Known upstream behaviour (in the run notes): the picture leads the audio by ~4 frames (SyncNet
  offset -4 on raw.mp4 muxed with the source wav too; realtime-fh gives 0 through the same path).
  The long pipeline feeds latent i the audio from frame 4i, while the causal VAE decodes latent i
  (i >= 1) to frames 4i-3..4i. Not compensated. On pitch-45s the last ~2.4 s wash out (background
  mean 20.4 -> ~31 from f1060, steepest f1084-1092; skin lifts), in the pipeline's last window.

### realtime-fh: SoulX-FlashHead Lite (Soul-AILab/SoulX-FlashHead, Apache-2.0 code)

- Licences per the model card's "Component Licenses" (the card itself is tagged `other`): DiT
  weights (Model_Lite, Model_Pro) and VAE_Wan Apache-2.0; VAE_LTX (the LTX-Video 0.9 VAE that Lite
  decodes with) OpenRAIL-M. OpenRAIL-M is accepted by the owner (Director ruling 2026-11-16); its
  `licence.json` row carries the use-restriction note (Attachment A restrictions apply; keep
  OpenRAIL-M on redistribution, never relicense as Apache-2.0).
- Default `TH_FH_MODEL=lite` (512x512 at 25 fps, 4 distilled steps, LTX VAE). `pro` (Model_Pro +
  VAE_Wan, all Apache-2.0) is the alternative; its weights are fetched by `th fetch realtime-fh`.
- Streaming: a small driver (`th_stream.py`, written into the clone at render time from
  `th/arms/flashhead.py`) runs the repo's `--audio_encode_mode stream` loop (8 s rolling audio
  window; one chunk per slice of new audio: Lite 24 frames / 0.96 s, Pro 28 / 1.12 s) after one
  warm-up chunk on silence, and writes each chunk's frames to a private copy of fd 1 as soon as they
  exist (fd 1 itself is pointed at stderr, so upstream prints cannot corrupt the stream). The arm
  hands every frame to `on_frame` and to the raw.mp4 encoder.
- Timing: the driver reports, on its own clock, model load, warm-up, audio-in -> first frame
  (compute only; a live caller first waits one slice, 0.96 s, to fill the chunk) and each chunk's
  compute; the run notes give sustained fps and whether every chunk beat its slice budget.
  `run.json.ttffMs` is `th render`'s figure from the arm call, so it also counts process start,
  imports, model load and warm-up (16.3 s on pitch-45s).
- `torch.compile` (upstream default) is off natively: it needs Triton, which Windows lacks.
  `TH_FH_COMPILE=1` turns it back on where Triton works. Real time holds without it.

### Weights and licences

| arm | weight (pinned commit) | licence |
| --- | --- | --- |
| diffusion-it | Wan-AI/Wan2.1-I2V-14B-480P (config, VAE, CLIP, tokenizers) `6b73f84` | Apache-2.0 |
| diffusion-it | MeiGen-AI/InfiniteTalk (`quant_models/infinitetalk_single_fp8`, `t5_fp8`) `d59847e` | Apache-2.0 |
| diffusion-it | TencentGameMate/chinese-wav2vec2-base `3991242` | MIT |
| diffusion-sa | FrancisRing/StableAvatar (`StableAvatar-1.3B/transformer3d-square.pt`) `140cbd9` | MIT |
| diffusion-sa | alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP `fc913c3` | Apache-2.0 |
| diffusion-sa, realtime-fh | facebook/wav2vec2-base-960h `22aad52` | Apache-2.0 |
| realtime-fh | Soul-AILab/SoulX-FlashHead-1_3B (`Model_Lite`, `Model_Pro`, `VAE_Wan`) `5fbd2e4` | Apache-2.0 per card components (card tag `other`) |
| realtime-fh | Soul-AILab/SoulX-FlashHead-1_3B (`VAE_LTX`) `5fbd2e4` | OpenRAIL-M, use restrictions apply (accepted by the owner) |

Not fetched, and not to be fetched (licence):

| weight | why |
| --- | --- |
| MeiGen-AI/InfiniteTalk `quant_models/infinitetalk_*_lora` (fp8 and int8) | FusionX merged in (issue #43; the json and safetensors header are otherwise identical to the plain quant models, no metadata). FusionX (vrgamedevgirl84/Wan14BT2VFusioniX) is tagged apache-2.0, but its card says "All merged models are provided for research and non-commercial use only", with components under CC BY-NC-SA 4.0 (CausVid etc.). The card's clause wins over the tag. |
| FrancisRing/StableAvatar `Kim_Vocal_2.onnx` | not needed (vocal separation; Kokoro audio is clean); licence not checked |

Also not fetched because the chosen path never reads them: Wan2.1-I2V-14B-480P fp32 DiT shards (65 GB)
and bf16 T5 (11 GB), StableAvatar `transformer3d-rec-vec.pt`.

### Measured (RTX 4090)

pitch-45s (44.89 s), seed 1116. `gpuExclusive` was false for every run: an unrelated process (pid
15812) held 3.0-3.7 GB throughout.

| arm | resolution (native) | render s | rtf | VRAM peak (delta) | identity mean / min | sync conf (offset) | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| realtime-fh (Lite) | 512x512 @ 25 | 47.3 | 1.05 | 6.4 GB | 0.889 / 0.782 | 8.18 (0) | streaming: audio-in TTFF 730 ms (+960 ms audio buffer), sustained 37.0 fps, 0/47 chunks over budget: real time kept; render s includes ~6 s load + warm-up |
| diffusion-sa | 512x512 @ 25 | 5193 | 115.7 | 18.9 GB | 0.912 / 0.692 | 4.79 (-4) | upstream lip lead (-4); wash-out in the last 2.4 s; one bared-teeth grimace near f1000 |
| diffusion-it | 640x640 @ 25 | n/a | n/a | 13.7 GB | n/a | n/a | dropped (owner): ~111 s/step, ~80 min per 81-frame chunk, ~20 h projected for pitch-45s on the Windows fallback path; the machine froze 52 min into the smoke-6s look (block offload streaming the 14B DiT through RAM). Do not re-run unattended. |

## Rig arms (`baseline`, `a2f-keys`, `dub-ls`)

The three rig arms render through the PRODUCT avatar player, not a re-implementation. 
`scripts/portrait/timeline-capture.mjs` opens `apps/web/bench/timeline.html` in headless Chromium.
The page runs Iris's pack (`apps/web/public/packs/iris.srpack`) through `createAvatarPlayer`, and
the script steps it by hand with `renderFrame(1/30)`, frame 0 at dt 0. The player's own blink,
breathing, sway, gaze drift, mood crossfades, gestures and springs all run.

Each frame's PNG is piped to ffmpeg:
- H.264 crf 12, yuv420p, 30 fps;
- the wav is muxed as AAC, `-shortest`.

The frame is 1024 px (the rig's own canvas) and opaque over Iris's `background` layer, like the
diffusion arms. Alpha comes from the shared BiRefNet pass, as for every arm.

```
node scripts/portrait/timeline-capture.mjs --out <mp4> (--timeline <json> | --audio <wav>)
     [--audio <wav>] [--text <txt>] [--mouth-rest] [--pack <url>] [--size 1024] [--seed 1]
     [--frames N] [--keep 0,75,150 --keep-dir <dir>] [--hashes <file>] [--port 5312] [--headed]
```

- **Server and browser.** The script runs its own Vite dev server on port 5312 (strict, HMR and
  watch off). Input files reach the page through Playwright routes under `/th-input/`. The server
  and the browser are closed at the end, also on a failure.
- **Packs.** `apps/web/public/packs/` is git-ignored. `th fetch baseline` (or any rig arm) runs
  `node scripts/build-packs.mjs`. The arms' `preflight` checks node, `node_modules` and the pack.
- **Determinism.** Same input, same frames: the player is seeded with the run's `--seed` and
  stepped by a fixed dt, never by the wall clock. `--hashes` writes each frame's RGBA sha256.
  - `tests/test_rig_capture.py` captures a 3 s timeline twice at 512 px under the GPU lock. All
    90 hashes are equal and all 90 are distinct.
  - Measured again at 1024 px: equal, 90/90 distinct.
  - Measured on 20 frames of the studio lip-sync path: equal.
- **Speed.** About 75 ms a frame on the 4090 (ANGLE D3D11): pitch-45s (1347 frames) captures in
  about 50 s.

### th-timeline/1

A timeline has one frame per 30 fps frame: `{schema, fps: 30, frames: [{t, mouth, mouthGain,
expression, gesture, blink, gaze}]}`.
- Every key of a frame is always present. `null` means "leave the player's own behaviour".
- Model: `th/rig/timeline.py`. JSON Schema: `th/rig/th-timeline.schema.json` (a test pins it to the
  model). Tests: `tests/test_rig_timeline.py`.

How the page applies each field, and through which player API:

| field | value | player API | how |
| --- | --- | --- | --- |
| `mouth` | `{shape: 0..1}` over `rest openWide openMid round closed teeth tongue narrow` | `setMouthShapes(shapes, {jaw: shapes})` | missing shapes are 0; `rest` defaults to 1 - the others |
| `mouthGain` | 0.3..1.5 | `setLook` -> `Look.face.mouth.size` | the speaking-mouth multiplier on top of the rig's per-shape `mouthGain` |
| `expression` | `{family, w}` | `setLook` -> `Look.emotion` + `Look.face.expression.strength` | the family's milder emotion (joy -> amused, showman -> theatrical, anger -> irritated, gloom -> grim, smug -> smug, suspicion -> suspicious); strength = w x the profile's strength; the player crossfades a change over MOOD_FADE_S |
| `gesture` | `nod tilt lean_in recoil glare flare` | `gesture(g)` | started on the frame the name first appears; a run of the same name is one gesture |
| `blink` | 0..1 | none | no public player API: counted in `timelineInfo.ignored` and not drawn; producers write null |
| `gaze` | `[x, y]` -1..1 | none | as `blink` |

In audio mode (`--audio`), the wav also sets `setLevel` every frame. It is the speech level of the
last 2048 samples at 48 kHz, which is what playLine's level tap reads in the studio. On Iris it moves
nothing visible: her rig has no jaw layer, and a morph mouth takes the shapes.

### baseline

The studio's own lip-sync, run in the page:
- `trackOfLine(buffer, text)`: analyseSpeech over the wav, decoded at the studio's 48 kHz, plus the
  spoken text (`$TH_HOME/audio/<script>.txt`);
- `trackShaper(...).frame(dt)` before each `renderFrame`, imported from
  `apps/web/src/reach/studio/lipsync.ts`. This is exactly the Record path.

It is not ported to Python: in the page the analyser IS the product code, while a port (features,
linear model, aligner, letter table, ~600 lines) would have to be proven equal to it.

`<run>/frames/frame-{00000,00075,00150}.png` are kept for a look against a studio still.

### a2f-keys (Docker only: `th render --arm a2f-keys --script <id> --runtime docker`)

The pipeline:
1. NVIDIA Audio2Face-3D SDK (MIT, `NVIDIA/Audio2Face-3D-SDK` @ 1ca0f02) runs the regression model
   `nvidia/Audio2Face-3D-v2.3-Mark` (NVIDIA Open Model License, pinned commit).
2. The SDK's blendshape-solve executor (CPU solver, skin + tongue) writes one row of ARKit-style
   weights per 30 fps frame to `<run>/a2f-weights.csv`.
3. `th/rig/a2f_map.py` maps them to `<run>/timeline.json`.
4. The capture renders that timeline.

Runtime:
- The SDK needs CUDA >= 12.8 and TensorRT 10.13. This box's Windows toolkit is 12.4, so it builds on
  Linux in `th/rig/a2f_sdk/Dockerfile`:
  - base `nvidia/cuda:12.9.1-devel-ubuntu22.04`;
  - TensorRT 10.13.3.9 from the CUDA apt repo, pinned by apt preferences;
  - the SDK at the pinned commit;
  - `th-a2f-blendshapes` (`th/rig/a2f_sdk/main.cpp`), added as an SDK sample.
- The image carries no weights. `th fetch a2f-keys` does the set-up:
  - downloads the model to `$TH_HOME/models/a2f-keys/audio2face-3d-v2.3-mark`;
  - builds the image `th-a2f-sdk:1ca0f02`;
  - builds the TensorRT engine with the image's own `trtexec` into `models/a2f-keys/gen/mark/`,
    under the GPU lock;
  - writes `licence.json` (NVIDIA Open Model License:
    https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).
- No emotion model: Audio2Emotion is gated, so the emotion input is the neutral vector, as the SDK
  samples use by default.

Calibration, measured first on pitch-45s:
- Mark's rest face is not zero. In silence jawOpen sits at 0.09, mouthShrugLower at 0.39,
  mouthSmile at 0.12 and mouthStretch at 0.15.
- With a neutral emotion the upper face hardly moves: browInnerUp max 0.037, browOuterUp 0,
  browDown flat at 0.07.
- The first render (v1, run 20261116T122918Z) mapped the raw weights. Iris's mouth never closed
  (open on 93 % of frames), and no gesture fired.
- So every channel is now made relative to the clip's own rest and range:
  - `rest_c` = the median of channel c over the rest frames (jawOpen at or under its 20th
    percentile);
  - `n(c)` = clamp((c - rest_c) / (p95_c - rest_c), 0, 1), and 0 when that span is under 0.05
    (noise stays at rest).

Mapping table (L/R pairs averaged; `ramp(x, a, b)` = clamp((x - a) / (b - a), 0, 1)):

| our channel | from A2F blendshapes |
| --- | --- |
| aperture (helper) | n(jawOpen) x (1 - n(mouthClose)) |
| roundness (helper) | max(n(mouthFunnel), n(mouthPucker)) |
| seal (helper) | max(n(mouthPress), n(mouthRollLower), n(mouthRollUpper)) |
| `openWide` | ramp(aperture, 0.55, 0.95) x (1 - roundness) |
| `openMid` | ramp(aperture, 0.12, 0.55) x (1 - ramp(aperture, 0.55, 0.95)) x (1 - roundness) |
| `round` | roundness x ramp(roundness, 0.25, 0.7) |
| `narrow` | ramp(n(mouthStretch), 0.3, 0.9) x (1 - roundness) x (1 - ramp(aperture, 0.3, 0.6)) |
| `teeth` | ramp(n(mouthUpperUp), 0.3, 0.9) x (1 - roundness) x (1 - ramp(aperture, 0.3, 0.6)) |
| `closed` | ramp(seal x (1 - aperture), 0.4, 0.9) |
| `tongue` | ramp(n(tongueOut), 0.3, 0.9) |
| `rest` | 1 - the others; the mix is scaled to a total of 1 when it is above |
| `mouthGain` | 0.85 + 0.3 x n(jawOpen) (eased 0.2 s), clamped 0.3..1.5 |
| family `joy` | r(mouthSmile) + 0.5 r(cheekSquint) |
| family `smug` | 2 x abs(r(mouthSmileLeft) - r(mouthSmileRight)) |
| family `anger` | r(browDown) + 0.5 r(noseSneer) |
| family `gloom` | r(mouthFrown) + 0.5 r(browInnerUp) |
| family `showman` | r(browOuterUp) + 0.5 r(browInnerUp) |
| family `suspicion` | r(eyeSquint) x (1 - r(mouthSmile)) |
| `gesture: nod` | energy = n(jawOpen) eased 0.25 s; a local maximum at or above the clip's 92nd percentile of energy (a stressed syllable) |
| `gesture: tilt` | a phrase start: energy rising past its 30th percentile after >= 0.5 s under it |
| `blink`, `gaze` | null: the player's own blink and eye habits |

`r(c)` = the channel minus its rest, floored at 0. It is not range-normalised, so a still channel
stays near 0 instead of being blown up to 1.

Rules:
- **Expression.** Each family's score is eased over 0.6 s. The best score shows once it reaches 0.3,
  with w = score / 0.7 capped at 1. A shown family is held at least 1.2 s. It leaves below 0.18, or
  hands over to a family that is higher by 0.1.
  - With a neutral emotion input, no family reaches 0.3 on pitch-45s, so `expression` stays null
    and the player's own mood holds.
  - Finding: A2F without Audio2Emotion carries speech, not affect. Audio2Emotion v2.2 is gated on
    Hugging Face (accepting its licence needs an HF token).
- **Gestures.**
  - A nod at most every 4 s, a tilt at most every 6 s, and no two gestures within 1 s of each other.
  - The thresholds are percentiles because A2F holds the jaw a little open through short pauses:
    eased energy has a median of 0.26 in silence and 0.39 in speech.
  - On pitch-45s this gives about 9 nods and 6 tilts.
- **The rig's own gains apply after the mix.** Iris's per-shape `mouthGain` (openWide 0.45,
  openMid 0.7, round 0.6, tongue 0.7, narrow 0.75; closed and teeth 1) is applied by the morph plan,
  exactly as for the studio's lip-sync.
- **The SDK's output.** th-a2f-blendshapes writes 68 weights per frame:
  - the 52 ARKit skin poses (bs_skin.npz `poseNames` minus `neutral`);
  - 16 tongue poses, prefixed `tongue:` (the mapper does not use them).

### dub-ls

The steps:
1. **The plate.** The product player with the mouth forced to `rest`, and every other behaviour
   live: `timeline.html?audio=...&mouth=rest`, i.e. `setMouthShapes(rest)` every frame.
2. **LatentSync 1.6.** `bytedance/LatentSync` @ a229c39 (code Apache-2.0) with weights
   `ByteDance/LatentSync-1.6` @ c42c7e6 (OpenRAIL++-M; owner ruling 2026-11-16: OpenRAIL family
   accepted, with its use restrictions recorded in `licence.json`):
   - the stock `scripts/inference.py`;
   - `stage2_512`, 20 steps, guidance 1.5, DeepCache;
   - VAE `stabilityai/sd-vae-ft-mse` (MIT), whisper tiny (MIT).
3. **Output.** 25 fps (LatentSync resamples its input); the normaliser brings it to 30.

**Face alignment without InsightFace.**
- **Why.** Upstream aligns faces with InsightFace `buffalo_l` (detection + 2d106 landmarks), which
  is licensed for non-commercial use only. Director ruling 2026-11-16: replace only that.
- **How.** `th/rig/ls_run.py` puts `th/rig/ls_face.py` (MediaPipe Face Landmarker, Apache-2.0, the
  core `th fetch mediapipe` model) into `sys.modules["latentsync.utils.face_detector"]` before
  LatentSync imports it. The upstream file, which imports insightface at its top, is never loaded,
  and no upstream file is edited.
- **The env.** `th fetch dub-ls` writes `$TH_HOME/models/dub-ls/requirements.th.txt`: upstream's
  requirements minus `insightface`, `onnxruntime-gpu` (its runtime) and `gradio` (the demo UI),
  with torch and torchvision pinned to `+cu121`. So insightface is never installed in
  `$TH_HOME/envs/dub-ls`.

Point mapping. LatentSync reads only these 106-point indices. The adapter fills exactly those from
MediaPipe's 478 landmarks and leaves everything else at 0:

| LatentSync point | 106-pt indices it averages | MediaPipe landmarks averaged |
| --- | --- | --- |
| image-left brow | 43, 48, 49, 51, 50 | 70, 63, 105, 66, 107, 46, 53, 52, 65, 55 (the subject's right brow) |
| image-right brow | 101-105 | 300, 293, 334, 296, 336, 276, 283, 282, 295, 285 |
| nose | 74, 77, 83, 86 | 197, 195, 5 (nose bridge) |
| face box | (only checked non-None) | the landmarks' extent |

- **Brow order.** The two brows are ordered by x, so the template's left always receives the
  image-left brow.
- **Nose height.** The nose points are chosen to match the template's geometry. LatentSync's
  template puts the nose 20 / 41 = 0.49 brow-spacings below the brow line. On Iris (frame 75 of the
  baseline), MediaPipe 197 / 195 / 5 sit at 0.39 / 0.47 / 0.56, so their mean lands at 0.47.
- **The fit.** LatentSync's own similarity fit and its temporal smoothing (`smooth=True`) are
  unchanged.
- **Every run's check.** Each run writes `<run>/alignment-sheet.png`: frames 0, 60 and 120 with the
  3 points and the box drawn, beside LatentSync's aligned 512 crop. The log prints each fit's
  rotation and scale and the mouth's position in the crop.
- **Falsification on a 5 s plate** (smoke-6s, seed 1116, before any full render): the crops are
  upright and centred, with no jitter or tilt.

  | frame | rotation | scale | mouth in the 512 crop (x, y) |
  | --- | --- | --- | --- |
  | 0 | +0.76 deg | 1.214 | (255.6, 324.5) |
  | 60 | +0.46 deg | 1.214 | (257.0, 325.1) |
  | 120 | +0.69 deg | 1.219 | (256.1, 325.5) |

  The rotation follows the player's own head sway.

**Paste-back (`TH_DUB_PASTE`, `th/rig/dub_paste.py`).**
- **Why.** LatentSync pastes its whole aligned crop back, VAE round-trip included. So in v1 the
  upper face lost its texture too: cheek Laplacian variance 10-13 against the plate's 34.
- **"mouth" (the default).** Only the lower face is LatentSync's:
  `final = plate25 x (1 - m) + latentsync x m`.
  - `plate25` is the 25 fps plate LatentSync itself read, copied from `<repo>/temp/video.mp4`.
    LatentSync loops it ping-pong to the audio's length, and the composite follows the same index.
  - `m` comes per frame from MediaPipe landmarks (CPU) on that plate frame. The polygon is the face
    oval from MP 132 around the chin to 361, pushed out 24 px from the mouth so the jaw line and the
    jaw drop stay inside. It closes across the lower cheeks and under the nose
    (425, 426, 391, 164, 165, 206, 205). The edge is feathered with a 16 px Gaussian.
- **"crop".** Keeps LatentSync's own paste (v1).
- **Files.** raw.mp4 is the pasted video; ls-raw.mp4 is LatentSync's own output.
- **Post-only re-run.** `uv run python -m th.rig.dub_repost <dub-ls run dir> [--device cpu|cuda]
  [--keep <seconds,...>]` builds a new run dir from an existing run's outputs, with no new
  LatentSync render. It then runs normalise, alpha and metrics; on the CPU by default, so no GPU
  lock is needed.

### Results, pitch-45s (2026-11-16)

| run | SyncNet conf / offset | identity mean / min / p5 | renderS (arm) | rtf | VRAM peak |
| --- | --- | --- | --- | --- | --- |
| baseline `20261116T103859Z` | 5.582 / 1 | 0.9838 / 0.9216 / 0.9361 | 50.5 | 1.13 | 506 MiB |
| a2f-keys v1, raw weights `20261116T122918Z` | 5.647 / 0 | 0.9837 / 0.9370 / 0.9429 | 63.9 | 1.42 | 1607 MiB |
| a2f-keys v2, calibrated `20261116T133403Z` | 6.340 / 0 | 0.9797 / 0.9204 / 0.9323 | 59.6 | 1.33 | 1562 MiB |
| dub-ls v1, LatentSync paste `20261116T133326Z` | 9.356 / 0 | 0.9778 / 0.9428 / 0.9635 | 512.8 | 11.42 | 20112 MiB |
| dub-ls v2, lower-face paste `20261116T140056Z` | 9.184 / 0 | 0.9797 / 0.9464 / 0.9665 | 575.7 (512.8 + 62.9 paste) | 12.83 | 20112 MiB (v1's) |

Notes on the table:
- dub-ls v2's metrics ran on the CPU; all other runs' ran on the GPU.
- LatentSync is trained with a SyncNet loss, so its SyncNet score is partly measured with its own
  yardstick.

dub-ls sharpness (variance of the Laplacian, 1024 px frame; plate25 / v1 / v2, at t = 6.20 / 15.32 / 33.48 s):

| region | plate25 | v1 | v2 |
| --- | --- | --- | --- |
| mouth | 45.8 / 50.8 / 47.5 | 22.7 / 21.4 / 19.8 | 24.7 / 25.5 / 23.3 |
| cheek | 33.9 / 37.8 / 30.6 | 9.9 / 13.5 / 11.9 | 32.0 / 33.3 / 28.2 |
| upper cheek | 143.5 / 155.5 / 154.8 | 71.1 / 83.9 / 92.4 | 140.1 / 147.5 / 151.9 |
| chin (inside the mask) | 19.3 / 14.8 / 15.0 | 7.7 / 7.9 / 7.5 | 9.9 / 10.6 / 9.3 |

- **Inside the mask** (the mouth and the chin) stays LatentSync-soft. Resolution is not the cause:
  the aligned crop samples the face at 1.21x the frame's scale. The VAE and the diffusion drop the
  skin texture.
- **Outside it**, v2 is back to the plate.
- **At the mask edge**, at 4x zoom there is no line and no colour step. Pore texture fades over
  about 30 px into the smooth lower cheek.
- **The mic boom** survives intact in v1 and v2 on all three frames.

## Results, pitch-45s (2026-11-16)

Iris, Kokoro `af_heart`, seed 1116. Five arms on one blind board: `var/talking-head/boards/pitch-45s/`
(`board.mp4`, `key.json`, `verdict.md`). Every timing was taken with another program on the GPU
(`gpuExclusive: false`), so render times are upper bounds.

| arm | approach | SyncNet conf (offset) | identity mean / min | rtf | VRAM peak |
| --- | --- | --- | --- | --- | --- |
| baseline | today's morph face, studio lip-sync | 5.58 (1) | 0.984 / 0.922 | 1.13 | 0.5 GB |
| a2f-keys | Audio2Face-3D weights drive the morph face | 6.34 (0) | 0.980 / 0.920 | 1.33 | 1.6 GB |
| realtime-fh | SoulX-FlashHead Lite, streaming diffusion | 8.18 (0) | 0.889 / 0.782 | 1.05; 37 fps sustained, TTFF 730 ms | 6.4 GB |
| diffusion-sa | StableAvatar, offline diffusion | 4.79 (-4) | 0.912 / 0.692 | 115.7 | 18.9 GB |
| dub-ls | rig idle plate + LatentSync 1.6 mouth, lower-face paste | 9.18 (0) | 0.980 / 0.946 | 12.8 | 20.1 GB |
| diffusion-it | InfiniteTalk 14B | not rendered (see above) | | | |

Reading it:
- dub-ls keeps our rig's identity and motion and gets the best mouth. Caveat: LatentSync trains with
  a SyncNet loss, so its score is partly self-graded. The mouth and chin are softer than the plate.
- realtime-fh is the only arm that is both photoreal in motion and real time, but it drifts from the
  portrait: freckles lost, skin smoothed, face slimmed.
- diffusion-sa keeps the character best of the diffusion arms, and shows the most expression, but costs
  ~2 GPU-hours per video-minute, leads the audio by 4 frames upstream, and washes out in its last window.
- a2f-keys improves the mouth a little. Without Audio2Emotion (gated) Audio2Face gives the brows no
  signal, so it cannot add the audio-emotion coupling the market research ranked second.
- The lab's own `avOffsetMs` (mouth-ROI motion against loudness, `pnpm lab th-import` + `measure`) came
  out low or medium confidence on these runs (z 1.6-2.4) and disagrees with SyncNet on a2f-keys, dub-ls
  and diffusion-sa; SyncNet is the sync measure of record here.

## Live (`th live`, spec `flashhead-live`)

Live Iris on SoulX-FlashHead Lite: a local WebSocket server streams her face and voice on one clock
(protocol `fhl/1`, `.kiro/specs/flashhead-live/design.md`); the web app's `/live` drives it and
`/live?out=1` shows it.

```
uv run th fetch realtime-fh             # once: FlashHead repo, env and weights
uv run th live [--port 8765] [--upscale maxine|none|realesrgan] [--allow-origin <origin>]...
uv run th live --fake                   # synthetic face and voice, no GPU (UI work)
uv run th live-bench --script pitch-45s --upscale none
uv run th live-bench --idle-s 20 --upscale none
```

- `th live` (core env) installs `th/live/requirements.txt` into the FlashHead env once (the marker
  `$TH_HOME/envs/realtime-fh/.th-live-requirements` holds the list's hash), fetches NVIDIA's
  `nvidia-vfx` wheel when the upscaler is `maxine` (the default; idempotent), then runs
  `python -m th.live serve` in the FlashHead env with tools/talking-head on `PYTHONPATH`. The child
  exits when `th live` exits, however it ends.
- If the upscaler cannot load (or fails on a chunk), the stream carries on with `none`: one `error`
  event names the reason and `state` says `upscale: "none"`.
- Bound to 127.0.0.1 only. `GET /health` answers `{"ok":true,"proto":"fhl/1"}` (with CORS for allowed
  origins). Browser origins other than `http://localhost:*`, `http://127.0.0.1:*` and each
  `--allow-origin` are closed with code 4403. A client that sends no Origin is a local process and
  is accepted.

### How it runs

- **Input**: Iris's portrait cropped to the bust, box (192,140)-(832,780) of the 1024 portrait,
  written to `$TH_HOME/live/iris-bust.png` and passed with `use_face_crop` off.
- **Engine** (`th/live/engine.py`): one GPU thread turns each 0.96 s slice of 16 kHz audio into 24
  frames, forever. Stream clock: ms since streaming began; frame i has pts i*40. A FIFO of audio
  segments (say/chat sentences, mic packets) feeds the slices, padded with silence. The audio each
  chunk consumed is the audio sent for it, at the pts of its first sample, so lip-sync holds by
  construction. Silence is fed to the model, never sent.
- **Pacing and queue bound**: a chunk starts computing at most 2 chunks (1.92 s) before its pts when
  a full slice of speech is waiting, and 1 chunk before when idle or starved (so a new line still
  makes the next chunk). The encode/emit queue holds 2 chunks and blocks the GPU thread beyond that.
  A chunk that would start a whole chunk late is skipped (`droppedChunks`), never drifted.
- **Frames**: upscaled on the GPU, JPEG-encoded (quality 90) on a 4-thread pool, so the GPU loop
  never waits on encoding; an emitter thread sends finished chunks in order. Each client has its own
  send queue; a viewer more than 300 messages behind loses binary messages, never JSON.
- **Voice** (`th/live/tts.py`): Kokoro (`af_heart`, as `th audio`) sentence by sentence. kokoro-onnx
  needs numpy 2 and the FlashHead env is pinned to numpy 1 (mediapipe), so Kokoro runs in ONE worker
  process in the core env (`python -m th.live.tts_worker`), started with the server (model load plus
  one warm-up sentence, ~1.5 s, while FlashHead loads) and reused for every sentence. Audio is
  resampled to 16 kHz for FlashHead and played at 24 kHz.
- **Lines** (`th/live/speaker.py`): `say` lines are FIFO. A `chat` turn is one line whose id is the
  chat message id: `line-start`, one `reply-text` per sentence (at that sentence's first sample),
  `line-end`. A new chat or `stop` cancels the reply task (which closes the LLM stream) and drops
  its unsent audio.
- **Stop**: cut lines get `line-end` with `text: "stopped"`. Audio not yet sent is dropped at once;
  frames keep flowing (the stream never stops). The out client may still hold up to its playout
  buffer of speech it already received.
- **Puppet**: binary 0x10 PCM16 16 kHz is fed to FlashHead as is and echoed as 0x02 at its pts; the
  mic backlog is capped at 2 slices (oldest dropped). `say`/`chat` are refused while the source is
  `mic`.
- **Slides**: `slide` + one 0x13 is relayed as 0x03 to every `out` client plus an `event` `slide`
  (index in `text`); an empty image clears the slide (empty 0x03, `text: null`).
- **`state.delayMs`**: median over the last 5 lines of (line-start pts - stream ms at the command's
  receipt) plus the out client's 250 ms playout buffer; before any line, 1.69 s.
- **`timing.firstFrameMs`**: command receipt to the first video frame of that line leaving the
  server (handed to the client queues).

### live-bench

`th live-bench` takes the GPU lock and runs the same engine headless in the FlashHead env. A script's
paragraphs are said one line at a time (each 0.6 s after the previous `line-end`, after 2 s of idle),
so every line's `firstFrameMs` is a cold command. The run dir holds `raw.mp4` (output size),
`speech.wav` (the sent audio placed at its pts), `video.mp4` (normalised as `th render`),
`run.json` (`arm: "live-fh"`), `bench.json` (raw per-chunk figures) and `live.json` (`th-live/1`):
`fps` (frames sent before their pts per stream second: 25.0 exactly when nothing was late or
dropped), `capacityFps` (24 / chunk compute s, p50 and p95), `chunkMs`, `upscaleMs`, `droppedChunks`,
`lateChunks`, `slackMs` (pts minus emission time), per-line `firstFrameMs`/`ttsFirstMs`,
`sharpness` (mean variance of the Laplacian on the face crop of video.mp4, grey, 1 frame/s), SyncNet,
identity and the GPU co-tenants. `--idle-s N` streams N s of silence and adds `idle-sheet.png`
(6 frames), `idle-5s.mp4` and `idle.json`.

### Measured (RTX 4090, 2026-11-16, upscale none)

pitch-45s, seed 1116, with World of Warcraft on the GPU (3.85 GB):

| figure | value |
| --- | --- |
| delivered | 25.0 fps: 0 late, 0 dropped of 50 chunks; slack min 277 ms |
| capacity | 35.4 fps (chunk p50 679 ms, p95 701 ms, max 721 ms) |
| SyncNet conf (offset) | 8.33 (-1) |
| identity mean / min / p5 | 0.974 / 0.949 / 0.959 (0.889 / 0.782 for the wide portrait, `realtime-fh`) |
| firstFrameMs per line | 805, 1065, 1185, 1299 (Kokoro first sentence 376-602 ms) |
| VRAM | 6.1 GB; model load 10.7 s; Kokoro worker ready 1.4 s |

Through the server (a WebSocket client on 127.0.0.1): a `say` line's first sample sits 1.76-1.80 s
after the command on the stream clock (`delayMs` 2.0 s with the playout buffer), firstFrameMs
0.79-1.1 s. A `chat` turn (claude CLI) gave its first sentence after 2.4-2.5 s and its first frame
after 4.7-4.8 s. After `stop`, no speech audio was sent at all.

Idle (20 s of silence): Iris is effectively still. Head shift under 0.06 px, no blink in the eye
crops, mouth range 3.9/255; only texture shimmer (frame step 0.52/255) and a small step at every chunk
seam (1.34/255, every 0.96 s). Pink noise fed as idle input at -50 and -40 dBFS changed none of these
figures (head shift 0.06 px, mouth range 3.8 and 4.0, seam step 1.36), so that is not the fix. The
seam step is there in speech as well (2.21 vs 1.37 elsewhere).

### Upscalers (`--upscale none|realesrgan|maxine`)

FlashHead Lite renders 512x512. An upscaler takes each 24-frame chunk on the GPU (uint8 `(24,512,512,3)`)
and returns `(24,1024,1024,3)` before JPEG encoding. `none` sends 512 and lets the browser scale it.
Code: `th/live/upscale/` (`realesrgan.py`, `maxine.py`, `weights.py`, and `ab.py`, the A/B tool).

| kind | what | weights / package | licence |
| --- | --- | --- | --- |
| `realesrgan` | SRVGGNetCompact `realesr-general-x4v3`, fp16 CUDA, channels-last, one 24-frame batch: 512 -> 2048, then an exact 2x2 area average to 1024. The arch is inlined (no basicsr). | `$TH_HOME/models/live-upscale/realesr-general-x4v3.pth` (4.9 MB, sha256-pinned), fetched on first use | BSD-3-Clause (xinntao/Real-ESRGAN `LICENSE`; the weights are its release assets) |
| `maxine` | NVIDIA Video Super Resolution (Maxine VFX SDK 1.3) through NVIDIA's `nvidia-vfx` 0.2.0.0 Python bindings, quality `HIGHBITRATE_HIGH`, one SDK call per frame (DLPack, no copies to the host) | wheel from `pypi.nvidia.com` (436 MB), unpacked to `$TH_HOME/models/live-upscale/nvvfx-cp310/` (FlashHead env) or `nvvfx-cp312/` (th env) by `python -m th.live.upscale.maxine fetch` | NVIDIA Software License Agreement + Product-Specific Terms for NVIDIA AI Products; models under the NVIDIA Open Model License (below) |

`$TH_HOME/models/live-upscale/licence.json` carries one row per weight file and wheel, in the `th fetch` shape.
A native x2 compact model exists in the same release (`RealESRGANv2-animevideo-xsx2`, BSD-3), but it is
trained on anime. It is measured below and not shipped. Real-ESRGAN publishes no photo-trained compact x2.
`RealESRGAN_x2plus` is the heavy RRDBNet (67 MB), so it is out of the live budget.

**Maxine terms, read before building.** The terms are in the wheel's `dist-info/licenses/`: `NVIDIA-Software-License-Agreement-2025.05.05.pdf`, `product-specific-terms-for-nvidia-ai-products-2025.05.05.pdf` and `NVIDIA-Open-Model-License-Agreements-24-10-2025.pdf`.
- **Access.** No NVIDIA account is needed. The wheels are public on https://pypi.nvidia.com/nvidia-vfx/ for Windows and Linux (cp310 and cp312, plus win_arm64). The NGC SDK download does need a developer-program login. That path is not used.
- **Commercial use.** The NGC VSR collection (https://catalog.ngc.nvidia.com/orgs/nvidia/maxine/collections/nvvfxvideosuperres) says: "This feature is available for commercial/non-commercial use". It also says the effect "is governed by the NVIDIA SOFTWARE LICENSE AGREEMENT", and "Use of the models is governed by the NVIDIA Open Model License" ("Models are commercially usable").
- **Binding limits.**
  - SLA 8.4: no reverse engineering.
  - SLA 8.5: no redistribution, except inside a Customer Product. We do not ship the wheel: each machine downloads it from NVIDIA.
  - SLA/PST 8.9: "Customer may not distribute or disclose to third parties the results of benchmarking, competitive analysis, regression or performance data relating to the Software without the prior written permission from NVIDIA". **So Maxine performance figures stay out of this repo; they live in the gitignored internal note named under "Verdict".**
  - PST 8.17: not for emotion recognition.
- **Status.** On PyPI the package is "Development Status :: 3 - Alpha". SLA section 3 lets Pre-Release software be used "at Customer's risk".

#### Verdict (figures internal)

The A/B figures live in `var/talking-head/live-upscale-ab/INTERNAL-benchmarks.md` (gitignored) and are not
published, per SLA 8.9. In short: `maxine` keeps Iris's skin texture and identity, adds a small amount of
sharpness, and holds 25 fps with another app on the GPU, so it is the default (owner-accepted licence,
2026-11-16). `realesrgan` (BSD-3) is the open-licence fallback: sharper, but it repaints the face (smooth,
painterly skin, freckles lost) and misses real time when the GPU is shared.

### The web pages: `/live` and `/live?out=1`

The app (`apps/web/src/live/`) drives the live server over `fhl/1`. Start the server first (`uv run th live` in `tools/talking-head`), then open the app (`pnpm dev`).

- **`/live`, the control page** (hotkey `L`, off the dial and off the strip). It sits in the app's frame, like the studio.
  - Connection lamp and the server's `state` line: ready, fps, upscale, delay, queue, size and source.
  - With no server, a designed empty state shows the command to run (`uv run th live`, plus `--port` when `?server=` names another port, plus `--allow-origin <this origin>` after a 4403 refusal), with a Copy button. The page retries with a backoff of 0.5, 1, 2, 4 and then 8 s, and connects by itself once the server is up.
  - **Upscaler**: a segmented switch (None / Real-ESRGAN / Maxine). It shows the requested kind until the server's `state` confirms it. A server `error` event that no line claims shows inline under the toolbar.
  - **Stop** sends `stop`, ends a running slide deck where it is, and clears the slide this page put up.
  - **Tabs** (arrow keys, Home and End move between them). All tabs stay mounted, so a running deck or mic keeps going in the background.
    - **Lines**: type a line and press Speak (or Enter). The history lists every line sent, slide lines included, with its status (queued, speaking, done, not spoken) and the server's `timing`: first frame, chunk and upscale ms, plus the spoken length from `line-start` to `line-end`.
    - **Chat**: the message goes as `chat`. The thread shows Iris's `reply-text` sentence by sentence as she speaks them. The LLM key never reaches the page.
    - **Puppet**: Start the microphone sends `source: mic`, then streams 0x10 frames: getUserMedia, then an AudioWorklet, then resampling to 16 kHz with a box-filter and linear interpolation, then 640-sample (40 ms) PCM16 chunks. A level meter shows the input. Stop sends `source: text`. The mic stops by itself if the connection drops. Lines and Chat are disabled while the server's source is `mic`.
    - **Slides**: pick a folder. Its images (PNG, JPEG or WebP) play in natural name order, so `2` comes before `10`.
      - `script.md` in the folder holds the lines: `## 1`, `## 2`... sections, one line per paragraph. Wrapped lines are joined, and text before the first section is ignored.
      - Start sends `slide` plus its 0x13 image, then each line as `say` with the id `slide-<index>-<line>` (both 0-based). The deck moves on when the last line's `line-end` arrives.
      - A slide with no lines holds for 4 s.
      - Previous and Next send `stop` first.
      - Pause lets the current line finish, then holds the slide.
      - Clear slide sends `slide` with the shown index followed by an empty `0x13`; the server relays it as an empty `0x03`, and the out view puts Iris back in the centre. The page sends the same clear when the deck ends and on Stop (when it has a slide up).
  - **Preview**: a small, silent `out` client of the same stream, on a checkerboard, with the OBS URL to copy.
- **`/live?out=1`, the OBS browser source**: the stream alone on a transparent page, with no chrome.
  - Iris is centred and as large as the viewport allows.
  - While a slide is active, the slide fills the frame and Iris sits in a corner: `?corner=br|bl|tr|tl`, default `br`. `?slides=0` ignores slides.
  - `?server=ws://host:port/live` points either page at another server. The default is `ws://127.0.0.1:8765/live`.
  - Playout: audio chunks are scheduled on a WebAudio clock at `pts + 250 ms`, measured from the first pts received. JPEG frames are decoded with `createImageBitmap` and drawn when their pts comes up on the same clock.
    - Late frames are dropped.
    - A late audio chunk starts at once with its late part skipped, so audio is never stretched and never drifts.
    - If the browser keeps the AudioContext suspended, frames run on the wall clock and a "Click to start the sound." button shows. The playhead carries over when the audio clock starts. OBS does not suspend audio.
    - A reconnect, or a pts that jumps back by more than 1 s or ahead by more than 5 s, re-anchors the clock.
  - The page writes its figures to data attributes on `[data-live-out]`: `data-drawn`, `data-dropped`, `data-chunks` and `data-size`.
- **Without the GPU**: run `node apps/web/e2e/fakeLive.ts [port]` for a fake `fhl/1` server, then open `/live?server=ws://127.0.0.1:8790/live`. The fake streams synthetic 25 fps JPEG frames, and each `say` plays a 1 s 440 Hz tone with its `line-start`, `timing` and `line-end` messages.
- **Tests**: unit tests for the codec, client, clock, slides, PCM and history live in `src/live/*.test.ts`. The e2e test is `apps/web/e2e/live.e2e.spec.ts`. Run it after building, with `SR_E2E_PORT=5320 pnpm --filter ./apps/web exec playwright test -c playwright.e2e.config.ts live.e2e.spec.ts`.

### Conversation (`th/live/chat.py`, task 4)

A `chat` command turns into one streamed reply. `reply_sentences(text, history)` yields Iris's
reply one speakable sentence at a time while it streams, and the engine sends each sentence to
Kokoro as soon as it arrives, so she starts talking after the first sentence, not after the whole
reply.

- **Transport.** `TH_LIVE_LLM=cli` (the default) or `api`.
  - `cli` runs the locally logged-in `claude` CLI, one process per turn (`th/live/chat_cli.py`,
    the same shape as the lab's `apps/lab/src/director/llm/cliTransport.ts`): `claude -p
    --output-format stream-json --include-partial-messages --verbose --model <model> --effort low
    --tools "" --system-prompt <persona> --no-session-persistence --setting-sources ""
    --strict-mcp-config --disable-slash-commands`, prompt on stdin, in the empty folder
    `$TH_HOME/live/cli-cwd`, so no CLAUDE.md, settings, MCP servers or tools reach it.
    `TH_LIVE_CLAUDE` points at another executable. Each call is a fresh process, so the capped
    history goes into the prompt as `<history><turn role="...">` blocks. The child gets no API key
    (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_KEY_LANE_*` are removed) and none of a
    parent Claude Code session's variables (`CLAUDECODE`, `CLAUDE_CODE_*`), so it uses the owner's
    login. Text deltas come from the `stream_event` lines; the `result` line ends the last
    sentence at once, before the process exits. One call times out after 60 s.
  - Cancelling (a new chat, `stop`, `aclose()`) kills the CLI and its children (`taskkill /T /F`
    on Windows, the process group elsewhere) and reaps it.
  - Measured once (2026-11-16, `claude-haiku-5-5` via Claude Code 2.1.325, "Introduce yourself in
    one sentence."): first sentence 3030 ms, total 3030 ms (a one-sentence reply), including
    process start.
  - `api` is the Messages API path below; the hackathon account has no credit at the moment.
- **Key (`api` only).** Read by the Python server only, from `ANTHROPIC_KEY_LANE_HACKATHON` (else
  `ANTHROPIC_API_KEY`). It goes into the SDK client and nowhere else: never into a WebSocket
  frame, an event, a log line or a return value. Error log lines replace the key with `***`.
- **Model.** `claude-haiku-5-5` by default; `TH_LIVE_MODEL` overrides. Haiku runs with thinking
  off at effort `low` and `max_tokens` 300 (the same settings `packages/engine` uses for one-line
  replies). Any other model keeps its default adaptive thinking (Opus 5.5 and Sonnet 5.5 refuse
  `thinking: disabled`) at effort `low` with `max_tokens` 1024. The client has a 20 s timeout and
  one retry; one client is kept per event loop, so turns after the first reuse the connection.
- **Persona.** `th/live/persona.md` is the system prompt: Iris, the photoreal cyber-streamer
  companion (silver bob, headset with boom mic; calm, warm and close, the "velvet" voice of her
  pack), a fictional AI character who never claims to be human. Spoken rules: one to three
  sentences unless asked for more, no markdown, no emoji, no stage directions, numbers and
  abbreviations as they are said, no URLs.
- **Sentences.** A terminator (`.`, `!`, `?`, an ellipsis) ends a sentence once the next non-space
  character has arrived and does not continue it, so `3.5`, `Dr. Lee`, `e.g. this` and `well...
  maybe` stay whole; a newline always ends one. A run-on with no terminator is cut at a comma past
  220 characters. Each sentence is cleaned before it is yielded: markdown (emphasis, headings,
  bullets, numbered markers, code ticks, links to their text), URLs, `[bracketed asides]`, emoji
  and emoticons are removed; a sentence with nothing speakable left is dropped.
- **History.** The caller owns a list of `{role, content}`. After a turn it holds the user line and
  the reply as spoken, capped in place to the last 12 exchanges (24 messages), always starting on
  a user turn. A cancelled reply records only the sentences yielded before the cut; a turn that
  yielded nothing records nothing.
- **Cancellation.** A new chat or `stop` cancels the task iterating the generator (or calls
  `aclose()`); the SDK stream is closed at once, so no tokens keep flowing for a reply nobody hears.
- **Errors.** A missing key or a missing `claude` executable yields "Sorry, I can't chat right now, my conversation link isn't set
  up."; an API, network or CLI error (not logged in, non-zero exit, timeout) yields "Sorry, I lost my train of thought there, could you say that
  again?" (after whatever was already said). A refusal with nothing said yields one short decline.
  The cause is logged on the server (`th.live.chat`: error type, status, request id).
- **Setup.** `anthropic` is in `th/live/requirements.txt`, installed into the FlashHead env by
  `th live`. The module imports it lazily, so `uv run pytest` runs the chat tests (a fake streaming
  client) without the SDK.
