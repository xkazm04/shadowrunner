"""Candidate `sa`: StableAvatar-1.3B (Francis-Rings, MIT) on the waist-up reference at 480x832.

Reuses the `diffusion-sa` arm's clone, venv and base weights (Wan2.1-Fun-V1.1-1.3B-InP Apache-2.0,
wav2vec2-base-960h Apache-2.0); the only new file is `transformer3d-rec-vec.pt` (same HF repo and
commit as the arm, MIT), the checkpoint trained on 480x832 / 832x480 video, kept in
$TH_HOME/models/hands-sa/. The prompt asks for the presenter gestures; nothing else drives them.
"""

from __future__ import annotations

from pathlib import Path

from ...arms.base import ArmEnv
from ...paths import models_dir

SIZE = (480, 832)  # width, height: the checkpoint's vertical training size
REC_VEC = "transformer3d-rec-vec.pt"
REC_VEC_URL = ("https://huggingface.co/FrancisRing/StableAvatar/resolve/"
               "140cbd9e2b7b331898e66a8f07e74e1d04359f2f/StableAvatar-1.3B/transformer3d-rec-vec.pt")
PROMPT = ("A young woman with a silver-grey bob haircut with straight bangs, light blue eyes and "
          "turquoise eyeliner, wearing a black headset with a small boom microphone and a black "
          "high-collared tech jacket, stands waist-up facing the camera and presents to the "
          "viewer, talking and gesturing naturally with both hands, counting points on her "
          "fingers. Plain dark background, medium shot, static camera, soft studio lighting.")


def env() -> ArmEnv:
    return ArmEnv("diffusion-sa")


def transformer(kind: str) -> Path:
    if kind == "rec-vec":
        return models_dir("hands-sa") / REC_VEC
    return env().models / "StableAvatar" / "StableAvatar-1.3B" / "transformer3d-square.pt"


def command(reference: Path, wav: Path, work: Path, seed: int, steps: int, memory: str,
            kind: str) -> list[str]:
    m = env().models
    w, h = SIZE
    return [
        "python", "inference.py",
        "--config_path=deepspeed_config/wan2.1/wan_civitai.yaml",
        f"--pretrained_model_name_or_path={m / 'Wan2.1-Fun-V1.1-1.3B-InP'}",
        f"--transformer_path={transformer(kind)}",
        f"--pretrained_wav2vec_path={m / 'wav2vec2-base-960h'}",
        f"--validation_reference_path={reference.resolve()}",
        f"--validation_driven_audio_path={wav.resolve()}",
        f"--output_dir={work}",
        f"--validation_prompts={PROMPT}",
        f"--seed={seed}",
        "--ulysses_degree=1", "--ring_degree=1",
        "--motion_frame=25",
        f"--sample_steps={steps}",
        f"--width={w}", f"--height={h}",
        "--overlap_window_length=5",
        "--clip_sample_n_frames=81",
        f"--GPU_memory_mode={memory}",
        "--sample_text_guide_scale=3.0",
        "--sample_audio_guide_scale=5.0",
    ]


def output(work: Path) -> Path:
    return work / "video_without_audio.mp4"
