"""`diffusion-sa` (WP2): StableAvatar (Francis-Rings, MIT), Wan2.1-1.3B based, 512x512 at 25 fps.

Weights: StableAvatar-1.3B `transformer3d-square.pt` (FrancisRing/StableAvatar, MIT), the base
Wan2.1-Fun-V1.1-1.3B-InP (alibaba-pai, Apache-2.0) and wav2vec2-base-960h (facebook, Apache-2.0),
each from its own pinned repo. The vocal separator (Kim_Vocal_2.onnx) is not fetched: Kokoro audio
has no music to remove.

Knobs (environment, recorded in the notes): TH_SA_MEMORY (the repo's --GPU_memory_mode, default
model_cpu_offload so it fits beside another GPU user), TH_SA_STEPS (default 50), TH_SA_SIZE
(512x512 | 480x832 | 832x480, default 512x512).
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from ..schema import Weight
from .base import Arm, ArmEnv, ArmNotBuilt, FrameCallback, Job, RawResult
from .infinitetalk import PROMPT, HfPart, fetch_parts, require_parts, work_dir

REPO_URL = "https://github.com/Francis-Rings/StableAvatar.git"
REPO_REV = "38625187dc10913ba4facc32341a841ce0a8f29b"

PARTS = (
    HfPart("Wan2.1-Fun-V1.1-1.3B-InP", "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
           "fc913c34361f4ec879e2f9c78b4f11ae50a937d1", "Apache-2.0", None,
           ("diffusion_pytorch_model.safetensors", "Wan2.1_VAE.pth",
            "models_t5_umt5-xxl-enc-bf16.pth",
            "models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth")),
    HfPart("wav2vec2-base-960h", "facebook/wav2vec2-base-960h",
           "22aad52d435eb6dbaf354bdad9b0da84ce7d6156", "Apache-2.0",
           ("*.json", "model.safetensors"), ("model.safetensors", "preprocessor_config.json")),
    HfPart("StableAvatar", "FrancisRing/StableAvatar", "140cbd9e2b7b331898e66a8f07e74e1d04359f2f",
           "MIT", ("StableAvatar-1.3B/transformer3d-square.pt", "README.md"),
           ("StableAvatar-1.3B/transformer3d-square.pt",)),
)

TORCH = ("torch==2.6.0+cu124", "torchvision==0.21.0+cu124", "torchaudio==2.6.0+cu124")
TORCH_INDEX = "https://download.pytorch.org/whl/cu124"  # the README's cu124 option
# requirements.txt without its torch pins (cu128 ones), gradio, tensorboard, dashscope
DEPS = ("ninja", "Pillow", "einops", "safetensors", "timm", "tomesd", "torchdiffeq", "torchsde",
        "decord", "datasets", "opencv-python>=4.9.0.80", "diffusers==0.30.1", "transformers==4.51.3",
        "tokenizers>=0.20.3", "accelerate>=1.1.1", "tqdm", "easydict", "ftfy", "imageio-ffmpeg",
        "numpy>=1.23.5,<2", "scikit-image", "omegaconf", "SentencePiece", "albumentations",
        "imageio[ffmpeg]", "imageio[pyav]", "beautifulsoup4", "librosa", "moviepy==1.0.3")

# measured on pitch-45s: SyncNet gives -4 (picture 160 ms early) on raw.mp4 muxed with the source wav
# too, and realtime-fh gives 0 through the same path, so the lead is upstream. The long pipeline feeds
# latent i the audio from frame 4*i, while the causal VAE decodes latent i (i >= 1) to frames 4i-3..4i.
UPSTREAM_SYNC = ("upstream lip lead: SyncNet -4 frames (picture ~160 ms early) on raw.mp4 + source "
                 "wav as well; the long pipeline indexes latent i's audio from frame 4i while the "
                 "causal VAE decodes it to frames 4i-3..4i; not compensated")
SIZES = {"512x512": (512, 512), "480x832": (480, 832), "832x480": (832, 480)}  # width x height
MEMORY_MODES = ("model_full_load", "model_cpu_offload", "model_cpu_offload_and_qfloat8",
                "sequential_cpu_offload")


class StableAvatarArm(Arm):
    id = "diffusion-sa"

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
        size = os.environ.get("TH_SA_SIZE", "512x512")
        memory = os.environ.get("TH_SA_MEMORY", "model_cpu_offload")
        if size not in SIZES or memory not in MEMORY_MODES:
            raise ArmNotBuilt(f"{self.id}: TH_SA_SIZE in {sorted(SIZES)}, TH_SA_MEMORY in {MEMORY_MODES}")
        return {"size": size, "memory": memory, "steps": int(os.environ.get("TH_SA_STEPS", "50"))}

    def command(self, job: Job, work: Path, settings: dict[str, object]) -> list[str]:
        m = self.env.models
        w, h = SIZES[str(settings["size"])]
        # inference.sh's sample configuration, paths and seed ours
        return [
            "python", "inference.py",
            "--config_path=deepspeed_config/wan2.1/wan_civitai.yaml",
            f"--pretrained_model_name_or_path={m / 'Wan2.1-Fun-V1.1-1.3B-InP'}",
            f"--transformer_path={m / 'StableAvatar' / 'StableAvatar-1.3B' / 'transformer3d-square.pt'}",
            f"--pretrained_wav2vec_path={m / 'wav2vec2-base-960h'}",
            f"--validation_reference_path={job.portrait.resolve()}",
            f"--validation_driven_audio_path={job.audio.resolve()}",
            f"--output_dir={work}",
            f"--validation_prompts={PROMPT}",
            f"--seed={job.seed}",
            "--ulysses_degree=1", "--ring_degree=1",
            "--motion_frame=25",
            f"--sample_steps={settings['steps']}",
            f"--width={w}", f"--height={h}",
            "--overlap_window_length=5",
            "--clip_sample_n_frames=81",
            f"--GPU_memory_mode={settings['memory']}",
            "--sample_text_guide_scale=3.0",
            "--sample_audio_guide_scale=5.0",
        ]

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        work = work_dir(job)
        settings = self.settings()
        self.env.run(self.command(job, work, settings), cwd=self.env.repo, log=job.log,
                     env={"PYTHONIOENCODING": "utf-8", "TOKENIZERS_PARALLELISM": "false"})
        out = work / "video_without_audio.mp4"
        if not out.is_file():
            raise RuntimeError(f"{self.id}: no {out} after a clean exit")
        shutil.move(str(out), job.raw)
        for d in (work / "animated_images", work):  # upstream makes the first and leaves it empty
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        note = (f"StableAvatar-1.3B square, {settings['size']}, {settings['steps']} steps, "
                f"{settings['memory']}; {UPSTREAM_SYNC}")
        return RawResult(video=job.raw, weights=self.weights(), notes=note)
