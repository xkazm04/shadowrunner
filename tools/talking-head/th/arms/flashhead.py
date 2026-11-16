"""`realtime-fh` (WP2): SoulX-FlashHead Lite (Soul-AILab, Apache-2.0 code), streaming, 512x512 at 25 fps.

Licences per the model card's "Component Licenses" (the card itself is tagged `other`): the DiT
weights (Model_Lite, Model_Pro) and VAE_Wan are Apache-2.0; VAE_LTX (the LTX-Video 0.9 VAE, used by
Lite) is OpenRAIL-M, accepted by the owner (Director ruling 2026-11-16) with its use restrictions
recorded in licence.json. Pro (Model_Pro + VAE_Wan, Apache-2.0 end to end) is fetched too, as the
all-Apache fallback and a quality comparison (TH_FH_MODEL=pro).

The repo's streaming mode (`--audio_encode_mode stream`: 8 s rolling audio window, one chunk per
slice of new audio: Lite 24 frames / 0.96 s, Pro 28 frames / 1.12 s) runs in a small driver
(`DRIVER`, written into the clone as th_stream.py) in the arm's venv, which writes every chunk's frames
to stdout as soon as they exist; this process hands each frame to `on_frame` and to the raw.mp4
encoder. The driver measures, on its own clock: model ready, warm-up, audio-in -> first frame
(TTFF), and per-chunk compute; those land in the run notes (`th render`'s `ttffMs` counts from the
arm call, so it includes the model load).

Knobs: TH_FH_MODEL (lite, default | pro), TH_FH_COMPILE=1 (the repo's torch.compile; needs a working
Triton, which native Windows lacks).
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import threading
from pathlib import Path
from typing import Iterator

import numpy as np

from ..ffmpeg import FrameWriter
from ..schema import Weight
from .base import Arm, ArmEnv, ArmNotBuilt, FrameCallback, Job, RawResult
from .infinitetalk import HfPart, fetch_parts, require_parts

REPO_URL = "https://github.com/Soul-AILab/SoulX-FlashHead.git"
REPO_REV = "9bc03de06bb0de82cd6bc477804512ae06144bf2"
FPS = 25
# the files each variant reads, under models/realtime-fh/SoulX-FlashHead-1_3B
MODELS = {"lite": ("Model_Lite/diffusion_pytorch_model.safetensors",
                   "VAE_LTX/diffusion_pytorch_model.safetensors"),
          "pro": ("Model_Pro/diffusion_pytorch_model.safetensors", "VAE_Wan/Wan2.1_VAE.pth")}
OPENRAIL_NOTE = ("OpenRAIL-M (VAE_LTX = LTX-Video 0.9 VAE, per the card's Component Licenses; "
                 "use restrictions of the OpenRAIL-M Attachment A apply to it and to outputs' use; "
                 "keep OpenRAIL-M on redistribution, never relicense as Apache-2.0)")

FH = ("Soul-AILab/SoulX-FlashHead-1_3B", "5fbd2e44ba08ab2deb28bd55cff2c15523e51ba5")
PARTS = (
    HfPart("SoulX-FlashHead-1_3B", *FH,
           "Apache-2.0 (DiT weights + VAE_Wan, per the card's Component Licenses; card tag 'other')",
           ("Model_Lite/*", "Model_Pro/*", "VAE_Wan/*", "config.json", "model_index.json", "README.md")),
    HfPart("SoulX-FlashHead-1_3B", *FH, OPENRAIL_NOTE, ("VAE_LTX/*",)),
    HfPart("wav2vec2-base-960h", "facebook/wav2vec2-base-960h",
           "22aad52d435eb6dbaf354bdad9b0da84ce7d6156", "Apache-2.0",
           ("*.json", "model.safetensors"), ("model.safetensors", "preprocessor_config.json")),
)

TORCH = ("torch==2.6.0+cu124", "torchvision==0.21.0+cu124")
TORCH_INDEX = "https://download.pytorch.org/whl/cu124"
# requirements.txt minus gradio/flask (UI), nccl (Linux, multi-GPU) and xformers (not imported), with
# numpy<2 + opencv<4.12 because mediapipe 0.10.9 (imported by the face-crop module) is built on numpy 1;
# xfuser 0.4.3 (the floor upstream names) because 0.8 registers ops torch 2.6 cannot parse;
# flash-attn / sageattention are optional upstream (SDPA fallback)
DEPS = ("opencv-python>=4.9,<4.12", "diffusers>=0.34.0", "transformers==4.57.3", "tokenizers>=0.20.3",
        "accelerate>=1.8.1", "tqdm", "imageio", "easydict", "ftfy", "imageio-ffmpeg", "scikit-image",
        "loguru", "xfuser==0.4.3", "pyloudnorm", "librosa", "mediapipe==0.10.9", "einops", "pyyaml",
        "safetensors", "numpy<2")

DRIVER = r'''"""th_stream.py: written by tools/talking-head (realtime-fh); SoulX-FlashHead's streaming
loop from generate_video.py, emitting each chunk's frames on stdout as soon as they exist."""
import json, os, struct, sys, time
# the frame stream gets a private copy of fd 1; fd 1 itself (and sys.stdout) now point at stderr, so
# nothing upstream prints, at import or later, Python or native, can land between frames
out = os.fdopen(os.dup(1), "wb")
os.dup2(2, 1)
sys.stdout = sys.stderr
from collections import deque
import numpy as np
import librosa
import torch
import flash_head.src.pipeline.flash_head_pipeline as fhp
fhp.COMPILE_MODEL = fhp.COMPILE_VAE = os.environ.get("TH_FH_COMPILE") == "1"
from flash_head.inference import get_pipeline, get_base_data, get_infer_params, get_audio_embedding, run_pipeline

ckpt, wav2vec, model_type, image, audio, seed = sys.argv[1:7]
t_start = time.perf_counter()
pipe = get_pipeline(world_size=1, ckpt_dir=ckpt, wav2vec_dir=wav2vec, model_type=model_type)
get_base_data(pipe, cond_image_path_or_dir=image, base_seed=int(seed), use_face_crop=False)
p = get_infer_params()
sr, fps, frame_num, motion = p["sample_rate"], p["tgt_fps"], p["frame_num"], p["motion_frames_num"]
slice_len = frame_num - motion
cached = sr * p["cached_audio_duration"]
end_idx = p["cached_audio_duration"] * fps
start_idx = end_idx - frame_num
t_ready = time.perf_counter()
# warm-up on silence (a live server does this once at start-up), then rewind the motion state
run_pipeline(pipe, get_audio_embedding(pipe, np.zeros(cached), start_idx, end_idx))
pipe.reset_person_name()
torch.cuda.synchronize()
t_warm = time.perf_counter()

speech, _ = librosa.load(audio, sr=sr, mono=True)
n = slice_len * sr // fps
if len(speech) % n:
    speech = np.concatenate([speech, np.zeros(n - len(speech) % n, dtype=speech.dtype)])
dq = deque([0.0] * cached, maxlen=cached)
chunks, first, frames = [], None, 0
t_audio_in = time.perf_counter()
for piece in speech.reshape(-1, n):
    t0 = time.perf_counter()
    dq.extend(piece.tolist())
    emb = get_audio_embedding(pipe, np.array(dq), start_idx, end_idx)
    video = run_pipeline(pipe, emb)[motion:]
    arr = video.to(torch.uint8).cpu().numpy()
    t1 = time.perf_counter()
    if first is None:
        first = t1
    out.write(struct.pack("<III", *arr.shape[:3]))
    out.write(np.ascontiguousarray(arr).tobytes())
    out.flush()
    frames += arr.shape[0]
    chunks.append(round(t1 - t0, 4))
t_end = time.perf_counter()
gen = t_end - t_audio_in
stats = {"modelLoadS": round(t_ready - t_start, 2), "warmupS": round(t_warm - t_ready, 2),
         "ttffMs": round((first - t_audio_in) * 1000, 1), "bufferMs": round(slice_len / fps * 1000, 1),
         "frames": frames, "genS": round(gen, 3), "fps": round(frames / gen, 2), "chunkS": chunks,
         "chunkBudgetS": slice_len / fps, "slowChunks": sum(c > slice_len / fps for c in chunks),
         "targetFps": fps, "compile": fhp.COMPILE_MODEL, "model": model_type}
print("TH_STATS " + json.dumps(stats), file=sys.stderr, flush=True)
'''


class FlashHeadArm(Arm):
    id = "realtime-fh"

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
        variant = HfPart("SoulX-FlashHead-1_3B", *FH, "", None, MODELS[self.model_type()])
        require_parts(self.id, self.env, (*PARTS, variant))

    def model_type(self) -> str:
        m = os.environ.get("TH_FH_MODEL", "lite")
        if m not in MODELS:
            raise ArmNotBuilt(f"{self.id}: TH_FH_MODEL must be one of {tuple(MODELS)}")
        return m

    def command(self, job: Job) -> list[str]:
        m = self.env.models
        return [str(self.env.python), "th_stream.py",
                str(m / "SoulX-FlashHead-1_3B"), str(m / "wav2vec2-base-960h"), self.model_type(),
                job.portrait.resolve().as_posix(), job.audio.resolve().as_posix(), str(job.seed)]

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        (self.env.repo / "th_stream.py").write_text(DRIVER, encoding="utf-8", newline="\n")
        argv = self.command(job)
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
               "TH_FH_COMPILE": os.environ.get("TH_FH_COMPILE", "0")}
        with open(job.log, "a", encoding="utf-8") as fh:
            fh.write("$ " + " ".join(argv) + "\n")
        proc = subprocess.Popen(argv, cwd=self.env.repo, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE)
        lines: list[str] = []
        pump = threading.Thread(target=_pump, args=(proc.stderr, job.log, lines), daemon=True)
        pump.start()
        writer: FrameWriter | None = None
        frames = 0
        try:
            for chunk in read_chunks(proc.stdout):
                if writer is None:
                    h, w = chunk.shape[1:3]
                    writer = FrameWriter(job.raw, (w, h), FPS, "rgb24",
                                         ["-c:v", "libx264", "-preset", "fast", "-crf", "14",
                                          "-pix_fmt", "yuv420p"], log=job.log).__enter__()
                for frame in chunk:
                    if on_frame:
                        on_frame(frame)
                    writer.write(frame)
                    frames += 1
        except BaseException:
            proc.kill()  # never wait on a driver blocked writing into a pipe nobody reads
            raise
        finally:
            code = proc.wait()
            pump.join()
            if writer is not None:
                writer.__exit__(None, None, None)
        if code != 0 or frames == 0:
            raise RuntimeError(f"{self.id}: driver exited {code} after {frames} frames (see {job.log})")
        stats = parse_stats(lines)
        return RawResult(video=job.raw, weights=self.weights(), notes=stats_note(stats))


def read_chunks(stream) -> Iterator[np.ndarray]:
    """Frames chunk by chunk from the driver: '<III' (n, h, w) then n*h*w*3 RGB bytes."""
    while True:
        head = stream.read(12)
        if len(head) < 12:
            return
        n, h, w = struct.unpack("<III", head)
        buf = stream.read(n * h * w * 3)
        if len(buf) < n * h * w * 3:
            return
        yield np.frombuffer(buf, np.uint8).reshape(n, h, w, 3)


def _pump(stream, log: Path, lines: list[str]) -> None:
    with open(log, "a", encoding="utf-8") as fh:
        for raw in iter(stream.readline, b""):
            line = raw.decode("utf-8", "replace")
            lines.append(line)
            sys.stderr.write(line)
            fh.write(line)
            fh.flush()


def parse_stats(lines: list[str]) -> dict | None:
    for line in reversed(lines):
        if line.startswith("TH_STATS "):
            return json.loads(line[len("TH_STATS "):])
    return None


def stats_note(stats: dict | None) -> str:
    model = (stats or {}).get("model", "?")
    head = f"FlashHead {model}, streaming, 512x512@25"
    if not stats:
        return head + "; driver stats missing"
    kept = stats["fps"] >= stats["targetFps"] and stats["slowChunks"] == 0
    return (f"{head}; compile {'on' if stats['compile'] else 'off'}; audio-in TTFF "
            f"{stats['ttffMs']:.0f} ms (+{stats['bufferMs']:.0f} ms audio buffer per chunk); "
            f"sustained {stats['fps']:.2f} fps over {stats['frames']} frames "
            f"({'kept' if kept else 'did NOT keep'} real time at {stats['targetFps']} fps, "
            f"{stats['slowChunks']}/{len(stats['chunkS'])} chunks over the "
            f"{stats['chunkBudgetS']:.2f} s budget); model load {stats['modelLoadS']} s, "
            f"warm-up {stats['warmupS']} s")
