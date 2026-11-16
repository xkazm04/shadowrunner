"""Shared fixtures and skip markers. Heavy tests need fetched models (`th fetch metrics`), the
Kokoro files and a CUDA GPU; they skip with the reason when any is missing."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


def _cuda() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except Exception:
        return False


def _models() -> bool:
    from th.fetch import METRIC_MODELS, model_ready

    return all(model_ready(m) for m in METRIC_MODELS)


def _kokoro() -> bool:
    from th.audio import MODEL_FILE, VOICES_FILE
    from th.paths import kokoro_dir

    return (kokoro_dir() / MODEL_FILE).is_file() and (kokoro_dir() / VOICES_FILE).is_file()


HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe not on PATH")
needs_gpu_stack = pytest.mark.skipif(
    not (HAS_FFMPEG and _cuda() and _models() and _kokoro()),
    reason="needs ffmpeg, CUDA, `th fetch metrics` and the Kokoro files",
)


def make_clip(path: Path, seconds: float = 2.0, size: int = 320, freq: int = 440) -> Path:
    """A synthetic test clip: testsrc picture plus a sine tone."""
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc=size={size}x{size}:rate=30:duration={seconds}",
        "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True)
    return path
