"""Frame generators behind the live engine: FlashHead Lite (FlashHead env, CUDA) and a fake one for
tests and `--fake` (numpy only). Each turns one 0.96 s slice of 16 kHz audio into 24 frames.

FlashHead is driven exactly as the offline driver (th/arms/flashhead.py DRIVER) drives it: an 8 s
rolling audio window, the embedding of its last `frame_num` frames, `run_pipeline` -> 33 frames of
which the first `motion_frames_num` (9) are the motion context and the last 24 are new. The motion
frames re-decode the previous chunk's last 9 instants; `motion_frames` keeps them for the seam blend
(th/live/compose.py).
"""

from __future__ import annotations

import contextlib
import io
import os
import sys
import time
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from ..paths import portrait_path, th_home

SLICE_FRAMES = 24
CHUNK_MS = SLICE_FRAMES * 40.0
RATE = 16000
SLICE_SAMPLES = RATE * SLICE_FRAMES // 25  # 15360
BUST_BOX = (192, 140, 832, 780)  # Iris portrait (1024): head and shoulders; identity 0.976 vs 0.901
FH_REPO = "realtime-fh"
FH_CKPT = "SoulX-FlashHead-1_3B"
FH_WAV2VEC = "wav2vec2-base-960h"


class Model(Protocol):
    size: int
    name: str

    def load(self) -> None: ...

    def chunk(self, audio16k: np.ndarray) -> Any:
        """(SLICE_SAMPLES,) float32 -> (24, size, size, 3) uint8: a CUDA tensor or a numpy array.
        A model may also set `motion_frames`: its regenerated frames of the previous chunk's last
        instants (oldest first), or None."""


def bust_crop(portrait: Path | None = None, out: Path | None = None) -> Path:
    """Iris's bust crop, written once to $TH_HOME/live/iris-bust.png (rewritten if the source is newer)."""
    from PIL import Image

    src = portrait or portrait_path()
    dst = out or th_home() / "live" / "iris-bust.png"
    if not dst.is_file() or dst.stat().st_mtime < src.stat().st_mtime:
        dst.parent.mkdir(parents=True, exist_ok=True)
        Image.open(src).convert("RGB").crop(BUST_BOX).save(dst)
    return dst


class FlashHeadModel:
    name = "lite"
    size = 512

    def __init__(self, portrait: Path, seed: int = 1116, model_type: str = "lite") -> None:
        self.portrait = portrait
        self.seed = seed
        self.name = model_type
        self.repo = th_home() / "repos" / FH_REPO
        self.models = th_home() / "models" / FH_REPO
        self.pipe = None
        self.load_s: float | None = None
        self.motion_frames = None

    def load(self) -> None:
        t0 = time.perf_counter()
        # upstream reads flash_head/configs/infer_params.yaml relative to the working directory
        os.chdir(self.repo)
        if str(self.repo) not in sys.path:
            sys.path.insert(0, str(self.repo))
        import torch  # noqa: F401
        import flash_head.src.pipeline.flash_head_pipeline as fhp

        fhp.COMPILE_MODEL = fhp.COMPILE_VAE = os.environ.get("TH_FH_COMPILE") == "1"
        from flash_head.inference import (get_audio_embedding, get_base_data, get_infer_params,
                                          get_pipeline, run_pipeline)

        self._emb, self._run = get_audio_embedding, run_pipeline
        with _quiet():
            self.pipe = get_pipeline(world_size=1, ckpt_dir=str(self.models / FH_CKPT),
                                     wav2vec_dir=str(self.models / FH_WAV2VEC), model_type=self.name)
            # upstream keys the reference by the path's last '/' component: pass a posix path
            get_base_data(self.pipe, cond_image_path_or_dir=self.portrait.resolve().as_posix(),
                          base_seed=self.seed, use_face_crop=False)
        p = get_infer_params()
        self.motion = p["motion_frames_num"]
        assert p["frame_num"] - self.motion == SLICE_FRAMES and p["sample_rate"] == RATE, p
        self.cached = RATE * p["cached_audio_duration"]
        self.end_idx = p["cached_audio_duration"] * p["tgt_fps"]
        self.start_idx = self.end_idx - p["frame_num"]
        self.window = np.zeros(self.cached, np.float32)
        self.chunk(np.zeros(SLICE_SAMPLES, np.float32))  # warm-up, then rewind the motion state
        self.pipe.reset_person_name()
        self.window[:] = 0
        self.load_s = time.perf_counter() - t0

    def chunk(self, audio16k: np.ndarray) -> Any:
        import torch

        n = len(audio16k)
        self.window = np.concatenate([self.window[n:], audio16k.astype(np.float32)])
        with _quiet(), torch.inference_mode():
            emb = self._emb(self.pipe, self.window.astype(np.float64), self.start_idx, self.end_idx)
            video = self._run(self.pipe, emb).to(torch.uint8)
        self.motion_frames = video[:self.motion]
        return video[self.motion:]


class FakeModel:
    """Synthetic frames: a grey face plate whose 'mouth' brightness follows the RMS of the audio
    under each frame, so tests can check sync through the wire. `compute_s` emulates GPU time."""

    name = "fake"

    def __init__(self, size: int = 64, compute_s: float = 0.05) -> None:
        self.size = size
        self.compute_s = compute_s
        self.frames = 0
        self.motion_frames: np.ndarray | None = None  # like FlashHead: the last chunk's last 9
        self._last: np.ndarray | None = None

    def load(self) -> None:
        return None

    def chunk(self, audio16k: np.ndarray) -> np.ndarray:
        time.sleep(self.compute_s)
        per = len(audio16k) // SLICE_FRAMES
        out = np.full((SLICE_FRAMES, self.size, self.size, 3), 80, np.uint8)
        s = self.size
        for i in range(SLICE_FRAMES):
            rms = float(np.sqrt(np.mean(audio16k[i * per:(i + 1) * per] ** 2)))
            out[i, s // 2:3 * s // 4, s // 4:3 * s // 4] = min(255, int(rms * 1200))
            out[i, :2, : (self.frames + i) % s] = 255  # a moving tick: frames are never identical
        self.frames += SLICE_FRAMES
        self.motion_frames, self._last = self._last, out[-9:].copy()
        return out


@contextlib.contextmanager
def _quiet():
    """Upstream prints per denoise step; keep them off our stdout."""
    with contextlib.redirect_stdout(io.StringIO()):
        yield
