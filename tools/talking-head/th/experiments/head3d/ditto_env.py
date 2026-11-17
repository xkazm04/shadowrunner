"""Ditto (antgroup/ditto-talkinghead) for the head3d experiment, H2: code, env and weights.

- Code: github.com/antgroup/ditto-talkinghead (Apache-2.0) at a pinned commit, cloned into
  $TH_HOME/repos/head3d-ditto. Used unedited; ditto_shims.py adapts it from outside.
- Env: $TH_HOME/envs/head3d-ditto (Python 3.10, torch 2.6.0+cu124 as the core env, onnxruntime-gpu
  for HuBERT and landmark203, mediapipe 0.10.9 for the 478-point eye info and our face finder).
  This is the PyTorch path (native Windows, not real time: about 10 fps streaming). Upstream's
  TensorRT 8.6.1 engines are Linux builds; ditto_docker.py runs them in a container (real time).
- Weights: huggingface.co/digital-avatar/ditto-talkinghead (repo LICENSE: Apache-2.0) at a pinned
  revision, the PyTorch set only, into $TH_HOME/models/head3d-ditto with a licence.json.
- NOT fetched: `ditto_pytorch/aux_models/det_10g.onnx` and `2d106det.onnx`, nor the ONNX/TRT
  `insightface_det` / `landmark106`: InsightFace weights, non-commercial. Also not fetched: the
  ONNX set (not used) and WavLM (the cfg uses HuBERT). TensorRT engines: ditto_docker.fetch_engines.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from ...arms.base import write_licences
from ...paths import models_dir, th_home
from ...schema import Weight

NAME = "head3d-ditto"
REPO = "https://github.com/antgroup/ditto-talkinghead.git"
COMMIT = "c3e47eee2e626500017a0556b470d6d4182f85e8"
HF = "digital-avatar/ditto-talkinghead"
HF_REV = "e4a2f60328ee7c32af585ac4b3cce299e4c8e254"
CFG = "ditto_cfg/v0.4_hubert_cfg_pytorch.pkl"
FILES = (  # path in the HF repo, what it is
    ("LICENSE", "Apache-2.0 text of the weights repo"),
    (CFG, "PyTorch config (offline defaults; online settings come from the TRT online cfg)"),
    ("ditto_cfg/v0.4_hubert_cfg_trt_online.pkl", "online config, read for its settings only"),
    ("ditto_pytorch/models/appearance_extractor.pth", "LivePortrait-style appearance extractor"),
    ("ditto_pytorch/models/motion_extractor.pth", "LivePortrait-style motion extractor"),
    ("ditto_pytorch/models/warp_network.pth", "LivePortrait-style warping network"),
    ("ditto_pytorch/models/decoder.pth", "LivePortrait-style SPADE decoder"),
    ("ditto_pytorch/models/stitch_network.pth", "LivePortrait-style stitching network"),
    ("ditto_pytorch/models/lmdm_v0.4_hubert.pth", "Ditto motion diffusion (audio -> motion)"),
    ("ditto_pytorch/aux_models/hubert_streaming_fix_kv.onnx", "HuBERT streaming audio features"),
    ("ditto_pytorch/aux_models/landmark203.onnx", "203-point landmark refiner (crop)"),
    ("ditto_pytorch/aux_models/face_landmarker.task", "MediaPipe Face Landmarker (Apache-2.0)"),
)
EXCLUDED = ("ditto_pytorch/aux_models/det_10g.onnx", "ditto_pytorch/aux_models/2d106det.onnx",
            "ditto_onnx/insightface_det.onnx", "ditto_onnx/landmark106.onnx",
            "ditto_trt_Ampere_Plus/insightface_det_fp16.engine",
            "ditto_trt_Ampere_Plus/landmark106_fp16.engine")
PACKAGES = ("numpy==1.26.4", "librosa", "einops", "tqdm", "filetype", "imageio", "imageio-ffmpeg",
            "opencv-python-headless<4.11", "scikit-image", "cython", "colored",
            "onnxruntime-gpu>=1.20,<1.21", "mediapipe==0.10.9", "scipy", "soundfile")
TORCH = ("torch==2.6.0", "torchvision==0.21.0")
TORCH_INDEX = "https://download.pytorch.org/whl/cu124"


def repo_dir() -> Path:
    return th_home() / "repos" / NAME


def env_python() -> Path:
    return th_home() / "envs" / NAME / "Scripts" / "python.exe"


def data_root() -> Path:
    return models_dir(NAME) / "ditto_pytorch"


def cfg_path() -> Path:
    return models_dir(NAME) / CFG


def task_path() -> Path:
    return models_dir(NAME) / "ditto_pytorch" / "aux_models" / "face_landmarker.task"


def licences() -> list[Weight]:
    base = f"https://huggingface.co/{HF}/resolve/{HF_REV}/"
    rows = [Weight(name=f"ditto/{p}", licence="Apache-2.0 (repo LICENSE)", url=base + p, revision=HF_REV)
            for p, _ in FILES if p != "LICENSE" and not p.endswith(".task")]
    rows.append(Weight(name="mediapipe/face_landmarker.task", licence="Apache-2.0",
                       url=base + "ditto_pytorch/aux_models/face_landmarker.task", revision=HF_REV))
    rows.append(Weight(name="ditto-code", licence="Apache-2.0", url=REPO, revision=COMMIT))
    eng = models_dir(NAME) / "ditto_trt_Ampere_Plus"
    rows += [Weight(name=f"ditto/ditto_trt_Ampere_Plus/{p.name}", licence="Apache-2.0 (repo LICENSE)",
                    url=f"{base}ditto_trt_Ampere_Plus/{p.name}", revision=HF_REV)
             for p in sorted(eng.glob("*.engine"))] if eng.is_dir() else []
    return rows


def missing() -> list[str]:
    m = models_dir(NAME)
    return [p for p, _ in FILES if not (m / p).is_file() or (m / p).stat().st_size == 0]


def setup() -> dict:
    """Clone, env and weights; idempotent. Never fetches EXCLUDED."""
    r = repo_dir()
    if not (r / ".git").is_dir():
        subprocess.run(["git", "clone", REPO, str(r)], check=True)
    subprocess.run(["git", "-C", str(r), "checkout", "--quiet", COMMIT], check=True)
    env = th_home() / "envs" / NAME
    if not env_python().is_file():
        subprocess.run(["uv", "venv", "--python", "3.10", str(env)], check=True)
    py = ["--python", str(env_python())]
    subprocess.run(["uv", "pip", "install", *py, *TORCH, "--index-url", TORCH_INDEX], check=True)
    subprocess.run(["uv", "pip", "install", *py, *PACKAGES], check=True)
    m = models_dir(NAME)
    for p in missing():
        (m / p).parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{HF}/resolve/{HF_REV}/{p}"
        subprocess.run(["curl", "-sSL", "--fail", "-o", str(m / p), url], check=True)
    for p in EXCLUDED:
        if (m / p).exists():
            raise SystemExit(f"ditto: {m / p} is an InsightFace (non-commercial) file; remove it")
    write_licences(m, licences())
    return {"repo": str(r), "commit": COMMIT, "env": str(env), "weights": str(m), "hfRev": HF_REV,
            "missing": missing()}
