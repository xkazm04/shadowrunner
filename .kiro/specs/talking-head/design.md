# Design: talking-head

Source of truth for the builders. Decisions and rejected options: .spark/Spark/ideas/human-avatar-alt.md (main checkout).

## Repo law that binds every task
- Keep each file's line endings; write files with the Edit/Write tools or bytes, never a text-mode Python writer on an existing file.
- 400-line file cap (Python included).
- Never commit weights, audio or video; they live in $TH_HOME or var/.
- Report blockers with evidence instead of improvising a different model. A non-permissive dependency (InsightFace buffalo, Wav2Lip, Sonic, GaussianAvatars) is a blocker, not a workaround.
- Gates: `pnpm typecheck && pnpm lint && pnpm test` from the checkout root stay green; `uv run pytest` in tools/talking-head is green.

### Summary
A local tool, `tools/talking-head` (Python, on the RTX 4090), renders the Iris portrait speaking a script through five alternative arms: InfiniteTalk, StableAvatar, SoulX-FlashHead Lite, rig-idle + LatentSync, and Audio2Face -> our morph keys. Today's morph face is the baseline. Each run writes an MP4, an alpha WebM and a metrics file, imports into the Avatar Lab as an external run, and all arms meet on one blind synced board. The owner judges whether a different technical approach replicates commercial realism, at what render cost, and which arm earns a product path next.

### Work packages
**WP1 - Foundation** (one builder). Files: tools/talking-head/** (new), .gitignore check (var/ already ignored).
- uv project, Python 3.12, torch cu124 pinned. `th fetch <arm>` downloads weights to $TH_HOME/models/<arm>/ (TH_HOME default ~/.talking-head, outside every checkout so worktrees share it) and writes `licence.json` (name, licence, url, revision).
- Arm interface `th.arms.base.Arm`: `id`, `render(job: Job, on_frame: Callable|None) -> RawResult`. A registry maps ARM_IDS to classes, with stub classes for every arm that raise NotImplementedError("<arm>: WP2/WP3").
- `th audio --script <id>` renders a Kokoro wav (reuses kokoro-v1.0.onnx + voices-v1.0.bin from the MAIN checkout var/lab/models, resolved via git rev-parse --git-common-dir; override TH_KOKORO_DIR) into $TH_HOME/audio/<script>.wav plus .txt. Scripts live in tools/talking-head/scripts/{pitch-45s,long-180s}.txt.
- `th render --arm <id> --script <id> [--seed 1116] [--runtime native|docker]`. Takes the GPU lock ($TH_HOME/gpu.lock), calls the arm, then post-processes: normalise -> video.mp4 (1080x1080 H.264 30fps + AAC), BiRefNet -> alpha.webm (VP9 yuva420p), metrics -> run.json.
- Metrics: SyncNet conf/offset, DINOv2 identity cosine (mean/min/p5 over 1 fps samples of MediaPipe face crops vs portrait), renderS, rtf, ttffMs, vramPeakMiB.
- `th board --runs <dir,...> --seed n --out <dir>`: blind 3x2 xstack board.mp4 with letters A-F, key.json, verdict.md template (per-arm pick + notes).
- Acceptance:
  - `uv run th --help` lists fetch/audio/render/board.
  - `th audio --script pitch-45s` writes a wav of 40-50 s.
  - A synthetic `noop` arm (repeats the portrait frame) runs end to end and yields a video.mp4 that ffprobe reads, plus an alpha.webm whose decoded frame has alpha 0 in a corner and 255 at the face centre (pixel check, test), and a run.json validating against the schema.
  - pytest green.
  - Owns the doc: docs/talking-head.md.

**WP2 - Diffusion arms** (after WP1). Files: tools/talking-head/th/arms/{infinitetalk,stableavatar,flashhead}.py, docker/ if needed, tests.
- `diffusion-it` (InfiniteTalk, image-to-video mode, 480p or 720p whichever fits 24GB with offload; report which).
- `diffusion-sa` (StableAvatar).
- `realtime-fh` (FlashHead Lite streaming mode; on_frame fires per frame; ttffMs measured).
- Acceptance:
  - Each arm renders pitch-45s for Iris to a full run dir (or the builder reports the blocker with evidence and the attempted runtime).
  - Licence.json present per arm.
  - realtime-fh reports sustained fps over the clip.
  - No weights in git.
  - Emits a doc section to scratch.

**WP3 - Rig arms** (after WP1, parallel to WP2; GPU lock arbitrates). Files: tools/talking-head/th/arms/{baseline,a2f,dub}.py, tools/talking-head/th/rig/** (timeline + mapping), scripts/portrait/ (a timeline-driven capture entry, new file; capture.mjs extended only if needed), apps/web/bench/ (timeline input on the bench page only).
- `baseline`: today's product path. analyseSpeech visemes -> morph player -> headless capture at 30fps with audio muxed.
- `a2f-keys`: Audio2Face-3D weights -> th-timeline/1 (mouth shapes + mouthGain, expression family/weight from brows/squint, nod/tilt gestures from energy) -> same capture.
- `dub-ls`: baseline timeline with mouth forced neutral -> capture -> LatentSync 1.6 over it.
- Acceptance:
  - Three run dirs for pitch-45s.
  - The timeline JSON validates.
  - The baseline capture is visually the product face (overlay sheet of 3 frames vs studio).
  - The a2f mapping table is documented.
  - Bench page change does not touch product bundles (pnpm gates green).
  - Emits a doc section to scratch.

**WP4 - Director**
- Spec .kiro/specs/talking-head/ before fan-out.
- apps/lab/src/contract.ts `ExternalArmId = "overlord" | "talking-head"` plus `pnpm lab th-import <runDir>` (lab run with config.external "talking-head", thArm, and the face ROI from run.json).
- Run the matrix (6 arms x pitch-45s; long-180s for the arms that pass), board, verdict page for the owner.
- docs/lab.md section, docs/provenance.md (third-party model licences), kiro-log rows.

### Data & API
- run.json schema `th-run/1`: {schema, arm, script, seed, portrait, runtime, width, height, fps, durationS, renderS, rtf, ttffMs, vramPeakMiB, gpuExclusive, sync:{conf, offsetFrames}, identity:{mean, min, p5}, faceRoi:[x,y,w,h], weights:[{name, licence, url, revision}], notes}.
- Absent value = `null`, with the key always present (an arm that cannot measure TTFF writes null). Lab and board treat null as "n/a".
- ARM_IDS: noop, baseline, diffusion-it, diffusion-sa, realtime-fh, dub-ls, a2f-keys.
- th-timeline/1: {schema, fps:30, frames:[{t, mouth:{<shape>:w}, mouthGain, expression:{family, w}|null, gesture:<nod|tilt|lean_in|recoil|glare|flare>|null, blink:null|0..1, gaze:[x,y]|null}]}. Producer: WP3 a2f/baseline mappers. Consumer: WP3 capture entry (owned).
- Output dir: <main checkout>/var/talking-head/runs/<UTC stamp>-<arm>-<script>/{raw.mp4, video.mp4, alpha.webm, run.json, log.txt}.

### UX/UI spec
CLI only. The bench page gets a `?timeline=` input (dev-only). The board verdict page is an HTML/MD in var/ for the owner.

### Strings
None (no product UI).

### Non-goals
- Studio/product export.
- Live browser streaming.
- Real-presenter cloning.
- Training or fine-tuning.
- Non-permissive models (Sonic, GaussianAvatars, Wav2Lip, InsightFace).
- Committing weights or generated video.

### Risks
- InfiniteTalk 14B on 24GB may need heavy offload (slow) or fail natively on Windows -> docker runtime.
- Audio2Face-3D SDK is C++/TensorRT. A Python path may need the NIM/container or the open SDK build; the builder reports before improvising.
- FlashHead weight availability.
- LatentSync at 512 on a 1024 face may soften.
- GPU contention between WP2 and WP3 (lock).
- Disk: 350GB free, weights ~100GB worst case.

## Layout amendment (Director, 2026-11-16, before tasks 2-3)
- One module per arm: `th/arms/{noop,baseline,infinitetalk,stableavatar,flashhead,dub,a2f}.py`; the registry in `th/arms/__init__.py` imports them all and is owned by task 1. Tasks 2 and 3 replace only their own modules.
- Heavy arms never add dependencies to `tools/talking-head/pyproject.toml`. Each clones its upstream repo to `$TH_HOME/repos/<arm>` with its own venv `$TH_HOME/envs/<arm>` (or a Docker image) and runs it as a subprocess through `ArmEnv` (`th/arms/base.py`). The upstream projects pin mutually incompatible torch/diffusers stacks; isolation is the only way they share one machine.
- `faceRoi` is in video.mp4 pixels: the mouth box (lips + ~25% margin, jaw drop included) over the clip, or null.
- Lab seam (done, 59a8d5f): `pnpm lab th-import <run dir>` -> lab run with `external: "talking-head"`, `thArm`, `run.mp4`, one `say` line at t=0.
