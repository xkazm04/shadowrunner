"""`diffusion-it` (WP2): InfiniteTalk (MeiGen-AI, Apache-2.0) in image-to-video mode.

STATUS (2026-11-16, owner): dropped from the comparison. On Windows + RTX 4090 at stock (40 steps,
3 CFG passes, 480p) it measured ~111 s/step, ~80 min per 81-frame chunk (~20 h for 45 s), and the
machine froze 52 min into the 5 s look-run (block offload streaming the 14B DiT through CPU RAM).
Do not re-run it unattended; the fast distill checkpoint (int8_lora = FusionX) is non-commercial.

Base Wan2.1-I2V-14B-480P (Apache-2.0) + InfiniteTalk audio weights (Apache-2.0) + chinese-wav2vec2-base
(MIT). On 24 GB it runs the repo's own FP8 single-person checkpoint (`--quant fp8`, DiT and T5 both
quantised by MeiGen) with `--num_persistent_param_in_dit 0` (block offload): the fp32 DiT shards
(65 GB) and the bf16 T5 (11 GB) are never fetched, because the quantised path does not read them.

Knobs (environment, recorded in the run's notes): TH_IT_SIZE (infinitetalk-480 | infinitetalk-720),
TH_IT_STEPS (default 40), TH_IT_TEACACHE=1 (the repo's TeaCache), TH_IT_PERSISTENT (DiT parameters
kept on the GPU, default 0 = everything streamed from RAM per step), TH_IT_MARLIN=1 (quanto's stock
Marlin fp8 kernels; they only build with GCC, so the default launcher (LAUNCH) avoids them).

This module also hosts the small HF fetch helpers the other WP2 arms reuse (`HfPart`, `fetch_parts`,
`require_parts`), because a WP2 builder owns only its three arm modules.
"""

from __future__ import annotations

import json
import math
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from ..schema import Weight
from .base import Arm, ArmEnv, ArmNotBuilt, FrameCallback, Job, RawResult

REPO_URL = "https://github.com/MeiGen-AI/InfiniteTalk.git"
REPO_REV = "50aa0a94184315407a991ae804d9b58d6d311ba8"

PROMPT = ("A young woman with a silver-grey bob haircut with straight bangs, light blue eyes and "
          "turquoise eyeliner, wearing a black headset with a small boom microphone and a black "
          "high-collared tech jacket, talks to the camera in a calm, friendly way. Plain dark "
          "background, close-up, static camera, soft studio lighting.")


@dataclass(frozen=True)
class HfPart:
    """One Hugging Face repo (or a subset of it) under models/<arm>/<sub>, pinned to a commit."""

    sub: str
    repo: str
    revision: str
    licence: str
    allow: tuple[str, ...] | None = None  # allow_patterns; None = the whole repo
    needs: tuple[str, ...] = ()           # files that must exist for the arm to run

    def weight(self) -> Weight:
        what = f" ({', '.join(self.allow)})" if self.allow else ""
        return Weight(name=f"{self.repo}{what}", licence=self.licence,
                      url=f"https://huggingface.co/{self.repo}", revision=self.revision)


def fetch_parts(models: Path, parts: tuple[HfPart, ...]) -> list[Weight]:
    from huggingface_hub import snapshot_download

    rows = []
    for p in parts:
        print(f"th fetch: {p.repo}@{p.revision[:10]} -> {models / p.sub}")
        snapshot_download(p.repo, revision=p.revision, local_dir=str(models / p.sub),
                          allow_patterns=list(p.allow) if p.allow else None, max_workers=8)
        rows.append(p.weight())
    return rows


def require_parts(arm_id: str, env: ArmEnv, parts: tuple[HfPart, ...]) -> None:
    """ArmNotBuilt unless the clone, the venv and every needed weight file are in place."""
    missing = [str(env.models / p.sub / f) for p in parts for f in p.needs
               if not (env.models / p.sub / f).is_file()]
    if not (env.repo / ".git").is_dir():
        missing.insert(0, str(env.repo))
    if not env.python.is_file():
        missing.insert(0, str(env.python))
    if missing:
        raise ArmNotBuilt(f"{arm_id}: not set up, run `uv run th fetch {arm_id}` "
                          f"(missing: {', '.join(missing[:3])})")


def work_dir(job: Job) -> Path:
    d = job.run_dir / "work"
    d.mkdir(parents=True, exist_ok=True)
    return d


PARTS = (
    HfPart("Wan2.1-I2V-14B-480P", "Wan-AI/Wan2.1-I2V-14B-480P",
           "6b73f84e66371cdfe870c72acd6826e1d61cf279", "Apache-2.0",
           ("config.json", "Wan2.1_VAE.pth", "models_clip_*.pth", "xlm-roberta-large/*",
            "google/*", "LICENSE.txt", "README.md"),
           ("config.json", "Wan2.1_VAE.pth",
            "models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth")),
    HfPart("InfiniteTalk", "MeiGen-AI/InfiniteTalk", "d59847ebdacf19245bfca3fb23311c0cada8378a",
           "Apache-2.0",
           ("quant_models/infinitetalk_single_fp8.*", "quant_models/t5_fp8.safetensors",
            "quant_models/t5_map_fp8.json", "README.md"),
           ("quant_models/infinitetalk_single_fp8.safetensors",
            "quant_models/infinitetalk_single_fp8.json", "quant_models/t5_fp8.safetensors")),
    HfPart("chinese-wav2vec2-base", "TencentGameMate/chinese-wav2vec2-base",
           "3991242c806928916fff4a8c0e4f76acf661b743", "MIT", None, ("config.json",)),
)

# optimum-quanto moves fp8 weights on a >= sm80 GPU into Marlin tensors, whose kernels it JIT-builds
# from CUDA sources written for GCC (`__asm__`), so the build fails under MSVC. Natively the launcher
# keeps them as plain WeightQBytesTensor: quanto's own torch fallback (fp8 -> bf16 * scale, matmul),
# the same arithmetic without the fused kernel. TH_IT_MARLIN=1 runs the stock path (Linux/docker).
LAUNCH = """import runpy, sys
import optimum.quanto.tensor.weights.qbytes as qb
def create(qtype, axis, size, stride, data, scale, activation_qtype=None, requires_grad=False):
    return qb.WeightQBytesTensor(qtype, axis, size, stride, data, scale, activation_qtype, requires_grad)
qb.WeightQBytesTensor.create = staticmethod(create)
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")
"""

FLASH_ATTN_WIN = ("https://github.com/kingbri1/flash-attention/releases/download/v2.7.4.post1/"
                  "flash_attn-2.7.4.post1%2Bcu124torch2.6.0cxx11abiFALSE-cp310-cp310-win_amd64.whl")
TORCH = ("torch==2.6.0+cu124", "torchvision==0.21.0+cu124", "torchaudio==2.6.0+cu124")
TORCH_INDEX = "https://download.pytorch.org/whl/cu124"
# requirements.txt minus gradio/dashscope (UI and a cloud prompt extender), plus what the README
# installs by hand; xformers is imported unconditionally by wan/modules/attention.py; xfuser 0.4.3
# because 0.8 registers ops torch 2.6 cannot parse
DEPS = ("xformers==0.0.29.post3", "opencv-python>=4.9.0.80", "diffusers>=0.31.0",
        "transformers>=4.49.0,<4.52", "tokenizers>=0.20.3", "accelerate>=1.1.1", "tqdm", "imageio",
        "easydict", "ftfy", "imageio-ffmpeg", "scikit-image", "loguru", "numpy>=1.23.5,<2",
        "xfuser==0.4.3", "pyloudnorm", "optimum-quanto==0.2.6", "scenedetect", "moviepy==1.0.3",
        "decord", "librosa", "soundfile", "misaki[en]", "psutil", "packaging", "einops",
        # wan/modules/clip.py asserts flash-attn 2; PyPI has no Windows wheel, this is a community
        # build of the same BSD-3-Clause source (kingbri1/flash-attention) for torch 2.6 + cu124
        f"flash-attn @ {FLASH_ATTN_WIN} ; sys_platform == 'win32'", "flash-attn==2.7.4.post1 ; sys_platform != 'win32'",
        # flash_attn.layers.rotary (imported by transformers once flash-attn exists) imports triton
        "triton-windows<3.3 ; sys_platform == 'win32'")


class InfiniteTalkArm(Arm):
    id = "diffusion-it"
    fps = 25  # the model's native rate

    def __init__(self) -> None:
        self.env = ArmEnv(self.id)

    def fetch(self) -> list[Weight]:
        self.env.clone(REPO_URL, REPO_REV)
        # one resolve, torch pinned to the cu124 build so no dependency swaps it for a CPU wheel
        self.env.make_venv("3.10", (), *TORCH, *DEPS, "--extra-index-url", TORCH_INDEX,
                           "--index-strategy", "unsafe-best-match")
        return fetch_parts(self.env.models, PARTS)

    def preflight(self, runtime: str) -> None:
        super().preflight(runtime)
        require_parts(self.id, self.env, PARTS)

    def settings(self) -> dict[str, object]:
        size = os.environ.get("TH_IT_SIZE", "infinitetalk-480")
        if size not in ("infinitetalk-480", "infinitetalk-720"):
            raise ArmNotBuilt(f"{self.id}: TH_IT_SIZE must be infinitetalk-480 or infinitetalk-720")
        return {"size": size, "steps": int(os.environ.get("TH_IT_STEPS", "40")),
                "teacache": os.environ.get("TH_IT_TEACACHE") == "1",
                "persistent": int(os.environ.get("TH_IT_PERSISTENT", "0")),
                "marlin": os.environ.get("TH_IT_MARLIN") == "1"}

    def input_json(self, job: Job, work: Path) -> Path:
        p = work / "input.json"
        body = {"prompt": PROMPT, "cond_video": job.portrait.resolve().as_posix(),
                "cond_audio": {"person1": job.audio.resolve().as_posix()}}
        p.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8", newline="\n")
        return p

    def command(self, job: Job, work: Path, settings: dict[str, object]) -> list[str]:
        m = self.env.models
        frames = math.ceil(job.audio_s * self.fps) + 81  # default cap is 1000 frames (40 s)
        launch = [] if settings.get("marlin") else ["-c", LAUNCH]
        argv = [
            "python", *launch, "generate_infinitetalk.py",
            "--ckpt_dir", str(m / "Wan2.1-I2V-14B-480P"),
            "--wav2vec_dir", str(m / "chinese-wav2vec2-base"),
            "--quant", "fp8",
            "--quant_dir", str(m / "InfiniteTalk" / "quant_models" / "infinitetalk_single_fp8.safetensors"),
            "--input_json", str(work / "input.json"),
            "--size", str(settings["size"]),
            "--sample_steps", str(settings["steps"]),
            "--mode", "streaming",
            "--motion_frame", "9",
            "--num_persistent_param_in_dit", str(settings["persistent"]),
            "--max_frame_num", str(frames),
            "--base_seed", str(job.seed),
            "--audio_save_dir", str(work / "audio"),
            "--save_file", str(work / "out"),
        ]
        if settings["teacache"]:
            argv.append("--use_teacache")
        return argv

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        work = work_dir(job)
        settings = self.settings()
        self.input_json(job, work)
        self.env.run(self.command(job, work, settings), cwd=self.env.repo, log=job.log,
                     env={"PYTHONIOENCODING": "utf-8", "TOKENIZERS_PARALLELISM": "false"})
        out = work / "out.mp4"
        if not out.is_file():
            raise RuntimeError(f"{self.id}: no {out} after a clean exit")
        shutil.move(str(out), job.raw)
        note = (f"InfiniteTalk fp8 single, {settings['size']}, {settings['steps']} steps, "
                f"streaming, offload (num_persistent_param_in_dit {settings['persistent']})"
                + (", TeaCache" if settings["teacache"] else "")
                + ("" if settings["marlin"] else "; quanto fp8 without Marlin kernels (Windows; MSVC cannot "
                                                "build them): render time is NOT representative of the "
                                                "stock Linux path"))
        return RawResult(video=job.raw, weights=self.weights(), notes=note)
