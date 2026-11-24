"""Arm `longcat` (spec iris-hands round 3, req 12): LongCat-Video-Avatar 1.6 (meituan-longcat), an
INTERNAL COMPARISON ONLY (owner ruling 2026-11-24: MIT weights, but the project page restricts
generated content to academic, non-commercial use). Every output directory and figures.json is
marked `"internalOnly": true`; nothing it renders is shipped.

- Code: github.com/meituan-longcat/LongCat-Video (MIT) at a pinned commit in $TH_HOME/repos/
  hands-longcat, upstream unedited; `longcat_driver.py` (copied in as th_hands_longcat.py) patches
  it at run time.
- Weights (fetched by the Director, pinned, licence.json beside them): $TH_HOME/models/
  hands-longcat/LongCat-Video-Avatar-1.6 (base_model_int8, loraA, loraB, scheduler,
  whisper-large-v3) and LongCat-Video (umT5-XXL text encoder, tokenizer, Wan VAE). The BF16 DiT and
  the LongCat-Video base DiT are not fetched; the INT8 DiT is the only one loaded.
- Not installed: `audio-separator` / onnxruntime (the UVR MDX-Net vocal separator; its model's
  licence is unverified). Our lines are clean TTS speech, so the driver skips vocal separation.
- Env $TH_HOME/envs/hands-longcat: Python 3.10, torch 2.6.0+cu124, upstream's pins where they
  matter (transformers 4.41.0, diffusers 0.35.1), flash-attn 2 from the community Windows build
  (as the diffusion-it arm) and triton-windows (block-sparse attention imports triton).
"""

from __future__ import annotations

from pathlib import Path

from ...arms.base import ArmEnv
from ...paths import models_dir

REPO_URL = "https://github.com/meituan-longcat/LongCat-Video.git"
REPO_REV = "58eb336edc5c8c63389838727e40b8c18434e54e"
TORCH = ("torch==2.6.0+cu124", "torchvision==0.21.0+cu124", "torchaudio==2.6.0+cu124")
TORCH_INDEX = "https://download.pytorch.org/whl/cu124"
FLASH_ATTN_WIN = ("https://github.com/kingbri1/flash-attention/releases/download/v2.7.4.post1/"
                  "flash_attn-2.7.4.post1%2Bcu124torch2.6.0cxx11abiFALSE-cp310-cp310-win_amd64.whl")
DEPS = ("numpy==1.26.4", "transformers==4.41.0", "diffusers==0.35.1", "accelerate", "einops",
        "ftfy", "regex", "loguru", "psutil", "av", "opencv-python", "imageio", "imageio-ffmpeg",
        "librosa", "soundfile", "pyloudnorm", "scipy", "safetensors", "tqdm", "Pillow",
        "sentencepiece", "protobuf", "setuptools", f"flash-attn @ {FLASH_ATTN_WIN}",
        "triton-windows<3.3")
NUM_FRAMES = 93       # upstream: frames per segment
COND_FRAMES = 13      # upstream: frames carried into the next segment
FPS = 25              # avatar-v1.5/1.6 save fps
INTERNAL = {"internalOnly": True,
            "internalNote": "LongCat-Video-Avatar 1.6: internal comparison only (owner ruling "
                            "2026-11-24); generated content restricted to academic use"}


def env() -> ArmEnv:
    return ArmEnv("hands-longcat")


def checkpoint() -> Path:
    return models_dir("hands-longcat") / "LongCat-Video-Avatar-1.6"


def setup() -> None:
    e = env()
    e.clone(REPO_URL, REPO_REV)
    e.make_venv("3.10", (), *TORCH, *DEPS, "--extra-index-url", TORCH_INDEX,
                "--index-strategy", "unsafe-best-match")


def segments_for(frames: int, n: int = NUM_FRAMES, cond: int = COND_FRAMES) -> int:
    """Segments upstream needs to cover `frames`: the first gives n, each next n - cond."""
    if frames <= n:
        return 1
    return 1 + -(-(frames - n) // (n - cond))


def write_driver() -> Path:
    p = env().repo / "th_hands_longcat.py"
    p.write_bytes((Path(__file__).parent / "longcat_driver.py").read_bytes())
    return p


if __name__ == "__main__":
    setup()


def command(input_json: Path, out: Path, segments: int, mix_steps: int = 4,
            mix_alpha: float = 1.0) -> list[str]:
    """README's 1.6 recipe (ai2v, distilled 8 steps with loraB, LoRA mix 4 / 1.0), single GPU,
    INT8 DiT, 480p; long lines continue with --num_segments (ref_img_index 10, mask range 0)."""
    return ["python", "th_hands_longcat.py", "--input_json", str(input_json),
            "--output_dir", str(out), "--checkpoint_dir", str(checkpoint()),
            "--stage_1", "ai2v", "--resolution", "480p", "--num_segments", str(segments),
            "--ref_img_index", "10", "--mask_frame_range", "0", "--context_parallel_size", "1",
            "--model_type", "avatar-v1.6", "--use_distill", "--lora_path", "loraB/lora.safetensors",
            "--mix_steps", str(mix_steps), "--mix_alpha", str(mix_alpha), "--use_int8"]


def output(work: Path, segments: int) -> Path:
    p = work / ("ai2v_demo_1.mp4" if segments == 1 else f"video_continue_{segments}.mp4")
    if not p.is_file():
        raise SystemExit(f"hands: {p} missing")
    return p
