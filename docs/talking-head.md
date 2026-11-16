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
