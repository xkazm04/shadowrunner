"""ffmpeg / ffprobe over subprocess: run, probe, and raw frame pipes in and out."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Iterator, Sequence

import numpy as np


def run_ffmpeg(args: Sequence[str], log: Path | None = None) -> None:
    argv = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *args]
    proc = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if log:
        with open(log, "a", encoding="utf-8") as fh:
            fh.write("$ " + " ".join(argv) + "\n" + proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {proc.stderr.strip()[-800:]}")


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def duration_s(path: Path) -> float:
    return float(probe(path)["format"]["duration"])


def video_stream(info: dict) -> dict:
    return next(s for s in info["streams"] if s["codec_type"] == "video")


def has_audio(info: dict) -> bool:
    return any(s["codec_type"] == "audio" for s in info["streams"])


def fps_of(stream: dict) -> float:
    num, den = stream["r_frame_rate"].split("/")
    return float(num) / float(den)


def read_frames(path: Path, size: tuple[int, int], fps: float | None = None,
                pix_fmt: str = "rgb24", decoder: str | None = None,
                max_frames: int | None = None) -> Iterator[np.ndarray]:
    """Decode `path` to raw frames scaled to `size` (w, h); optional resample to `fps`.
    `decoder` forces a video decoder (e.g. libvpx-vp9, the one that keeps VP9 alpha)."""
    w, h = size
    ch = {"rgb24": 3, "rgba": 4, "gray": 1}[pix_fmt]
    vf = [f"scale={w}:{h}:flags=bicubic"]
    if fps:
        vf.insert(0, f"fps={fps}")
    argv = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
    if decoder:
        argv += ["-c:v", decoder]
    argv += ["-i", str(path), "-vf", ",".join(vf), "-f", "rawvideo", "-pix_fmt", pix_fmt]
    if max_frames:
        argv += ["-frames:v", str(max_frames)]
    argv += ["-"]
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdout is not None
    n = w * h * ch
    try:
        while True:
            buf = proc.stdout.read(n)
            if len(buf) < n:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, ch)
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


class FrameWriter:
    """Raw frames in on stdin, an encoded file out. Context manager; `write(frame)` per frame."""

    def __init__(self, out: Path, size: tuple[int, int], fps: float, in_fmt: str,
                 codec_args: Sequence[str], extra_inputs: Sequence[str] = (),
                 log: Path | None = None) -> None:
        w, h = size
        self.argv = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-f", "rawvideo", "-pix_fmt", in_fmt, "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
            *extra_inputs, *codec_args, str(out),
        ]
        self.log = log
        self.proc: subprocess.Popen | None = None

    def __enter__(self) -> "FrameWriter":
        self.proc = subprocess.Popen(self.argv, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        return self

    def write(self, frame: np.ndarray) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write(np.ascontiguousarray(frame).tobytes())

    def __exit__(self, exc_type, *rest) -> None:
        assert self.proc and self.proc.stdin and self.proc.stderr
        self.proc.stdin.close()
        err = self.proc.stderr.read().decode("utf-8", "replace")
        code = self.proc.wait()
        if self.log:
            with open(self.log, "a", encoding="utf-8") as fh:
                fh.write("$ " + " ".join(self.argv) + "\n" + err)
        if code != 0 and exc_type is None:
            print(err, file=sys.stderr)
            raise RuntimeError(f"ffmpeg encode failed ({code})")
