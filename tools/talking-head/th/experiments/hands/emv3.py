"""Candidate `emv3`: EchoMimicV3-Flash (antgroup/echomimic_v3, Apache-2.0 code; BadToBest/EchoMimicV3
`echomimicv3-flash-pro`, Apache-2.0 card), Wan2.1-Fun-V1.1-1.3B-InP based, 8 steps, 25 fps.

Only the Flash path is used: `infer_flash.py` never imports `src/face_detect.py` (RetinaFace, whose
weights come from InsightFace = non-commercial), so `retina-face` and `tensorflow` are not installed.
Weights: the Flash DiT (3.73 GB, new, $TH_HOME/models/hands-emv3/transformer/), the Wan2.1-Fun base
(Apache-2.0) from the `diffusion-sa` arm and chinese-wav2vec2-base (MIT, same pinned commit) from the
`diffusion-it` arm; nothing else is loaded.

Memory: upstream `infer_flash.py` parses --GPU_memory_mode but ignores it and moves the whole
pipeline to the GPU (umT5-XXL alone is 11.4 GB). Our driver (written into the clone at run time)
replaces that one `pipeline.to(cuda)` with diffusers' `enable_model_cpu_offload` (whole components
in turn: T5, then CLIP, then the 1.3B DiT, then the VAE), so the peak stays far below 24 GB without
streaming any large model layer by layer. Upstream code is not edited.
"""

from __future__ import annotations

from pathlib import Path

from ...arms.base import ArmEnv
from ...paths import models_dir

REPO_URL = "https://github.com/antgroup/echomimic_v3.git"
REPO_REV = "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397"
HF_REV = "311e176905a8c4c24b240b530488fe636ce4d249"  # BadToBest/EchoMimicV3
FLASH_URL = f"https://huggingface.co/BadToBest/EchoMimicV3/resolve/{HF_REV}/echomimicv3-flash-pro"
TORCH = ("torch==2.6.0+cu124", "torchvision==0.21.0+cu124", "torchaudio==2.6.0+cu124")
TORCH_INDEX = "https://download.pytorch.org/whl/cu124"
# requirements.txt minus tensorflow + retina-face (face mask, preview only), gradio, tensorboard,
# mmgp (app_mm only); plus pyloudnorm, which infer_flash imports but requirements.txt omits
DEPS = ("Pillow", "einops", "safetensors", "timm", "tomesd", "torchdiffeq", "torchsde", "decord",
        "numpy<2", "scikit-image", "opencv-python", "omegaconf", "SentencePiece", "ftfy",
        "imageio[ffmpeg]", "imageio[pyav]", "beautifulsoup4", "accelerate>=1.1.1",
        "diffusers==0.30.1", "transformers==4.51.3", "tokenizers>=0.20.3", "moviepy==2.2.1",
        "librosa", "pyloudnorm")
SAMPLE_AREA = (768, 768)  # the Flash maximum, as an area: a 2:3 reference becomes 624 x 928
MAX_FRAMES = 137          # the README: longer than 138 frames needs Long Video CFG (not in Flash)
PROMPT = ("A young woman with a silver-grey bob haircut with straight bangs, light blue eyes and "
          "turquoise eyeliner, wearing a black headset with a small boom microphone and a black "
          "high-collared tech jacket, stands waist-up facing the camera and presents to the "
          "viewer, talking and gesturing naturally with both hands, counting points on her "
          "fingers. Plain dark background, medium shot, static camera, soft studio lighting.")

# the demo prompts' own template (datasets/echomimicv3_demos/prompts: "As the video progresses, the
# character speaks while ..."), turned from "hand movements remain minimal" into presenting gestures
GESTURE_PROMPT = ("A woman with a silver-grey bob and a black headset stands waist-up facing the "
                  "camera. As the video progresses, the character speaks while gesturing "
                  "expressively with both hands: she raises her hands to chest height, counts "
                  "points on her fingers and opens her palms toward the viewer, with natural arm "
                  "and body movements consistent with presenting. Don't blink too often. Preserve "
                  "background integrity matching the reference image's spatial configuration, "
                  "lighting conditions, and color temperature.")
PROMPTS = {"presenter": PROMPT, "gesture": GESTURE_PROMPT}

DRIVER = '''"""th iris-hands driver (written by th/experiments/hands/emv3.py): infer_flash.main() with the
one pipeline.to(cuda) replaced by enable_model_cpu_offload when TH_EMV3_OFFLOAD=1."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import infer_flash  # noqa: E402
from src.pipeline_wan_fun_inpaint_audio_2512 import WanFunInpaintAudioPipeline as P  # noqa: E402

_to = P.to


def _offload_to(self, *args, **kwargs):
    dev = kwargs.get("device", args[0] if args else None)
    if os.environ.get("TH_EMV3_OFFLOAD") == "1" and dev is not None and str(dev).startswith("cuda"):
        if not getattr(self, "_th_offloaded", False):
            self.enable_model_cpu_offload(device=dev)
            self._th_offloaded = True
        return self
    return _to(self, *args, **kwargs)


P.to = _offload_to
infer_flash.main()
'''


def env() -> ArmEnv:
    return ArmEnv("hands-emv3")


def setup() -> None:
    e = env()
    e.clone(REPO_URL, REPO_REV)
    e.make_venv("3.10", (), *TORCH, *DEPS, "--extra-index-url", TORCH_INDEX,
                "--index-strategy", "unsafe-best-match")


def frames_for(seconds: float, fps: int = 25) -> int:
    """Upstream's length rule: min(audio frames, cap), then down to 4k + 1 (the VAE's stride)."""
    n = min(int(seconds * fps), MAX_FRAMES)
    return (n - 1) // 4 * 4 + 1


def command(reference: Path, wav: Path, work: Path, seed: int, steps: int, frames: int,
            audio_cfg: float, text_cfg: float, prompt: str = PROMPT) -> list[str]:
    base = ArmEnv("diffusion-sa").models / "Wan2.1-Fun-V1.1-1.3B-InP"
    w2v = ArmEnv("diffusion-it").models / "chinese-wav2vec2-base"
    dit = models_dir("hands-emv3") / "transformer" / "diffusion_pytorch_model.safetensors"
    return [
        "python", "th_hands_flash.py",
        "--image_path", str(reference.resolve()), "--audio_path", str(wav.resolve()),
        "--prompt", prompt, "--num_inference_steps", str(steps),
        "--config_path", "config/config.yaml", "--model_name", str(base),
        "--transformer_path", str(dit), "--save_path", str(work),
        "--wav2vec_model_dir", str(w2v), "--sampler_name", "Flow_Unipc",
        "--video_length", str(frames), "--guidance_scale", str(text_cfg),
        "--audio_guidance_scale", str(audio_cfg), "--audio_scale", "1.0",
        "--neg_scale", "1.0", "--neg_steps", "0", "--seed", str(seed), "--enable_teacache",
        "--teacache_threshold", "0.1", "--num_skip_start_steps", "5", "--riflex_k", "6",
        "--ulysses_degree", "1", "--ring_degree", "1", "--weight_dtype", "bfloat16",
        "--sample_size", str(SAMPLE_AREA[0]), str(SAMPLE_AREA[1]), "--fps", "25",
        "--add_prompt", "", "--shift", "5.0",
    ]


def write_driver() -> Path:
    p = env().repo / "th_hands_flash.py"
    p.write_text(DRIVER, encoding="utf-8", newline="\n")
    return p


def output(work: Path, reference: Path) -> Path:
    return work / f"{reference.stem}_output.mp4"
