"""Ditto's TensorRT path in a Linux container (round 5, H2): upstream's `ditto_trt_Ampere_Plus`
engines are TensorRT 8.6.1 Linux builds (the 3D grid-sample plugin is serialized into the warp
engine as a Linux .so), so they cannot load natively on Windows. Docker Desktop's nvidia runtime runs
them on the 4090.

Image `th-head3d-ditto:trt861`: python:3.10-slim + TensorRT 8.6.1 (pip, NVIDIA index, bundles its CUDA
12 libs) + cuda-python + CPU torch (upstream's TRT wrapper and LMDM schedule import it; no CUDA torch
is needed on this path) + the same runtime packages as the native env. Nothing model-related is baked
in: $TH_HOME, the head3d code and the output dir are mounted. The engines used exclude
`insightface_det` / `landmark106` (InsightFace, non-commercial): ditto_shims replaces both steps.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from ...paths import th_home

IMAGE = "th-head3d-ditto:trt861"
ENGINES = ("appearance_extractor_fp16", "blaze_face_fp16", "decoder_fp16", "face_mesh_fp16",
           "landmark203_fp16", "lmdm_v0.4_hubert_fp32", "motion_extractor_fp32",
           "stitch_network_fp16", "warp_network_fp16", "hubert_fp32")
DOCKERFILE = """FROM python:3.10-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \\
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --extra-index-url https://pypi.nvidia.com \\
    tensorrt==8.6.1 tensorrt-libs==8.6.1 tensorrt-bindings==8.6.1 "cuda-python==12.6.2.post1" \\
    nvidia-cuda-runtime-cu12==12.1.105 nvidia-cublas-cu12==12.1.3.1 nvidia-cudnn-cu12==8.9.2.26
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \\
    --extra-index-url https://pypi.org/simple torch==2.5.1
RUN pip install --no-cache-dir numpy==1.26.4 librosa einops tqdm filetype imageio imageio-ffmpeg \\
    "opencv-python-headless<4.11" scikit-image colored scipy soundfile mediapipe==0.10.9
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.10/site-packages/nvidia/cudnn/lib:/usr/local/lib/python3.10/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.10/site-packages/nvidia/cuda_runtime/lib:/usr/local/lib/python3.10/site-packages/tensorrt_libs
WORKDIR /ditto
"""


def build_dir() -> Path:
    return th_home() / "repos" / "head3d-ditto-docker"


def build() -> str:
    d = build_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / "Dockerfile").write_text(DOCKERFILE, encoding="utf-8", newline="\n")
    subprocess.run(["docker", "build", "-t", IMAGE, str(d)], check=True)
    return IMAGE


def engines_dir() -> Path:
    return th_home() / "models" / "head3d-ditto" / "ditto_trt_Ampere_Plus"


def fetch_engines() -> list[str]:
    """The ENGINES (never insightface_det / landmark106) at the pinned HF revision; idempotent."""
    from .ditto_env import HF, HF_REV

    d = engines_dir()
    d.mkdir(parents=True, exist_ok=True)
    got = []
    for e in ENGINES:
        p = d / f"{e}.engine"
        if not p.is_file() or p.stat().st_size == 0:
            url = f"https://huggingface.co/{HF}/resolve/{HF_REV}/ditto_trt_Ampere_Plus/{e}.engine"
            subprocess.run(["curl", "-sSL", "--fail", "-o", str(p), url], check=True)
        got.append(p.name)
    return got


def trt_cfg_path() -> Path:
    return th_home() / "models" / "head3d-ditto" / "ditto_cfg" / "v0.4_hubert_cfg_trt_online.pkl"


def to_container(p: Path, mounts: dict[Path, str]) -> str:
    """Host path -> its path inside the container, through the first mount that holds it."""
    p = Path(p).resolve()
    for host, inner in mounts.items():
        try:
            return inner + "/" + p.relative_to(Path(host).resolve()).as_posix()
        except ValueError:
            continue
    raise ValueError(f"{p} is not under a mounted directory")


def run_cmd(runner_args: list[str], audio: Path, out: Path, here: Path, repo: Path) -> list[str]:
    """`docker run` argv for ditto_run.py in the container; runner_args use host paths, mapped."""
    mounts = {th_home(): "/th", here: "/h3d", out.parent: "/out", audio.parent: "/aud"}
    mapped = []
    for a in runner_args:
        mapped.append(to_container(Path(a), mounts) if Path(a).is_absolute() else a)
    vols = []
    for host, inner in mounts.items():
        vols += ["-v", f"{Path(host).resolve()}:{inner}"]
    return ["docker", "run", "--rm", "--gpus", "all", *vols, "-w", to_container(repo, mounts),
            IMAGE, "python", "/h3d/ditto_run.py", *mapped]
