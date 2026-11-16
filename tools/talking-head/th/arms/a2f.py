"""`a2f-keys`: NVIDIA Audio2Face-3D (regression model Mark v2.3, NVIDIA Open Model License; SDK MIT)
turns the wav into per-frame ARKit-style blendshape weights; th/rig/a2f_map.py maps them to a
th-timeline/1 (mouth shapes + size, expression family, nod/tilt gestures) that drives the REAL avatar
player in the timeline capture, as the baseline does.

Runtime: Docker only. The SDK is C++/TensorRT and wants CUDA >= 12.8 and TensorRT 10.13; this box's
Windows toolkit is 12.4, so it is built on Linux in an image (th/rig/a2f_sdk/Dockerfile, CUDA 12.9
devel + TensorRT 10.13 from the CUDA apt repo, nvidia runtime). No emotion model: Audio2Emotion is
gated on Hugging Face, so the emotion input is the neutral vector (the SDK samples' default)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from ..ffmpeg import run_ffmpeg
from ..paths import TOOL_DIR
from ..schema import Weight
from .base import Arm, ArmEnv, ArmNotBuilt, FrameCallback, Job, RawResult, write_licences

ARM = "a2f-keys"
IMAGE = "th-a2f-sdk:1ca0f02"
SDK_REV = "1ca0f02535ed774f5dbcd724a31cd486368dc783"
MODEL_REPO = "nvidia/Audio2Face-3D-v2.3-Mark"
MODEL_DIR = "audio2face-3d-v2.3-mark"
DOCKER_DIR = TOOL_DIR / "th" / "rig" / "a2f_sdk"
LICENCE_URL = "https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/"
# trt_info.json of the model: dynamic batch 1..128 (opt 8) of 8320 samples + a 26-wide emotion.
TRT_SHAPES = ["--minShapes=input:1x1x8320,emotion:1x1x26",
              "--optShapes=input:8x1x8320,emotion:8x1x26",
              "--maxShapes=input:128x1x8320,emotion:128x1x26"]


def _env() -> ArmEnv:
    return ArmEnv(ARM)


def _gen(env: ArmEnv) -> Path:
    """The SDK-ready model folder: the model's json/npz + network.trt built by the image's trtexec."""
    return env.models / "gen" / "mark"


def _docker() -> str:
    found = shutil.which("docker")
    if not found:
        raise ArmNotBuilt(f"{ARM}: docker is not on PATH")
    return found


def _image_exists() -> bool:
    import subprocess

    return subprocess.run([_docker(), "image", "inspect", IMAGE], capture_output=True).returncode == 0


class A2FArm(Arm):
    id = ARM
    runtimes = ("docker",)

    def fetch(self) -> list[Weight]:
        from huggingface_hub import HfApi, snapshot_download

        from ..gpu import gpu_lock
        from ..rig.capture import build_packs

        env = _env()
        sha = HfApi().model_info(MODEL_REPO).sha
        src = env.models / MODEL_DIR
        snapshot_download(MODEL_REPO, revision=sha, local_dir=str(src))
        if not _image_exists():
            env.run([_docker(), "build", "-t", IMAGE, str(DOCKER_DIR)], cwd=DOCKER_DIR)
        gen = _gen(env)
        gen.mkdir(parents=True, exist_ok=True)
        for f in src.iterdir():
            if f.suffix in (".json", ".npz"):
                shutil.copy2(f, gen / f.name)
        if not (gen / "network.trt").is_file():
            with gpu_lock():  # trtexec builds the engine on the GPU (~2-3 min)
                env.docker_run(IMAGE, ["trtexec", "--onnx=/src/network.onnx", "--saveEngine=/gen/network.trt",
                                       "--memPoolSize=tacticSharedMem:0.046875", *TRT_SHAPES],
                               {src: "/src", gen: "/gen"})
        build_packs()
        rows = [
            Weight(name=MODEL_REPO, licence="NVIDIA Open Model License", url=LICENCE_URL, revision=sha),
            Weight(name="NVIDIA/Audio2Face-3D-SDK", licence="MIT",
                   url="https://github.com/NVIDIA/Audio2Face-3D-SDK", revision=SDK_REV),
        ]
        write_licences(env.models, rows)
        return rows

    def preflight(self, runtime: str) -> None:
        if runtime != "docker":
            raise ArmNotBuilt(f"{ARM} runs in docker only (the SDK needs CUDA >= 12.8 + TensorRT 10.13): "
                              f"th render --arm {ARM} --runtime docker")
        from ..rig.capture import check_ready

        check_ready()
        if not (_gen(_env()) / "network.trt").is_file() or not _image_exists():
            raise ArmNotBuilt(f"{ARM}: not set up; run `th fetch {ARM}`")

    def render_docker(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        from ..rig import a2f_map
        from ..rig.capture import capture

        env = _env()
        wav16 = job.run_dir / "a2f-16k.wav"
        run_ffmpeg(["-i", str(job.audio), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav16)], log=job.log)
        env.docker_run(IMAGE, ["th-a2f-blendshapes", "/model/model.json", "/run/a2f-16k.wav",
                               "/run/a2f-weights.csv", "30"],
                       {_gen(env): "/model", job.run_dir: "/run"}, log=job.log)
        weights = a2f_map.read_weights(job.run_dir / "a2f-weights.csv")
        frames = int(round(job.audio_s * a2f_map.FPS))
        timeline = a2f_map.to_timeline(weights, frames)
        tl_path = timeline.write(job.run_dir / "timeline.json")
        (job.run_dir / "a2f-summary.json").write_text(json.dumps({
            "poses": sorted(weights), "a2fFrames": min((len(v) for v in weights.values()), default=0),
            "timelineFrames": frames, "summary": a2f_map.summary(timeline)}, indent=2) + "\n",
            encoding="utf-8", newline="\n")
        capture(job.raw, log=job.log, timeline=tl_path, audio=job.audio, seed=job.seed,
                keep=(0, 75, 150), keep_dir=job.run_dir / "frames")
        return RawResult(video=job.raw, notes=(
            f"a2f-keys: Audio2Face-3D Mark v2.3 (neutral emotion) -> th-timeline/1 -> product player; "
            f"{a2f_map.summary(timeline)}; no frame callback (ttffMs n/a)"))
