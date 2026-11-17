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
uv run th live [--port 8765] [--upscale maxine|none|realesrgan|iris] [--allow-origin <origin>]...
               [--matte] [--no-idle-loop] [--motion off|natural|lively] [--no-speech-glances]
uv run th live make-idle [--seconds 12] [--pick <track>] [--only a,b]   # once: the idle loop
uv run th live --fake                   # synthetic face and voice, no GPU (UI work)
uv run th live-bench --script pitch-45s --upscale none [--motion off|natural|lively]
uv run th live-bench --idle-s 20 --upscale none
uv run th live-bench --script smoke-6s --lead-s 5 --tail-s 5   # idle, a line, idle
```

Environment switches (read by the server and the bench): `TH_LIVE_LOOKAHEAD_MS` (fixes the idle
look-ahead, which is otherwise adaptive; see "Round 2"), `TH_LIVE_SEAM=0` (seam blend off),
`TH_LIVE_IDLE=0` (idle loop off), `TH_LIVE_SPEECH_GLANCES=0` (gaze glances in idle only), `TH_LIVE_MATTE=<kind>` (matte kind, default `birefnet-lite-matting`, `th.live.matte.kinds.DEFAULT`).

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
  a full slice of speech is waiting, and the idle look-ahead (adaptive, 750-960 ms; see "Round 2")
  before when idle or starved (so a new line still makes the next chunk). The
  encode/emit queue holds 2 chunks and blocks the GPU thread beyond that. A chunk that would start a
  whole chunk late is skipped (`droppedChunks`), never drifted.
- **Frames** (`th/live/compose.py`, `th/live/stages.py`): seam blend, then the idle loop mixed in,
  then the matte (when on), the head motion (round 3; the head only since round 4) and the upscaler on the GPU, then JPEG (quality 90) on a 4-thread pool, so
  the GPU loop never waits on encoding; an emitter thread sends finished chunks in order. With the
  seam blend a chunk's 24 frames start 3 frames (120 ms) before its audio slice: the previous
  chunk's last 3. Each client has its own send queue; a viewer more than 300 messages behind loses
  binary messages, never JSON.
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
  frames keep flowing (the stream never stops). That `line-end` is the stop marker: out clients
  flush everything they have not played yet when it arrives.
- **Puppet**: binary 0x10 PCM16 16 kHz is fed to FlashHead as is and echoed as 0x02 at its pts; the
  mic backlog is capped at 2 slices (oldest dropped). `say`/`chat` are refused while the source is
  `mic`.
- **Slides**: `slide` + one 0x13 is relayed as 0x03 to every `out` client plus an `event` `slide`
  (index in `text`); an empty image clears the slide (empty 0x03, `text: null`).
- **`state.delayMs`**: median over the last 5 lines of (line-start pts - stream ms at the command's
  receipt) plus the out client's 250 ms playout buffer; before any line, the idle look-ahead plus
  0.73 s (1.69 s at 960 ms).
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
(6 frames), `idle-5s.mp4` and `idle.json`. Round 2 adds `--lead-s` / `--tail-s` (idle before the
first line and after the last), `--matte` (matting on; frames are recorded without alpha, `matteMs`
is timed), and to `live.json`: `startDelayMs` per line (line-start pts minus the stream ms at the
command), `lookaheadMs`, `seamBlend`, `idleLoop`, `matteMs`, and `seam` (`th/live/measure.py`
`bench_seams`: seam figures inside the lines and outside them). The bench uses the idle loop when
one exists; `TH_LIVE_IDLE=0` turns it off.

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

### Round 2: idle loop, seam blend, first word, matting (2026-11-16)

**Idle loop** (`th live make-idle`, `th/live/idle.py`). FlashHead moves the head and blinks only
around voiced sound; on anything else it holds still. Each candidate track below was rendered for 24 s
through the live model (with the seam blend). Figures are over the frames after a 2-chunk warm-up,
from MediaPipe landmarks at 512 px. Head = nose-tip p95-p5 range. Mouth = inner-lip gap. Blinks =
dips of eye openness below 0.6 of the median, cross-checked by eye-region grey changes.

| track | head x / y px | blinks (eye-grey events) | mouth gap max px (closed %) | longest closed span |
| --- | --- | --- | --- | --- |
| silence | 0.59-0.61 / 0.85-0.95 | 0 (0) | 0.51 (100 %) | whole clip, still |
| breaths (band-passed noise, -30 dBFS) | 0.70 / 0.85 | 0 (1) | 0.58 (100 %) | still |
| hums (synthetic closed-mouth murmur) | 0.63 / 0.78 | 0 (1) | 0.51 (100 %) | still |
| hummed speech (Kokoro lines low-passed at 300 Hz) | 0.61-0.97 / 0.68-1.42 | 0-1 | 0.63 (100 %) | still |
| Kokoro "Mm." / "Hmm." every 3 s | 1.72-1.99 / 3.12-4.30 | 3-6 | 15-20 (81-86 %) | under 6 s |
| Kokoro short phrases every 4.2 s | 1.83-2.05 / 4.46-5.32 | 2-3 | 29-30 (83-85 %) | under 6 s |
| Kokoro "Mm." every 7 s | 0.84-1.09 / 1.15-2.54 | 1-3 | 12-15 (94-97 %) | 6 s, still |

The ranges span repeated renders, because the sampler's noise differs per run. Breaths and hums
change nothing: the wav2vec input is normalised, so level does not help. A contiguous closed-mouth
span of 6 s or more is as still as silence in every track. The loop is therefore spliced: the
closed-mouth stretches of a lively track (each trimmed by 3 frames, at least 1 s) are joined with
6-frame crossfades, and every open-mouth frame is cut. The cycle is rotated so that its wrap is a
plain source step, never a cut. Each track gives two loops (the best contiguous span and the splice),
measured as played. `make-idle` keeps the best loop with the mouth closed in every frame and a wrap
step no larger than the median step, ranked by blinks, then head motion.

Chosen (`$TH_HOME/live/idle/iris/loop.json`): **Kokoro short phrases, spliced**. 294 frames
(11.8 s), mouth gap at most 0.52 px in every frame, head range 0.90 / 1.10 px, 1 blink. Wrap step
0.81 against a median step of 1.04 (0.78x). 4 cuts; the largest step at any cut is 1.31x the median
(the loop's p95 step is 1.22x). Sheet: `loop-sheet.png`; the loop played twice: `loop-2x.mp4`; each
candidate's clip with its audio and its sheet: `work/`. Iris is calmer than she is in speech. The
loop adds a blink and a slight head drift, not breathing; that is as far as FlashHead goes with a
closed mouth.

The engine plays the loop whenever no line is showing. The live weight ramps 1/6 per frame toward
live from 3 frames before a line's first sample, and back toward the loop 200 ms after its end (or
at the stop). On mic it is always live. When the loop comes back, it resumes at the loop frame
nearest the live pose (32 px grey thumbnails). `state.idle` is `loop` or `live` (what shows at the
last frame of the newest chunk). `--no-idle-loop` or `TH_LIVE_IDLE=0` turn it off. A loop rendered
at another size is ignored.

Idle, a line, idle (`th live-bench --script smoke-6s --lead-s 5 --tail-s 5`, real 25 fps): 25.0 fps,
0 late, 0 dropped of 16 chunks. The fade-in (from 3 frames before the first sample) steps at most
1.58, and the fade-out (from 200 ms after the end) at most 0.96. The clip's median step is 0.60 and
its p95 1.73, so neither fade steps out of the ordinary. `transition-sheet.png` in the run dir shows
both fades and the whole clip (made by a scratch script, not shipped).

**Seam blend** (`th/live/compose.py`). FlashHead returns 33 frames per chunk. Frames 0-8 decode the
latents re-encoded from the previous output's last 9 frames, so chunk k+1's motion frame j covers the
instant of chunk k's new frame 15+j. Measured on pitch-45s (13 chunks, mean abs diff on 128 px
grey): motion frame j against previous frame 15+j+s is 1.27 at s=0, against 2.29 / 2.24 at s=-1 / +1
and 3.8 at s=+-3, so the alignment holds. Across the boundary, previous frame 23 to the next new frame
0 steps 2.35, and motion frame 8 to new frame 0 steps 1.79 (in-chunk step 1.87). The last 3 new frames
of chunk k (instants 21-23) are held and mixed with chunk k+1's motion frames 6-8 at 0.25 / 0.5 / 0.75.
They are sent with chunk k+1, 120 ms later. A skipped chunk drops them. `TH_LIVE_SEAM=0` turns the
blend off.

Measured with live-bench (mean abs diff of consecutive frames, 128 px grey, 0-255). The seam step
is the step at a chunk boundary (frame 24k-1 to 24k); the non-seam step is the mean step more than 3
frames from a boundary; "window max" is the largest step within 3 frames of a boundary, which shows
that the blend spreads the jump and does not just move it. Speech is the frames inside pitch-45s's
lines. Idle is `--idle-s 20` with the loop off (`TH_LIVE_IDLE=0`), so these are the live model's own
seams. These runs shared the GPU with a training job (chunk p50 970-1130 ms, so chunks were late),
which does not change what the frames look like.

| clip | seam step | non-seam step | ratio | window max |
| --- | --- | --- | --- | --- |
| speech, blend off (2 runs) | 2.05 / 1.79 | 1.29 / 1.10 | 1.59 / 1.63 | 2.07 / 1.89 |
| speech, blend on (2 runs) | 1.30 / 1.36 | 1.13 / 1.18 | 1.15 / 1.15 | 1.51 / 1.53 |
| idle, blend off | 1.13 | 0.44 | 2.58 | 1.17 |
| idle, blend on | 0.58 | 0.48 | 1.21 | 0.69 |

SyncNet and identity did not move outside run-to-run noise under that load: conf 6.79 / 6.50 with
the blend off, 6.53 / 7.06 with it on (offset -1 throughout); identity 0.975 / 0.975 against 0.975 /
0.974. v1's 8.33 was measured on a GPU that was not shared.

**Faster first word.** The idle look-ahead is how long before its pts an idle chunk starts computing.
A line's audio goes into the next chunk the GPU starts, so a cold line is first heard about
`look-ahead + Kokoro's first sentence + a uniform 0-960 ms wait for the chunk boundary` after the
command. Lowering the look-ahead lowers that audible delay (`startDelayMs` in `live.json`, line-start
pts minus receipt) by 960 - look-ahead on average. `firstFrameMs` (command to first frame sent:
Kokoro, the wait for the GPU, one chunk of compute) does not depend on it. The limit is lateness.
With the seam blend, an idle chunk's first frame is 120 ms before its slice, so it is on time only
if look-ahead > 120 + chunk ms + JPEG and hand-off.

The look-ahead is therefore adaptive (`th/live/stages.py` `lookahead`): 120 ms (with the blend), plus
the slowest of the last 8 chunks, plus a 150 ms margin, kept between 750 and 960 ms.
`TH_LIVE_LOOKAHEAD_MS=<ms>` fixes it. It is 960 until 3 chunks have run. It settles at 840-900 ms
without matting and stays at 960 with matting on, rising within one chunk when a chunk gets slower.

Measured 2026-11-16 21:25-21:50 under the GPU lock, pitch-45s, upscale none. One co-tenant ran
throughout (pid 24256, 2.16 GB; the GPU was at 57-71 % before each run):

| run | look-ahead | chunk p50 / p95 / max ms | late / dropped | slack min ms | firstFrameMs (4 lines) | SyncNet | identity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before: blend and loop off | 960 | 559 / 578 / 606 | 0 / 0 | 377 | 958-1195 | 8.40 | 0.974 |
| blend + loop | 960 | 589 / 615 / 626 | 0 / 0 | 240 | 972-1283 | 8.50 | 0.974 |
| blend + loop | 850 | 577 / 602 / 635 | 0 / 0 | 128 | 953-1208 | 8.47 | 0.974 |
| blend + loop | 750 | 568 / 588 / 616 | 0 / 0 | 45 | 1006-1219 | 8.41 | 0.973 |
| blend + loop | auto (840-848) | 565 / 578 / 605 | 0 / 0 | 135 | 962-1184 | 8.37 | 0.973 |
| blend + loop, `--lead-s 6` | auto (861-899) | 566 / 591 / 629 | 0 / 0 | 148 | 969-1172 | 7.77 | 0.973 |
| before, `--lead-s 6` | 960 | 570 / 585 / 634 | 0 / 0 | 361 | 958-1213 | 7.75 | 0.974 |
| blend + loop + matte | 960 | 732 / 759 / 769 | 0 / 0 | 64 | 1127-2000 | 8.01 | 0.973 |
| blend + loop + matte | auto (960) | 710 / 724 / 741 | 0 / 0 | 95 | 1106-1994 | 8.15 | 0.972 |

- **Lateness.** A fixed 750 holds only without matting and with this light co-tenant: its 45 ms
  slack is gone at v1's WoW chunk times (679-721 ms). With matting, nothing below 960 holds
  (64 ms slack at 960).
- **Audible delay.** The bench's first line is its only cold line, and one sample is dominated by the
  0-960 ms boundary phase. Line 1 measured: before 1767 and 1559 (lead 6), 750 gave 1572, 850 gave
  1672, auto gave 1737 and 1652 (lead 6). Lines 2-4 arrive while the previous line's chunks are still
  1.9 s ahead, so they measure the speech lead (1612-1694 in every run), not the look-ahead. So the
  expected gain is 960 - look-ahead, about 100 ms with auto and none with matting. These runs neither
  confirm nor refute it.
- **firstFrameMs** is unchanged, as expected (958-1213 before, 953-1283 after).
- **Matte cost.** BiRefNet-lite-matting is 146 ms p50 / 152 p95 per chunk (+1.4 GB VRAM peak, 8.1 GB
  in all). Its first chunk took 1.0 s (cuDNN tuning a new batch shape: the stream's first chunk is 21
  frames under the blend), which made 4 chunks late. The engine now also warms that shape when the
  server starts with `--matte`. Rerun: first chunk 715 ms, 0 late.
- **Warm paths.** Kokoro's worker loads with one warm-up sentence while FlashHead loads, FlashHead
  runs one warm-up chunk, the upscaler and the matte warm up off the GPU thread, and the stream never
  stops, so nothing else is cold.

To check a fixed value: `TH_LIVE_SEAM=0 TH_LIVE_IDLE=0 TH_LIVE_LOOKAHEAD_MS=960 uv run th live-bench
--script pitch-45s` (before), then `TH_LIVE_LOOKAHEAD_MS=<ms> uv run th live-bench --script pitch-45s
[--matte]` (after), under the usual co-tenant. A look-ahead is acceptable only if `lateChunks` is 0.

**Matting hook.** `th live --matte` (or the command `{"type":"matte","on":true|false}`) loads
`th.live.matte.get_matte(kind)` for `TH_LIVE_MATTE` (default `birefnet-lite-matting`) off the GPU thread. From
the next chunk it takes the alpha of the composed 512 frames, upscales it with the frames' factor
(bilinear), and sends `0x04` (colour JPEG plus greyscale alpha JPEG, quality 90) instead of `0x01`.
`state.matte` says whether it is on. A kind that is missing or fails to load sends one `error` event
and matting stays off; a matte that fails on a chunk switches matting off with one `error`.
`matteMs` per chunk is in `bench.json`.

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
  - **Motion** (round 3): a segmented switch (Off / Natural / Lively) that sends `motion` and shows the requested level until `state.motion` confirms it. The state line ends with `motion <level>`; a server older than round 3 sends no `motion`, so the line leaves it out and no level is checked.
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

### Matting (`th live --matte`, `th/live/matte/`)

`get_matte(kind)` returns a Matte. Its input is uint8 CUDA frames (N,512,512,3) and its output is a uint8 CUDA alpha (N,512,512), where 255 means opaque. It runs on the 512 frame before upscaling. Every kind shares one pipeline (`base.py`):

1. The network runs at the kind's own resolution, area-downsampled.
2. A **colour-guided filter** brings the alpha back to 512 (`refine.guided_upsample`, He and Sun's fast guided filter on the RGB frame). The edge follows the hair strands in the colour frame instead of the blur of a low-res mask.
3. **Temporal smoothing** gated by the colour frame (`refine.TemporalSmoother`):
   - Where the picture stands still, the alpha takes only 35% of each new value (an EMA), which removes edge flicker.
   - Where a pixel's colour changed by 6/255 or more (the head moved), it takes the new alpha at once, so moving edges do not lag.
   - The state carries across chunks. `reset()` clears it at a cut.
4. The BiRefNet kinds run the network on **every 2nd frame** (stride 2, plus the chunk's last frame) and interpolate linearly in time between those frames. The guided filter then snaps each frame's edge to that frame's own colour.

| kind | model (licence) | net res | notes |
|---|---|---|---|
| `birefnet-lite-matting` **(default)** | ZhengPeng7/BiRefNet_lite-matting, Swin-T 44 M (MIT) | 384, stride 2 | trained for soft alpha on people; best edge, lowest flicker |
| `birefnet-lite-matting-fast` | same weights | 320, stride 2 | 17-27% less GPU time; slightly softer edge (budget fallback) |
| `birefnet-lite` | ZhengPeng7/BiRefNet_lite, Swin-T (MIT) | 384, stride 2 | general segmentation weights; harder, notched hair edge |
| `mediapipe` | MediaPipe Selfie Segmentation 256 (Apache-2.0) | 256, CPU | costs no GPU time, but leaves grey halos at shoulders and jaw and 2-3x the flicker |
| `birefnet` | ZhengPeng7/BiRefNet, Swin-L 220 M (MIT) | 384, stride 2 | the offline matte's weights; over budget, kept for the A/B only |

**Weights.**
- `birefnet-lite-matting` and `birefnet-lite` are pinned snapshots under `$TH_HOME/models/live-matte/<kind>/`. They are 89 MB and 178 MB, fetched on first use by `weights.fetch_birefnet`.
- `birefnet` reuses the offline download in `$TH_HOME/models/birefnet/`.
- `mediapipe` uses the `.tflite` inside the mediapipe 0.10.9 wheel (the legacy `solutions.selfie_segmentation`, which only the FlashHead env still has).
- `licence.json` in `live-matte/` has one row per kind.

The cards were read on 2026-11-16:
- The BiRefNet cards say `license: mit`, and the code repo is MIT. The training sets carry their own research terms: DIS5K for the general weights; P3M-10k, AM-2k, AIM-500 and others for the matting weights. The offline matte in `th/post/alpha.py` already accepts the same caveat.
- The Selfie Segmentation model card says "LICENSED UNDER Apache License, Version 2.0".

**FlashHead env.** BiRefNet's remote code imports `timm` and `kornia`. Kornia is only used by the training-time Laplacian. Both have to be in `th/live/requirements.txt`.

**Measured.**
- Clips: live-bench output at 512 with no upscaling, the first 480 frames of `20261116T183338Z-live-fh-pitch-45s` and `20261116T184247Z-live-fh-idle-20s`.
- Command: `python -m th.live.matte.bench` in the FlashHead env, under the GPU lock.
- Flicker is the mean |alpha_t - alpha_t-1| on the 0-255 scale, in the alpha's edge band. "Static" counts only band pixels whose colour did not change (max channel step 2/255 or less), so it measures flicker alone.
- The reference row is the offline matte's grade: BiRefNet at 1024, no smoothing.
- "Ref diff" is the mean |alpha - ref| over the reference's band. The reference is a hard-edged segmenter, so this column favours hard edges. It is a sanity check, not a quality score.

| config | static flicker pitch / idle | flicker pitch / idle | ref diff | VRAM peak |
|---|---|---|---|---|
| reference: BiRefNet 1024, unsmoothed | 2.45 / 1.79 | 3.69 / 2.07 | 0 | 3.7 GB (batch 2) |
| mediapipe | 2.36 / 1.52 | 2.79 / 1.67 | 47.2 | 0.4 GB (CPU net) |
| birefnet-lite 384 s2 | 0.93 / 0.60 | 1.53 / 0.68 | 42.4 | 1.6 GB |
| **birefnet-lite-matting 384 s2** | **0.70 / 0.45** | **1.23 / 0.56** | 33.8 | 1.6 GB |
| birefnet-lite-matting 320 s2 (fast) | 0.67 / 0.43 | 1.18 / 0.54 | 37.0 | 1.2 GB |
| birefnet-lite-matting 384 s2, no smoothing | 1.12 / 0.84 | 1.95 / 1.10 | 33.8 | 1.6 GB |
| birefnet-lite-matting 384 s1 (every frame) | 0.75 / 0.49 | 1.29 / 0.61 | 33.8 | 2.7 GB |
| birefnet (Swin-L) 384 s2 | 0.74 / 0.48 | 1.37 / 0.60 | 34.4 | 3.3 GB |

**Smoothing.** Smoothing cuts static flicker by about 40% (1.12 to 0.70 on the pitch clip). The live matte flickers about 3x less than the offline matte.

**Stride 2.** Measured against the every-frame matte on the pitch clip:
- The interpolated frames differ by 0.53/255 on average in the edge band (p99 4/255, worst frame 1.5/255). On the fastest 5% of motion frames the difference is 0.60/255.
- The step into key frames is 1.31/255 against 1.15/255 into interpolated frames. Stride 1 shows 1.34 and 1.26 on the same measure. The alternation stride 2 adds is about 0.1/255, below one grey level, so the smoothing hides it.
- Stride 2 also lowers flicker slightly, from 1.29 to 1.23.

**Edge sheets.** `sheet-<clip>-f<frame>.png` from the bench shows 3 frames per clip, each over a checkerboard and over a bright slide, with x2.7 zooms on the hair edge and the headset edge.
- BiRefNet-lite-matting follows the silver strands with a soft edge.
- The DIS weights (`birefnet-lite` and the offline reference) cut notches into the hair.
- MediaPipe smears grey halos onto the slide around the shoulders and jaw.
- Remaining limitation: there is no foreground colour estimation. Over a white slide, semi-transparent hair keeps a faint tint of the dark studio background.

**Time.**
- All timings so far are contended. The 4090 was shared with World of Warcraft (3.6-3.9 GB), up to two Iris-sharpener trainers (2.2-4.1 GB each, running outside the GPU lock until 00:30) and at times the engine's make-idle FlashHead render (6.1 GB).
- Clean end-to-end figures with matte on come from the engine's live-bench after the trainers stop.

ms per 24-frame chunk, p50 / p95, synced:

| config | WoW + 1 trainer (run1) | interleaved, WoW + 2 trainers + make-idle at start | sequential, heavy (final) |
|---|---|---|---|
| mediapipe (CPU) | 151 / 159 | 117 / 135 | 152 / 182 |
| birefnet-lite-matting 384 s1 | 131 / 133 | 247 / 264 | n/a |
| **birefnet-lite-matting 384 s2** | **107 / 116** | **126 / 146** | 287 / 301 |
| birefnet-lite-matting 320 s2 | n/a | 92 / 100 | 238 / 261 |
| birefnet (Swin-L) 384 s1 | 273 / 356 | n/a | 532 / 582 (s2) |

- The network alone (BiRefNet-lite at 384, batch 24, fp16, WoW only) took 112 ms per chunk. At 512 it took 182 ms.
- The guided filter adds about 13 ms and the smoother about 6 ms per chunk.
- The default fits the ~250 ms headroom at about 110-130 ms with one co-tenant. Under the heavy multi-trainer load nothing BiRefNet-based fits. If live-bench shows late chunks, switch to `birefnet-lite-matting-fast` first.

<!-- Round 2, web: additions to docs/talking-head.md "The web pages: `/live` and `/live?out=1`". Each block names where it goes. -->

<!-- Control page list: replace the state-line bullet with this one. -->
  - Connection lamp and the server's `state` line: ready, fps, upscale, delay, queue, size, source, matte (`on`/`off`) and idle (`loop`/`live`; left out when an older server sends no `idle`).

<!-- Control page list: replace the Upscaler bullet, and add Matte after it. -->
  - **Upscaler**: a segmented switch (None / Real-ESRGAN / Maxine / Iris). It shows the requested kind until the server's `state` confirms it. A server `error` event that no line claims shows inline under the toolbar.
  - **Matte**: Off / On sends `{"type":"matte","on":…}`. Like the upscaler, it shows the request until `state.matte` confirms it.

<!-- Control page list: replace the Stop bullet. -->
  - **Stop** sends `stop`, ends a running slide deck where it is, and clears the slide this page put up. It also flushes the page's own preview at once, without waiting for the server's marker.

<!-- OBS list: add after the Playout block. -->
  - **Matted frames (`0x04`)**: the colour JPEG and the greyscale alpha JPEG are decoded in parallel (`createImageBitmap`). A small WebGL shader (`src/live/composite.ts`) turns the alpha's luminance into the canvas alpha, so the page stays transparent wherever the matte says background. Without WebGL, a CPU pass over the pixels does the same job.
    - Both paths snap the JPEG noise floor: alpha 2 or less is fully clear, 253 or more is fully opaque, and values in between are stretched linearly. Compression ringing never leaves a faint veil over the background, and hair edges keep their soft values.
    - A `0x04` frame with an empty alpha draws opaque.
    - Measured on the e2e fake (1024 px matted frames at 25 fps, 4 s window): 25 fps drawn, 0 dropped. With the GPU (`--use-angle=d3d11`, a training run on the same 4090 at 100 % util), draw p50 2.0 ms / p95 3.9 ms and decode p95 4.0 ms. On SwiftShader (the suite's default headless GL, software), draw p50 10 ms / p95 12.6 ms and decode p95 12.4 ms. Draw time is main-thread time per frame, compositing included; decoding runs off the main thread.
  - **Stop flush**: a `line-end` whose text is `"stopped"` (the server's stop marker) makes every out client drop every audio chunk it has scheduled (playing or not yet started) and every frame it has queued or is still decoding. The clock is kept, so the frames that follow play on the same timeline. The control page's preview also flushes on the page's own Stop.
    - A flush can hold the last drawn frame until the next frame's pts comes up: at most the queued span, which is the 250 ms delay plus whatever part of a 0.96 s chunk arrived ahead.

<!-- OBS list: replace the data-attribute bullet. -->
  - The page writes its figures to data attributes on `[data-live-out]`:
    - `data-drawn`, `data-dropped`, `data-chunks` and `data-size`;
    - `data-flushes` and `data-audio-ahead` (ms of audio scheduled past the audio clock now);
    - `data-draw-p50`, `data-draw-p95` and `data-decode-p95` (ms, over the last 120 frames);
    - `data-composite` (`webgl` or `cpu`, once a matted frame has been drawn).

<!-- Replace the "Without the GPU" bullet. -->
- **Without the GPU**: run `node apps/web/e2e/fakeLive.ts [port]` for a fake `fhl/1` server, then open `/live?server=ws://127.0.0.1:8790/live`. The fake does the following:
  - It streams synthetic 25 fps JPEG frames.
  - With `matte` on, it streams `0x04` frames at 1024 px instead: a colour frame plus a circular alpha with a soft edge.
  - Each `say` plays a 1 s 440 Hz tone with its `line-start`, `timing` and `line-end` messages. `state.idle` is `live` while a line plays and `loop` otherwise.
  - `stop` cuts the playing line with a `line-end` `"stopped"`.

<!-- Replace the Tests bullet. -->
- **Tests**:
  - Unit tests live in `src/live/*.test.ts`. They cover the codec (`0x04` included), client, clock, slides, PCM, history, the alpha rule (`composite.test.ts`) and the player's matted draw and flush (`player.test.ts`).
  - The e2e test is `apps/web/e2e/live.e2e.spec.ts`, with five cases. One checks matte on: pixels outside the alpha circle have alpha 0 and pixels inside have alpha above 0, and it also checks keep-up and draw time. Another checks Stop: the scheduled tone is dropped and nothing is scheduled past the flush.
  - Run the e2e test after building, with `SR_E2E_PORT=5320 pnpm --filter ./apps/web exec playwright test -c playwright.e2e.config.ts live.e2e.spec.ts`.
- **Two 404s under `vite preview`**: a browser shows two 404s on `/live` and `/live?out=1`, and on every other page too. Neither comes from the live code.
  - `GET /api/health` is the shell's plane read. `vite preview` has no API functions, so the page falls back to replay by design (see `app/plane.ts`). Under the deployment it answers.
  - `GET /favicon.ico` is the browser's default icon request. The app declares no icon, and `vite preview` has none to serve.

#### `iris`: a sharpener trained on Iris (round 2)

`--upscale iris` is the project's own 2x model. It is trained from scratch on Iris's art only: no
pretrained weights and no third-party data, so its only provenance is the project's own images.
Code lives in `th/live/upscale/`: `iris.py` (net and upscaler), `iris_data.py` (pairs), `train_iris.py`, `iris_gan.py` (an optional texture critic) and `iris_eval.py`.

```
# FlashHead env, tools/talking-head on PYTHONPATH (the data step needs FlashHead's own VAE)
python -m th.live.upscale.train_iris data [--clips 12]      # -> $TH_HOME/live/iris-train/ (1.9 GB)
python -m th.live.upscale.train_iris train [--until HH:MM] [--resume]
# core env; takes the GPU lock
uv run python -m th.live.upscale.iris_eval holdout --out <dir> [--arms bicubic,iris]
uv run python -m th.live.upscale.iris_eval live --video <live-bench raw.mp4> --out <dir> [--audio <wav>] [--clip-start S]
```

- **Data.**
  - The sources are `portrait.png` and the edits in `assets/characters/companions/iris/edits/`. `head` and `matte` are left out: they are green-screen cut-outs, not faces on her ground.
  - `joy`, `teeth` and `gazeL` are held out for validation, so 21 images train.
  - Each source gives 12 clips of 9 frames. Clip 0 is the exact live bust box, (192,140)-(832,780) resized to 1024. The other clips drift smoothly: up to +-24 px of shift and +-6 % of scale, with a horizontal flip on half of them.
- **Degradation, matched to FlashHead.** The input is the 1024 target, area-downsampled to 512 and Gaussian-blurred, then encoded and decoded as one 9-frame clip by FlashHead Lite's own `VAE_LTX`, loaded as its pipeline does (bf16, 1.1 GB).
  - The VAE alone leaves the face too clean. Laplacian variance on the grey face box, live-bench `none` frames against the VAE round trip:

    | frames | Laplacian variance |
    | --- | --- |
    | VAE round trip alone | about 145 |
    | live-bench speech (p10-p90) | 57-83 (mean 70) |
    | live-bench idle | 84 |
    | VAE round trip after a sigma-0.5 pre-blur | about 78 |

  - So the blur sigma is drawn from 0.40-0.62 (0.5 for the still clip).
  - The dataset's inputs measure 43-92 (p10-p90, mean 65), which brackets real output.
  - Training adds a light blur (p 0.3), noise (p 0.5, up to 1.5/255) and a +-3 % gain on top.
- **Net.** It has SRVGGNetCompact's shape (32 features, 16 conv + PReLU layers, pixel shuffle) on a bilinear base, 0.6 MB.
  - It uses He init with a zero last layer, so the untrained net is a plain bilinear 2x. PyTorch's default init shrinks the signal about 3x per layer: with it, this 17-conv plain stack could not overfit even one batch.
  - It runs in fp16, channels-last, 4 frames per call. That is as fast as 12 per call, with a 0.75 GB peak instead of 1.9 GB.
- **Loss.**
  - L1.
  - 0.05 x L1 of the 2D FFT magnitude.
  - 0.2 x L1 between the outputs for two noise draws of the same patch, so detail cannot follow input noise from frame to frame.
  - No perceptual network. torchvision's VGG weights are ImageNet-trained, which would bring in outside data.
- **Training.**
  - Adam 1e-3 with a cosine to 2e-5, bf16 autocast and EMA 0.999.
  - 128 px input patches, 60 % of them on the face. Batch 16, as two noise draws each.
  - 1.4 GB of VRAM; the pairs stay on the host.
  - Training never touches the GPU lock.
  - The best EMA by held-out face PSNR goes to `$TH_HOME/models/live-upscale/iris-x2.pth`, with a `licence.json` row: "own model, trained on the project's Iris art; see docs/provenance.md".
  - The shipped weights: 205k steps in 2 h 15 min of GPU time, best at about 185k. Held-out validation PSNR went from 35.12 at 2.5k steps to 35.46 at 22k and 35.53 at the end (bicubic 34.88), so it plateaued after about 70k steps.

**Measured** (RTX 4090, World of Warcraft on the GPU at 2.6 GB and 43 % busy, GPU lock held):

| | none (bicubic) | iris |
| --- | --- | --- |
| held-out edits, face PSNR / SSIM vs the true 1024 | 36.17 / 0.928 | **38.32 / 0.955** |
| held-out per edit, PSNR (joy / teeth / gazeL) | 36.04 / 36.67 / 35.82 | 37.86 / 39.09 / 38.00 |
| live-bench pitch-45s: sharpness / identity mean / flicker | 7.88 / 0.974 / 1.83 | 12.64 / 0.969 / 1.75 (0.96x) |
| live-bench idle-20s: sharpness / identity mean / flicker | 9.22 / 0.986 / 0.53 | 14.20 / 0.984 / 0.45 (0.85x) |
| ms per 24-frame chunk (iris alone) | 3-6 | 62.5 p50, 64.8 p95 |

- **Verdict.** `iris` is the most faithful 2x on Iris by the numbers:
  - +2.1 dB on edits it never saw;
  - less flicker than the 512 frame scaled by the browser;
  - identity within 0.005;
  - it fits the 25 fps budget alongside FlashHead (about 63 ms of the 960 ms chunk).
- **What it does not do: skin texture.** By eye it sharpens edges (eyeliner, iris ring, lash line, nostrils) and flattens skin micro-texture: freckles and pores read smoother than bicubic.
  - The VAE input no longer carries the true pores, so an L1-trained net paints their median.
  - A GAN fine-tune (`--gan 0.1 --fft 0.5 --init <L1 weights> --lr 1e-4`) brought some grain back (sharpness 14.2 -> 19.2 on the held-out edits). It cost 1.6 dB and drew swirl artefacts on the cheek, and it was stopped after 15 min, so it is not shipped.
- **Against `maxine`.** The comparison is in the internal note (`var/talking-head/live-upscale-ab/iris/INTERNAL-iris-vs-maxine.md`, SLA 8.9). In short, `iris` wins by the numbers and `maxine` keeps more freckle grain by eye. `maxine` stays the default.

### Round 3: head motion and gaze glances (2026-11-17)

The owner's verdict on round 2: the picture is good, but the head is static and the gaze is fixed.
Round 3 adds both on top of FlashHead, at a level the control page switches live: `off`, `natural`
(the default) or `lively`. Protocol: the command `{"type":"motion","level":"off"|"natural"|"lively"}`
and `state.motion` (key always present; the web client reads a missing key as unknown and leaves it
out of the state line). `th live --motion <level>`, `th live-bench --motion <level>`.

**FlashHead's own head motion, measured first.** On a round 2 pitch-45s run (20261116T203517Z, 512 px,
the 1065 speech frames), the rigid shift of the head (phase correlation of the head region against
the clip's median) is 0.70 / 0.31 px (x / y, p95 - p5) and the roll range (MediaPipe eye-corner line)
0.77 degrees; the nose tip moves 4.5 / 8.7 px, mostly with the jaw. In idle: 0.16 / 0.13 px, 0.45
degrees. So the added motion below is sized against a head that, as a rigid body, barely moves.

**Head motion** (`th/live/motion.py`; round 4 re-tuned it and applies it to the head only, see
"Round 4"). A per-frame 2D similarity transform (dx, dy, roll, scale),
deterministic for the seed and the audio fed (however it is split into chunks):
- **sway**: three sines per axis at 0.1-0.3 Hz with seeded phases (dx 2.6 px, dy 1.6 px, roll
  0.7 degrees at 512 px, before the sum's peaks);
- **nods**: an energy onset in the chunk's speech audio (a frame's level 9 dB over the last 0.2 s,
  while voiced) starts a 0.46 s down-and-back bump: dy up to 3.4 px and a 0.4 % scale-down. At
  most one per 0.8 s;
- **tilts**: at each sentence's first sample (the engine knows it from the per-sentence TTS
  segments) and at clause pauses (voice back after 0.16 s or more of quiet, at least 1.5 s after
  the last tilt), a smoothstep over 0.7 s to a new roll of 0.6-1.5 degrees (60 % for a clause),
  usually leaning the other way, with a 1.4 px/degree sideways lean;
- **idle**: when the audio is quiet (attack 0.25 s, release 1.2 s) the sway shrinks to 45 % and
  slows to 0.6x, a small tilt comes every 5-9 s, and there are no nods;
- **levels**: `lively` multiplies all of it by 1.6, and `off` is the identity; a level change eases
  over 0.5 s.

The transform runs on the GPU after the seam blend, the idle loop and the matte, and before the
upscaler: one bilinear `affine_grid` / `grid_sample` over the 512 frames, and over the alpha with
the same grid when matting is on. Rotation and scale pivot on the neck (50 %, 72 % of the frame).
Without a matte the frame is zoomed 4 % (eased in and out with the level). Each frame's transform
is then shrunk toward the pure zoom just enough that the four output corners sample at least half a
pixel inside the source, so no border can show (the test checks every grid coordinate and a constant
frame through zero padding). With a matte nothing is zoomed: edge pixels are clamped, so the cut
of the shoulders at the bottom never opens. Applied per frame: `bench.json` `motion.params`; per
chunk: `motionMs`.

Measured 2026-11-17 00:43-00:51 with `th live-bench --script pitch-45s --motion <level>` (upscale
none, seed 1116, no game on the GPU; during the first run a test process held 1.3 GB and ran a
short GPU test, hence its p95). Head figures over the speech frames, p95 - p5:

| figure | `off` (FlashHead alone) | `natural`, measured on the output | `natural`, as applied |
| --- | --- | --- | --- |
| roll, degrees | 0.78 | 2.82 | 2.48 |
| shift x / y, px | 0.69 / 0.30 (phase correlation) | 10.9 / 0.43 (phase correlation) | dx 6.58 / dy 4.37 |
| nose tip x / y, px | 4.2 / 8.5 | 11.6 / 9.5 | |
| scale | | | 0.32 % |
| nods | | | 45 in 42.6 s of speech (the 0.8 s refractory period is the limit) |

Phase correlation reads a rotation about the neck as a sideways shift and misses most of the
vertical motion, so the applied column is the reference. `lively` is 1.6x `natural` on every axis
(test). Over the idle frames `natural` applies dx 3.4 / dy 1.7 px and 1.8 degrees.

| run | chunk ms p50 / p95 / max | late / dropped | slack min ms | SyncNet (offset) | identity mean / p5 | warp ms per chunk p50 / p95 | firstFrameMs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `off` | 406 / 452 / 488 | 0 / 0 | 185 | 8.33 (-1) | 0.974 / 0.960 | | 854-1061 |
| `natural` | 427 / 697 / 839 | 0 / 0 | 140 | 8.47 (-1) | 0.972 / 0.961 | 7.4 / 24.9 | 819-1415 |
| `natural`, matte on | 498 / 535 / 594 | 0 / 0 | 147 | 8.39 (-1) | 0.971 / 0.957 | 4.1 / 4.5 | 962-1371 |

- SyncNet and identity stay within round 2's run-to-run spread (8.0-8.5 and 0.972-0.975).
- The warp costs 4-8 ms per chunk on the GPU. Without a matte most of it is the border fit, which is
  per-frame numpy on the CPU. With matting, BiRefNet-lite took 83 / 94 ms (p50 / p95).
- The seam blend still works under motion: the seam step against the non-seam step is 1.14 with
  `natural` and 1.13 with `off`. Frames step more overall (non-seam step 2.51 against 1.26),
  because the head now moves.
- The fake model (`th live --fake`, tests) warps in numpy, not torch. torch's CPU thread pool next to
  the server's threads made a server test miss its timing after a GPU test in the same process. At
  256 px it takes 270 ms per chunk.

**Gaze glances** (`th/live/gaze.py`). Iris's Codex gaze edits (`edits/gaze{L,R,U,D}.webp`) are
bust-cropped with the main box into `$TH_HOME/live/refs/iris/` and encoded as extra FlashHead
references at load (`FlashHeadModel.add_reference`, exactly as upstream's `prepare_params`). A
reference applies to a whole 0.96 s chunk, so a glance lasts one chunk.

Upstream's `reset_person_name` also resets the motion latents to the still reference. Our switch
(`set_reference`) swaps only the reference latent and the colour reference and keeps the motion
latents, so the next chunk continues from the last frames. Measured before wiring the policy
(probe: 41 chunks, pitch-45s speech then silence, seam blend on, mean abs step on 128 px grey;
gaze = iris centre within the eye box, -0.5..0.5, from MediaPipe; the gaze references themselves
read -0.32 (L) and +0.30 (R)):

| switch (latents kept unless noted) | step at the switch against the median step | gaze (iris offset) | identity (DINOv2 vs the bust) |
| --- | --- | --- | --- |
| idle, to L / R | 1.56-1.84 against 0.77 (2.0-2.4x); with a 6-frame dissolve from the held frame 1.08-1.20 (1.4-1.55x) | moves to -0.28 / +0.29 within about 6 frames and holds | 0.977-0.983 (0.982-0.988 without a glance) |
| idle, back to the main reference | 1.07-1.48; the largest step sits in the seam blend's frames, so a dissolve does not lower it | back within about 6 frames of the next chunk | |
| idle, a second probe | | gazeR arrived late in its chunk and held through the next one (about 1.2 s); gazeU showed nothing; gazeD drooped the lids for 2 chunks | gazeD 0.92-0.95 |
| speech, to L / R / U | 0.92-1.73x the median (1.50) | weak: 1 of 5 glances showed within its chunk (gazeR, ramping to +0.21 by the chunk's end); a 2-chunk gazeL showed only in its second chunk | 0.955-0.974 (0.94-0.98 without) |
| speech, back from U | 4.35 (2.9x) | gazeU read as a half blink | |
| speech, upstream reset (`reset_person_name`) | to L 1.93 (1.3x); back 3.96 (2.6x), 6.58 (4.4x) in the seam frames, which a dissolve does not hide | immediate and strong (-0.30) | 0.963 |

Built from that (the Director approved it):
- the switch keeps the motion latents, always;
- glances go left or right only, because up and down did not read as glances;
- in idle, one glance every 6-10 s (4-7 s at `lively`). It is planned one chunk ahead, and the live
  model is shown over the idle loop from 6 frames before the switch until 6 frames after the chunk
  that follows. That covers the return, then the loop fades back in. The first 6 frames of the
  glance dissolve from the held frame.
- in speech, a chunk that holds a sentence start glances with probability 0.3 (0.5 at `lively`),
  at least 3 s (2 s) after the last glance, with no dissolve: it froze the lips and did not lower
  the step.
- speech glances have their own switch, `TH_LIVE_SPEECH_GLANCES=0` or `th live
  --no-speech-glances`, in case the owner reads them as random eye darts. Idle glances stay.

The server logs each glance (`th live: glance gazeL at <pts> ms (speech|idle)`), and
`bench.json` `motion.glances` lists `[chunk, reference]`.

In the review clips, measured as an iris offset change above 0.08 within 1.6 s of the switch, speech
glances showed in 3 of 9 and idle glances in 4 of 5. A speech glance often falls on a line's first
chunk, because a sentence starts there.

**Review clips** (`var/talking-head/live-review-r3/`, recorded through the server on port 8766 with
Maxine, the way `/live?out=1` receives the stream):
- `line-off`, `line-natural` and `line-lively` (the same typed line);
- `matte-natural` (matte on, composited on a light background);
- `idle-natural` (20 s);
- `passage-natural`, `passage2-natural` and `passage-lively` (a 5-sentence passage, for speech glances).

`contact-sheet.jpg` shows 8 frames per clip, `glance-strips.jpg` shows each glance from -0.2 to
+1.8 s, and `glances.json` gives each glance's time, frame, reference and measured gaze.

### Round 4: head-only motion (2026-11-17)

The owner's verdict on round 3: every speech clip with motion read as camera shake, because the
whole frame moved, shoulders and backdrop included. `off` and the idle clip passed. Round 4 moves the
head only. Protocol, web and level names are unchanged (`off` | `natural` | `lively`).

**The head layer** (`th/live/headlayer.py`). Each 512 frame is warped by a per-pixel field instead of
one transform: output pixel u samples the input at u + w(u) * D(u), where D is the displacement of
the full head transform (motion.py's dx, dy, roll and scale) and w is a weight map:
- **segmentation**: MediaPipe's multiclass selfie segmenter (`selfie_multiclass_256x256.tflite`,
  16 MB, model card "LICENSED UNDER Apache License, Version 2.0"; one .tflite, no auxiliary model)
  run by the FlashHead env's mediapipe 0.10.9 `ImageSegmenter`. Classes: background, hair,
  body-skin, face-skin, clothes, others. On Iris it separates hair, face, neck and jacket cleanly;
  one ear cup comes out as "others", and the mic boom as backdrop. It is fetched once into
  `$TH_HOME/models/selfie-multiclass/` (sha-pinned, with a licence.json) the first time the server
  builds the map.
- **w = 1** on the head (hair, face-skin, others) and on the backdrop within 10 px of it, so thin
  strands and the mic boom move with the head; beyond that the backdrop fades to 0 over 40 px.
- **the neck bends, it does not tear**: w = 1 down to 24 px below the closed-mouth chin (FlashHead's
  jaw drops the chin by up to 21 px: 378 to 399 over a pitch-45s run), then a smoothstep to 0 over
  44 px. Next to the collar, the neck and the backdrop ramp up from 0 over 10 px, so the collar's
  edge does not fold.
- **w = 0 exactly** on the clothes and wherever the smoothed weight is under 0.001; those pixels are
  copied from the input, bit for bit (the tests check it on a moving head).
- **pivot**: below the chin at the neck centre, 28 px under the chin found by the segmentation (Iris:
  (256, 405) at 512). The segmentation gives the chin directly, so no landmark model is loaded.
- Nothing is uncovered (the field is continuous), so no clean plate is needed. A rigid layer with a
  plate (the head and halo moved as one piece, a 16 px feathered neck band, the uncovered pixels from
  the frame inpainted under the head) was compared offline on the same frames and params: at the
  crown it showed a dark seam where the head left the frame's top edge, and nothing it did better.
  The soft field shipped.
- **cost**: the segmenter takes ~100 ms per frame on the CPU, whatever the input size, so it never
  runs on the GPU thread. The map is built from the bust at start (about 1 s, on its own thread;
  nothing moves until it is ready) and refreshed from one live frame per chunk on a worker thread
  (skipped while one is running), blended into the running class map (70 % old / 30 % new), so it
  follows the gaze references and the idle loop. On the GPU thread the warp is one `grid_sample`
  over the box around the moving pixels (74 % of the frame moves): 4-6 ms per chunk p50 (table
  below).

**Motion sources, re-tuned** (`th/live/motion.py`):
- **sway**: the idle values the owner approved (45 % amplitude, 0.6x speed), and in speech 60 % and
  0.75x (round 3: 100 % and 1x);
- **nods**: after a nod the next waits a random 2-3 s (was 0.8 s), so they never tick at a fixed
  rate; 2.4 px (was 3.4) with a 0.3 % scale-down, 0.52 s long;
- **tilts at sentence ends**: a sentence start after voice marks where the sentence before it
  ended, and the tilt eases in from that sentence's last voiced frame (bounded to the chunk holding
  the mark, so it does not depend on how the feed is split). A line's last sentence, and the mic,
  have no next mark: a pause of 0.44 s after at least 1.5 s of voice counts as a sentence end
  (Kokoro's sentence pauses are 0.5-0.6 s, its comma pauses 0.3-0.36 s). No more tilts at sentence
  starts or clause pauses. Lean 1.0 px per degree (was 1.4);
- idle unchanged; `lively` is 1.6x `natural` on every axis.
- The no-border zoom and its border fit are gone: the frame's edges never move.

**Measured offline first** (CPU, on the round 3 `off` run 20261116T234649Z: FlashHead's own frames,
with the round 4 motion computed from its speech, sentence starts taken as voice after 0.48 s of
quiet; 1176 frames):

| figure | `natural` | `lively` |
| --- | --- | --- |
| applied dx / dy, px (p95 - p5) | 5.6 / 2.3 | 8.9 / 3.6 |
| applied roll, degrees | 3.15 | 5.05 |
| crown displacement, px (p95 / max) | 12.6 / 14.4 | 20.1 / 23.1 |
| chin displacement, px (p95 / max) | 3.7 / 5.0 | 6.0 / 8.0 |
| nods / tilts | 17 / 14 in 47 s | 17 / 14 |
| shoulders (clothes) vs `off`, mean abs | 0.000 | 0.000 |
| far backdrop (over 50 px from the head) vs `off` | 0.000 | 0.000 |
| backdrop that moves at all | 58 % of the backdrop pixels (the halo around the head) | |

**Measured live** 2026-11-17 09:43-09:54 with `th live-bench --script pitch-45s` (upscale none, seed
1116, 512 px). Stillness is the mean abs frame-to-frame change (grey, 0-255) inside a mask from the
bust's segmentation, eroded 3 px: the shoulders (clothes) and the far backdrop (over 60 px from the
head), over the 1065 speech frames. Round 3's runs are the reference.

| run | shoulders | far backdrop | near backdrop | roll on the output, deg (p95 - p5) | nose x / y, px | nods (applied) | chunk ms p50 / p95 / max | late / dropped | slack min ms | SyncNet (offset) | identity mean / p5 | warp ms p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| round 3 `off` (234649Z) | 0.318 | 0.171 | 0.195 | 0.78 | 4.2 / 8.5 | | 406 / 452 / 488 | 0 / 0 | 185 | 8.33 (-1) | 0.974 / 0.960 | |
| round 3 `natural`, whole frame (234343Z) | **1.623** | 0.378 | 1.292 | 2.82 | 11.6 / 9.5 | 45 | 427 / 697 / 839 | 0 / 0 | 140 | 8.47 (-1) | 0.972 / 0.961 | 7.4 / 24.9 |
| round 4 `off` (084652Z) | 0.320 | 0.173 | 0.198 | | | | 333 / 611 / 801 | 0 / 0 | 139 | 8.45 (-1) | 0.975 / 0.961 | |
| round 4 `natural` (084339Z, a fixed 2 s nod gap) | 0.327 | 0.183 | 0.322 | 3.14 | 13.5 / 9.0 | 21 | 351 / 443 / 503 | 0 / 0 | 164 | 8.39 (-1) | 0.972 / 0.958 | 4.2 / 5.6 |
| round 4 `natural` (085148Z, final) | 0.332 | 0.191 | 0.293 | 2.53 | 9.4 / 9.7 | 18 | 482 / 814 / 854 | 0 / 0 | 36 | 8.32 (-1) | 0.969 / 0.942 | 5.7 / 13.5 |
| round 4 `natural`, matte on (084928Z) | 0.322 | 0.185 | 0.316 | | | 17 | 473 / 511 / 556 | 0 / 0 | 146 | 8.43 (-1) | 0.971 / 0.949 | 5.0 / 5.8 |

- The shoulders and the far backdrop are as still as with `off` (0.32-0.33 against 0.32; round 3
  moved them 5x). What is left is FlashHead's own sub-pixel body motion and the JPEG/H.264 noise.
  The near backdrop (the halo, within 60 px of the head) moves with the head, as designed.
- The head moves as much as in round 3 or more (roll 2.5-3.1 degrees on the output, nose x 9-13 px),
  but it is the head: the crown travels 19-22 px (p95 - p5, as applied) while the collar does not move.
- SyncNet stays in the run-to-run band (8.3-8.5). Identity: 0.969-0.972 with motion against 0.975
  without, the same small drop round 3 measured (0.972); the final run's p5 (0.942) is lower, and its
  minimum (0.897) sits on a gaze glance.
- The final `natural` run shared the GPU with another job (a 1.3 GB co-tenant at its end; chunk p95
  814 ms against 443 for the same code an hour earlier), so its slack fell to 36 ms. Still 0 late.
- The warp is 4-6 ms per chunk on the GPU (p50); the segmenter refresh runs on a CPU thread.

**Review clips** (`var/talking-head/live-review-r4/p1/`, recorded through the server on port 8766
with Maxine, the way `/live?out=1` receives the stream): `line-off`, `line-natural`, `line-lively`
(the same typed line), `passage-natural` (5 sentences) and `matte-natural` (matte on, over a light
background). `contact-sheet.jpg` shows 8 frames per clip; each clip folder has a
`shoulders-strip.jpg` (the shoulder band at 8 times); `clipcheck.json` has the shoulder figures.

Measured on the recorded clips (the Maxine output scaled back to 512, from the line's start;
the same masks as above; spread = p95 of the per-pixel max - min over the clip inside the shoulders),
with round 3's clips of the same lines:

| clip | shoulders, frame-to-frame | far backdrop | shoulder spread | round 3: shoulders / spread |
| --- | --- | --- | --- | --- |
| `line-off` | 0.333 | 0.192 | 24 | 0.336 / 24 |
| `line-natural` | 0.338 | 0.204 | 22 | **1.904 / 79** |
| `line-lively` | 0.321 | 0.223 | 21 | **2.579 / 100** |
| `passage-natural` | 0.341 | 0.213 | 33 | 2.553 / 93 |
| `matte-natural` | 0.334 | 0.013 (light backdrop) | 24 | 3.720 / 119 |

Every clip has all its frames (none missing at the 40 ms grid), and the server logged no error.
`motion-spread-off-r4natural-r3natural.png` shows where `line-off`, `line-natural` and round 3's
`line-natural` move (per-pixel max - min, x2): round 4's collar and shoulders show the same thin
edges as `off` (FlashHead's own sub-pixel body motion and compression), round 3's are thick bands.
`zoom-sheet-natural.jpg` crops the neck, the hair edges and the crown at the four extreme poses of
the final `natural` bench run, beside the same frames of the `off` run, x2.5: no seam, no fold at
the collar, no tear under the chin. `offline/` holds the soft-against-rigid comparison, the weight
map over the bust and side-by-side `off` | moved videos of the whole pitch-45s for `natural` and
`lively`.

Not done: the owner's eye. The figures say the shoulders and the backdrop do not move; whether the
head's motion now reads as a person talking (`natural`) and an animated presenter (`lively`) is the
review's call.

# Doc text, round 4 P2 (face transplant): for docs/talking-head.md, "Live" section

### Face transplant probe (round 4, P2; `th/experiments/transplant`)

An offline probe of a path to body, hands and natural head motion with FlashHead's lip-sync: paste FlashHead's talking face onto each frame of an EchoMimicV3 (EMV3) gesture clip of the same audio. Nothing in `th` imports it.

```
uv run python -m th.experiments.transplant crop a c       # bust crop of hands/gen/waist-<v>.png, live framing
uv run python -m th.experiments.transplant fh a c         # FlashHead Lite on it + hands/line-short.wav (GPU lock)
uv run python -m th.experiments.transplant paste a c [--no-smooth] [--clip-eyes]   # CPU
uv run python -m th.experiments.transplant measure a c [--clip-eyes]               # GPU lock for SyncNet/identity
```

Inputs: `var/talking-head/hands/emv3-<v>8g/clip.mp4` (624x928, 125 frames) and `hands/gen/waist-<v>.png`. Outputs go to `var/talking-head/live-review-r4/p2/<v>/`:
- `composite.mp4` (with audio);
- `sbs.mp4` and `sbs-face.mp4` (EMV3 alone | composite, full frame and the face zoomed 2x);
- `edge-sheet.png` (six frames zoomed 2x, the fastest head move included);
- `figures.json`;
- `fh/clip.mp4` (the FlashHead source);
- `-eyes` variants of the outputs above.

**How it works:**
- **Face source.** A bust crop of the same waist-up image, framed like the live portrait: MediaPipe's face box sits where it sits in the live crop (x 0.240-0.753, y 0.157-0.737 of the side), resized to 512. FlashHead Lite then runs through the `realtime-fh` streaming driver: 144 frames, 56 fps, 0 slow chunks, 17-32 s with the model load.
- **Per frame:**
  - MediaPipe Face Landmarker (VIDEO mode, one instance per stream) on the EMV3 frame and the FlashHead frame.
  - A least-squares similarity (Umeyama, no reflection) on 20 points that do not move with speech: eye corners, nose, temples, face sides at eye level, glabella.
  - A causal One-Euro filter on where the transform puts three anchor points (3 Hz, beta 1.0). A frame without landmarks holds the last transform.
  - The FlashHead frame is area-downscaled, then warped.
- **Mask:**
  - Based on the face oval. It is pulled in 2% of face width at the sides, pushed out 4% of face height below the nose line (both jaws covered), and cut just above the brows (the fringe stays EMV3's).
  - The mask is drawn for both faces and united. A Gaussian feather (sigma 3.5% of face width) lies inside the polygon.
  - `--clip-eyes` cuts feathered holes over EMV3's eyes, so its blinks and gaze stay.
- **Colour:** Lab mean/std transfer from a band just inside the mask edge (12% of face width), with the std ratio clamped to 0.75-1.33 and the statistics averaged over time (EMA 0.2).

**Measured (RTX 4090, 2026-11-17; the same `line-short.wav`, 5 s):**

| figure | a: EMV3 alone | a: composite | c: EMV3 alone | c: composite |
| --- | --- | --- | --- | --- |
| SyncNet conf (offset) | 5.02 (0) | **9.83 (-1)** | 6.15 (0) | **10.44 (-2)** |
| identity mean / p5 | 0.828 / 0.776 | 0.858 / 0.802 | 0.864 / 0.835 | 0.879 / 0.840 |
| composite with `--clip-eyes`: SyncNet, identity mean | | 9.80, 0.834 | | 10.38, 0.887 |
| FlashHead source: SyncNet, identity mean | | 9.87, 0.942 | | 10.29, 0.936 |
| landmark misses / held frames | | 0 / 0 | | 0 / 0 |

**Jitter (stable landmarks of the composite against EMV3's, px, face height 158/171 px):**

| figure | a | c |
| --- | --- | --- |
| offset (median) | 0.58 | 0.60 |
| slide (RMS frame-to-frame change of the residual) | 0.38 (0.0024 face heights) | 0.41 (0.0024) |
| frame-rate high-pass | 0.19 | 0.20 |
| landmark noise floor (EMV3 head high-pass) | 0.25 | 0.23 |
| EMV3 head speed: median / max per frame | 0.20 / 3.94 | 0.44 / 2.49 |
| EMV3 head travel | 16.2 | 15.2 |

- An independent optical-flow check, which does not trust the landmarks, compares the pasted upper face against the hair and ears outside the mask. In px per frame (RMS):

  | clip | EMV3 alone | composite |
  | --- | --- | --- |
  | a | 0.64 | 0.68 |
  | c | 0.55 | 0.58 |

  The paste adds no sliding beyond what EMV3's own hair does against its face.
- **Filter tuning.**

  | filter | slide (px, a / c) |
  | --- | --- |
  | 1 Hz / beta 0.05 | 0.68 / 0.61 |
  | 3 Hz / beta 1.0 (default) | 0.38 / 0.41 |
  | unfiltered | 0.31 / 0.33 |

  The heavy filter lagged the head, which doubled the slide. The flow check cannot tell the settings apart.
- **Cost per frame (CPU, one thread):**
  - EMV3 landmarks: 6.6-7.8 ms median;
  - FlashHead landmarks: 6.2-7.5 ms;
  - warp, mask, colour and blend in the face box: 4.9-6.5 ms.

**Seen in the clips:**
- No colour seam or edge at the jaw, cheeks or fringe at 2x zoom (`edge-sheet.png`). The face stays on the head through the fastest move (a, f100-107).
- Honest flaws:
  - FlashHead does not blink in 5 s (eye aspect ratio never below 78% of its median), but EMV3 blinks twice in each clip. The composite therefore stares. `--clip-eyes` brings the blinks back, but EMV3-a's eyes are darker and less like Iris (identity 0.858 -> 0.834; c: 0.879 -> 0.887).
  - FlashHead's picture leads its audio by 1-2 frames (live: -1), so the composite inherits that.
- Identity rises only 0.015-0.03 over EMV3 alone, while FlashHead alone scores 0.94.
  - Resolution is a small part of the gap: FlashHead downscaled to the composite's face size scores 0.92.
  - The rest comes from what stays EMV3's in the identity crop (hair, ears, jaw outline) and from the colour pull toward EMV3's skin.
  - The waist-up stills themselves score 0.927 (a) and 0.901 (c).

#### Path to live (note)

A live version needs:
1. **A pre-rendered EMV3 gesture-clip library.**
   - Cost: about 200 s per 5 s clip at 8 steps (18 GB peak, offloaded). Strictly offline, about 40x real time.
   - Clips start and end in one neutral pose, so they cut together. Speech-agnostic or generic speech drives them, because the face is replaced anyway; the jaw outline is inside the mask.
   - Each clip has its EMV3 landmarks precomputed. That removes 7 ms per frame live.
   - The engine selects a clip at sentence boundaries (by length and energy, or a gesture tag), and idle loops when nothing is said.
2. **FlashHead live on the face, unchanged:** the same bust crop of the same waist-up image as the clips, so lighting and identity match.
3. **The compositor per frame at 25 fps:** FlashHead landmarks (about 7 ms) plus the paste (about 5-6 ms) is about 12 ms of CPU per frame, a third of the 40 ms budget on one thread.
   - It fits the existing 4-thread JPEG pool, or a stage before it. The warp and blend could also move to the GPU stage (frames are already there); MediaPipe stays on the CPU.
   - Must be checked in the FlashHead env: mediapipe 0.10.9 and numpy 1, against 1.2.3 here.

Main risks:
- **Head turns beyond a 2D similarity.** EMV3 here rolls about 1.6 degrees and travels about 0.1 face heights. A large yaw puts a frontal FlashHead face on a turned head, which gives the "mask" look. Gesture clips would need to be selected or filtered for small yaw, or measured per clip.
- **Seams between gesture clips:** body jumps at a clip change unless the clips share a pose, or a crossfade hides the change.
- **Eyes:** FlashHead stares (no blinks), and EMV3's eyes cost likeness. A blink source is needed: clip eyes when their identity is good, or a FlashHead gaze/blink reference.
- **Resolution:** at 624x928 the face is about 160 px. A bigger output needs a bigger EMV3 render, or upscaling of the body.
- **Licences:**
  - The compositor loads only MediaPipe Face Landmarker (Apache-2.0) and uses OpenCV (Apache-2.0, already a mediapipe dependency).
  - EMV3's licence stands as ruled in iris-hands.
  - FlashHead's VAE_LTX is OpenRAIL-M (owner-accepted).

### Round 2: better hands for recorded videos (2026-11-17)

Owner verdict on round 1: EchoMimicV3-Flash with the gesture prompt on the open-hands image (`waist-c`) is the promising path, but the right hand deforms at the end of `emv3-c8g`. Round 2 adds a per-frame hand check, sweeps seeds and generator levers against it, and renders 15-20 s passages as continued windows. Outputs: `var/talking-head/live-review-r4/p3/` in the main checkout (picks in `picks/`).

```
uv run python -m th.experiments.hands check <clip.mp4>...      # hand check: hands.json, hands-worst.png, hands-flagged.png
uv run python -m th.experiments.hands emv3 --image <waist-c.png> --prompt gesture --seed 1116 --no-teacache \
    [--audio-cfg 3.0] [--steps 8] [--negative upstream|fingers] [--shift 5.0] [--out <dir>] --name <take>
uv run python -m th.experiments.hands emv3 ... --long [--overlap 9] [--audio-chunk 113] --wav <15-20 s line.wav>
                                                                # continued windows; per-chunk audio features
uv run python -m th.experiments.hands seams <clip.mp4>          # a --long take's joins (seams.json)
```

`check` refreshes the hand fields of an existing `figures.json`. `finish` (every `emv3`/`sa` render) now also runs the hand check and copies its result into `figures.json` (`handScore`, `handWorst`, `handWorstAt`, `flagKinds`); its SyncNet/identity pass takes the GPU lock like the render. The driver (`flash_driver.py`, copied into the clone as `th_hands_flash.py`) keeps upstream unedited and adds opt-in patches: CPU offload (round 1), TeaCache off, window continuation, per-chunk wav2vec features, and tolerance for a Windows file lock on upstream's temporary mp4 (one take was lost to `WinError 32` before it).

#### Hand check (`handcheck.py`, `handscan.py`, `handsheet.py`)

MediaPipe Hand Landmarker (Apache-2.0, the round-1 task file) runs on every frame in IMAGE mode, so no tracker carries a hand through a frame where it has fallen apart; landmarks are cached beside the clip (`hands.npz`). Two hand tracks are kept by nearest wrist (MediaPipe's handedness label flips). A visible hand is flagged when:

- `conf`: the handedness score is below 0.96 (the model is unsure it sees a hand);
- `jump`: the hand changes shape between frames beyond its own motion: the RMS residual after the best similarity fit of the previous frame's 21 points onto this frame's, over the hand's 2D size, is above 0.09;
- `faded`: the hand turns translucent: the luminance under its landmarks falls below 70 % of the track's median (the jacket shows through);
- `lost`: a hand that was seen is missing while its last position is well inside the frame (melted into the sleeve, smeared away), for as long as it stays missing; not when its last box meets the other hand's (clasped: hidden behind it);
- `bones` / `shape`: gross geometry only: a phalanx under 0.01 or over 0.75 of the palm length (wrist to middle knuckle), adjacent knuckles closer than 0.02 or further than 0.6 palm lengths.

Clasped hands (both found and overlapping, or one found over the other's last box) are not judged: interlaced fingers turn every signal into noise (clasped hands that look right score 0.93-0.96, jitter, and put landmarks on the dark gaps between fingers). A frame where every hand is clasped is not a hand frame (`claspedFrames` counts them).

A take scores the share of hand frames with no flag (`handScore`) and its worst 0.5 s window (`handWorst`: the lowest share over 13 consecutive frames that hold at least 6 hand frames). Sheets: `hands-worst.png` (every frame of the worst window, both hands, red = flagged, with the reason) and `hands-flagged.png` (a sample of flagged frames).

What it is and is not. MediaPipe fits a plausible skeleton to almost anything, and its world-landmark proportions move with the view: a back-of-hand view puts the ring proximal phalanx at 0.02-0.04 of the palm and swaps the knuckle order on hands that look right, and a turned hand moves a phalanx ratio 2-3x. Anatomical bone-ratio ranges and joint-angle limits were tried first and dropped: they flagged every frame of every clip, rest poses included. The signals that separate good from bad are the score, the shape jump, translucency and the lost hand. Thresholds were set on one clip (`emv3-c8g`: frames 0-60 good by eye, the right hand's collapse at 113-124 bad), then checked by eye on the others:

| round-1 clip | handScore | worst 0.5 s | flagged (judged on the sheets) |
| --- | --- | --- | --- |
| emv3-c8g | 0.72 | 0.00 at 4.48 s | the right hand's collapse, 4.48-4.96 s, every frame (conf 0.93-0.96, jumps 0.10-0.15, one fade); fast-motion smears 3.1-4.2 s; the left hand in the same frames passes |
| sa (StableAvatar) | 0.77 | 0.00 at 3.92 s | the right hand melted into the sleeve 3.9-5.2 s (`lost`), the translucent ghost hands 5.3-5.5 s (`faded` 0.31-0.62); the rest poses before and after pass |
| emv3-c8g-s2 | 0.81 | 0.17 at 2.64 s | smeared, melting hands in the fast gesture 2.8-3.3 s (some smeared frames in the same stretch pass) |
| emv3-a8g | 0.78 | 0.00 at 3.68 s | the waist-a fast gestures 3.0-4.3 s |
| emv3, emv3-c20, emv3-a20 | 1.00 | 1.00 | nothing: these hands barely move |

Validation sheets: `live-review-r4/p3/validation/<clip>-hands-worst.png` and `-hands-flagged.png`. Known limits: recall is partial (a curled but plausible hand passes, and so do some smeared frames next to flagged ones); a confidence dip on a plausible hand is flagged (0.93-0.95 on some clean frames); motion blur is flagged (on a 25 fps generated clip it usually is a smear); a still hand scores 1.0, so `handScore` is read with the wrist travel (`wrist_range`), never alone.

#### Levers (5 s line, `waist-c`, gesture prompt)

Read in the Flash pipeline (`src/pipeline_wan_fun_inpaint_audio_2512.py`) before sweeping, then measured:

- **Negative prompt and text guidance are inert in Flash.** The negative prompt is encoded but never used in denoising: the guided pass is the same text prompt with the audio zeroed, and `--guidance_scale` only switches that pass on (> 1). Seed 1116 with a negative prompt naming deformed, extra and fused fingers plus text CFG 4.0 is bit-identical to round 1's `emv3-c8g` (mean absolute pixel difference 0.000 over 125 frames). The generator is deterministic per seed, so every other difference below is real.
- **TeaCache off helps.** It is on by default and the flag cannot turn it off (`store_true`, default True); the driver can (`--no-teacache`). In this pipeline it counts the conditional and the audio-free call of one step as two steps, so the audio-free call can reuse the conditional residual and the audio guidance collapses on skipped steps. Off, on three seeds: SyncNet +1.9 to +2.0 every time; on seed 1116 the right-hand collapse at the end is gone (hand score 0.72 to 0.86, worst window 0.00 to 0.38); on seed 2 the score rises 0.81 to 0.87 and the worst window 0.17 to 0.62; on seed 7 (little gesture) it falls 0.87 to 0.82. Identity drops 0.01-0.03. Denoising takes 195 s instead of 134 s for 125 frames.
- **Audio guidance 4.5** (with TeaCache off): on seed 1116 the best take of the round (SyncNet 9.18, hand score 0.87, more gesture: wrist travel 0.95 face heights, identity 0.853); on seed 42 also good (0.92, worst 0.50, SyncNet 8.34); on seed 2 worse (a hand smears and vanishes at 4.2 s, 0.54). 6.0 lifts SyncNet a little more (9.42) and hurts hands (0.77). In a 17 s passage 4.5 swung the hands out of the frame in the last window, where they turned into stumps (see below). Use 4.5 for single windows only, 3.0 for passages.
- **Steps 12** (TeaCache off): same hand score as 8, a worse worst window (0.15 vs 0.38), more gesture, SyncNet the same; 1.5x the denoising time. No gain; 16 not run.
- **Seed** is the biggest lever and it trades against gesture: the cleanest hands come with the smallest movement (seed 42: 0.99 with wrist travel 0.33). Render 3-4 seeds and pick by hand score among the takes that gesture.
- Resolution: 768x768 area is the Flash card's maximum; not raised.

All on `waist-c`, the gesture prompt and `line-short.wav` (5.0 s); outputs `live-review-r4/p3/<take>/` (clip, sheet, hands sheets, figures.json, hands.json):

| take | seed | steps | audio CFG | TeaCache | hand score | worst 0.5 s | flags | SyncNet | identity | wrist travel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| emv3-c8g (round 1) | 1116 | 8 | 3.0 | on | 0.72 | 0.00 at 4.48 s | conf 23, jump 15, faded 9, lost 1 | 6.15 | 0.864 | 0.83 |
| emv3-c8g-s2 (round 1) | 2 | 8 | 3.0 | on | 0.81 | 0.17 at 2.64 s | jump 13, conf 7, lost 4, faded 3, shape 1 | 5.95 | 0.856 | 0.78 |
| c8-s1116-negtxt, negative 'fingers', text CFG 4.0 | 1116 | 8 | 3.0 | on | 0.72 | 0.00 at 4.48 s | conf 23, jump 15, faded 9, lost 1 | 6.15 | 0.864 | 0.83 |
| c8-s1116-notc | 1116 | 8 | 3.0 | off | 0.86 | 0.38 at 3.0 s | conf 15, jump 10, faded 1 | 8.15 | 0.834 | 0.79 |
| c8-s1116-notc-a45 | 1116 | 8 | 4.5 | off | 0.87 | 0.31 at 2.68 s | conf 12, jump 8 | 9.18 | 0.853 | 0.95 |
| c8-s1116-notc-a60 | 1116 | 8 | 6.0 | off | 0.77 | 0.31 at 2.56 s | conf 20, jump 10, faded 8, lost 1 | 9.42 | 0.854 | 0.77 |
| c8-s1116-notc-st12 | 1116 | 12 | 3.0 | off | 0.86 | 0.15 at 3.68 s | jump 11, conf 10 | 8.00 | 0.840 | 0.97 |
| c8-s2-notc | 2 | 8 | 3.0 | off | 0.87 | 0.62 at 3.16 s | jump 10, conf 3 | 7.85 | 0.843 | 0.85 |
| c8-s2-notc-a45 | 2 | 8 | 4.5 | off | 0.54 | 0.00 at 3.88 s | lost 20, conf 8, jump 7 | 8.56 | 0.861 | 0.59 |
| c8-s42 | 42 | 8 | 3.0 | on | 0.99 | 0.83 at 3.8 s | conf 1 | 5.02 | 0.860 | 0.33 |
| c8-s42-notc-a45 | 42 | 8 | 4.5 | off | 0.92 | 0.50 at 2.56 s | jump 9, conf 5 | 8.34 | 0.805 | 0.49 |
| c8-s7 | 7 | 8 | 3.0 | on | 0.87 | 0.62 at 0.68 s | conf 9, jump 5 | 4.80 | 0.848 | 0.40 |
| c8-s7-notc | 7 | 8 | 3.0 | off | 0.82 | 0.38 at 1.12 s | conf 16, jump 2 | 6.70 | 0.829 | 0.35 |

#### Long passages: window continuation

`--long` renders the whole line as windows of at most 121 frames (the card caps one window at 137), equal strides on the VAE's 4-frame grid; every window after the first is conditioned on the last 9 frames of the clip so far (the mask keeps them, as upstream's `infer_preview.py` continues a long clip, without its RetinaFace face mask: Flash takes no face mask), the CLIP identity image stays the reference, and the 9 overlapping frames are crossfaded. A 17 s line (`passage.wav`, Kokoro, "Let me show you three reasons ... First ... Second ... And finally ...") is 425 frames in 4 windows of 113; one passage holds the GPU lock 14-16 min (4 x 165 s denoising plus loading), peak 19.9 GB, no driver errors.

Seams (`seams.json`): the frame step (mean absolute RGB change between consecutive frames) over each crossfade, against the clip's median step, and the face-centre step the same way; per window, SyncNet and identity.

| passage (17 s) | seed | audio CFG | overlap | audio features | hand score | worst 0.5 s | SyncNet (per window) | identity (per window) | wrist travel | join step / clip p99 step (x median) | join face step (x median) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| long-s1116-notc | 1116 | 3.0 | 9 | whole line | 0.74 | 0.08 at 1.44 s | 2.88 (2.8 / 2.7 / 2.0 / 3.7) | 0.810 (0.78 / 0.82 / 0.82 / 0.81) | 0.52 | 3.9 / 1.7 / 1.4 / 3.6 | 3.8 / 1.2 / 3.0 |
| long-s1116-notc-a45 | 1116 | 4.5 | 9 | whole line | 0.66 | 0.00 at 12.24 s | 3.95 (3.5 / 4.0 / 2.7 / 4.9) | 0.781 (0.78 / 0.78 / 0.80 / 0.78) | 0.59 | 4.7 / 1.6 / 4.6 / 4.6 | 4.2 / 1.6 / 4.3 |
| long-s1116-notc-ac113 | 1116 | 3.0 | 9 | per 113 frames | 0.47 | 0.00 at 5.16 s | 5.72 (4.8 / 6.8 / 5.2 / 5.4) | 0.816 (0.83 / 0.83 / 0.83 / 0.76) | 1.80 | 2.9 / 0.9 / 1.6 / 2.9 | 2.6 / 1.3 / 2.6 |
| long-s1116-notc-o5 | 1116 | 3.0 | 5 | whole line | 0.66 | 0.00 at 15.72 s | 3.27 (2.7 / 3.8 / 1.8 / 4.0) | 0.790 (0.75 / 0.83 / 0.82 / 0.77) | 0.51 | 4.2 / 1.1 / 1.4 / 3.8 | 4.6 / 1.3 / 2.2 |
| long-s42-notc-ac113 | 42 | 3.0 | 9 | per 113 frames | 0.80 | 0.11 at 9.2 s | 6.28 (5.6 / 7.2 / 4.2 / 6.5) | 0.813 (0.80 / 0.81 / 0.79 / 0.85) | 0.58 | 2.2 / 4.9 / 1.6 / 4.6 | 3.6 / 5.7 / 4.5 |
| long-s7-notc | 7 | 3.0 | 9 | whole line | 0.98 | 0.77 at 2.32 s | 2.18 (2.3 / 2.5 / 1.2 / 2.1) | 0.794 (0.75 / 0.83 / 0.81 / 0.78) | 0.31 | 2.7 / 1.6 / 2.3 / 2.6 | 6.7 / 3.3 / 3.8 |
| long-s7-notc-ac113 | 7 | 3.0 | 9 | per 113 frames | 0.86 | 0.00 at 15.56 s | 5.68 (5.2 / 7.2 / 3.8 / 5.4) | 0.816 (0.78 / 0.84 / 0.78 / 0.77) | 0.37 | 2.1 / 1.0 / 2.2 / 3.2 | 9.2 / 1.6 / 4.2 |

What the passages show:

- **The joins hold.** Every crossfade's largest frame step is at or within the clip's own 99th-percentile step (the ordinary fast-gesture frames); no pop, no double image, no backdrop jump (the top backdrop corners change 0.15-0.24 grey levels per frame on average, at most 1.6, in every passage: no camera motion). The face-centre step peaks at a join at 0.024 face heights per frame in the worst case (seed 7, first join): a short nod over five frames, seen frame by frame on a face crop, not a jump. Identity per window stays 0.75-0.84 with no drift across windows.
- **Lip-sync across a long line needs per-window audio features.** With upstream's wav2vec pass over the whole 17 s line, SyncNet per window is 1.2-4.9 (whole passage 2.2-3.9). The same audio cut to its first 4.6 s and rendered as one window scores 4.5, and the 5 s test line scores 6.7-9.4. With `--audio-chunk 113` (features per 113-frame chunk with 1 s of context each side) the passage scores 5.68, 5.72 and 6.28 on three seeds (windows 3.8-7.2), up from 2.18 and 2.88 on the two seeds rendered both ways, at no extra cost. Upstream's encoder was trained on few-second clips; a 17 s context changes the features.
- **The motion-frame prior calms the gestures down.** After the first window, hands tend to settle into a clasped rest (wrist travel 0.31-0.59 face heights over 17 s, against 0.79-0.95 for a gesturing 5 s take). Raising the audio guidance to 4.5 brings big gestures back but swung both hands out of the frame in the last window, where they turned into stumps (hand score 0.66, worst window 0.00 at 12.2 s). Per-chunk audio features also strengthen motion: with seed 1116 the hands flail, smear and grow a dark smudge where they clasp (0.47); with seed 7 they stay calm and clean (0.86) and with seed 42 they gesture more, with a few smeared frames at 8-9.5 s (0.80).
- **Overlap 5 instead of 9** made no difference to the seams (largest join step 4.2 vs 3.9 x median) and did not help the hands (0.66 vs 0.74; the difference is the seed's noise, the windows differ in length).
- One passage holds the GPU lock 13-16 min, under the 20-min turn.

#### Picks

- **Best 5 s take: `c8-s1116-notc-a45`** (seed 1116, TeaCache off, audio guidance 4.5): hand score 0.87, worst 0.5 s 0.31 (confidence dips on hands that look right, and motion blur at 3.1 s), SyncNet 9.18, identity 0.853, the most gesture of the round (wrist travel 0.95). Every 5th frame's hands, by eye: no deformed hand (`picks/best5s-hands-every5.png`). Against round 1's `emv3-c8g` (same seed): the right hand no longer collapses at the end, and SyncNet is 9.18 instead of 6.15.
- **Best 17 s passage: `long-s7-notc-ac113`** (seed 7, TeaCache off, per-chunk audio features, overlap 9): hand score 0.86, SyncNet 5.68, identity 0.816, seams within the clip's own motion. Honest read: the hands are clean but calm; they gesture for the first 7 s, rest clasped from 7.5 to 15 s and open again at the end, where the left hand's fingers look long and curved (the worst 0.5 s, 15.6 s, flagged on confidence 0.93-0.95). The livelier alternative is `long-s42-notc-ac113` (SyncNet 6.28, wrist travel 0.58, hand score 0.80, smeared hands at 8-9.5 s).
- Files: `live-review-r4/p3/picks/` (`best-5s-*.mp4`, `best-passage-*.mp4`, `alt-passage-livelier-*.mp4`, round 1's `emv3-c8g` for comparison, and the hands sheets of each: worst window, flagged sample, every Nth frame).

Recipe for a recorded line: TeaCache off; one window (up to 5.4 s) at audio guidance 4.5, or a longer line with `--long --audio-chunk 113` at 3.0; 3-4 seeds, then pick by hand score among the takes that gesture, and watch the worst-window sheet before shipping. Still open: the gesture fades after the first window of a passage (a per-window prompt, or a fresh reference pose every window with a longer crossfade, are the next things to try), and the check's recall is partial (it is a screen for the worst frames, not a guarantee).

Cost, measured on the 4090: a 5 s single window 195 s denoising (TeaCache off) plus about 60 s loading and finishing; a 17 s passage 13.5-15.5 min wall, so about 48 GPU-minutes per finished video-minute.
