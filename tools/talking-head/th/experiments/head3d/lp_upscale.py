"""Upscale head3d clips the way the live stream does (Maxine VSR, 512 -> 1024) for review (FlashHead env).

    python -m th.experiments.head3d.lp_upscale <clip dir>... [--kind maxine]

Reads <dir>/raw.mp4 in 24-frame chunks under the GPU lock and writes <dir>/up.mp4 with the clip's audio.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import numpy as np

from ...ffmpeg import read_frames
from ...gpu import gpu_lock


def upscale(d: Path, kind: str = "maxine") -> Path:
    import torch

    from ...live.upscale import get_upscaler

    out = d / "up.mp4"
    up = get_upscaler(kind)
    with gpu_lock():
        up.warmup()
        proc = None
        buf: list[np.ndarray] = []

        def flush() -> None:
            nonlocal proc
            y = up(torch.from_numpy(np.stack(buf)).cuda()).cpu().numpy()
            if proc is None:
                h, w = y.shape[1:3]
                proc = subprocess.Popen(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                     "-s", f"{w}x{h}", "-r", "25", "-i", "-", "-i", str(d / "raw.mp4"), "-map", "0:v",
                     "-map", "1:a?", "-c:v", "libx264", "-crf", "14", "-preset", "fast", "-pix_fmt", "yuv420p",
                     "-c:a", "copy", "-shortest", str(out)], stdin=subprocess.PIPE)
            proc.stdin.write(y.tobytes())
            buf.clear()

        for f in read_frames(d / "raw.mp4", (512, 512)):
            buf.append(f)
            if len(buf) == 24:
                flush()
        if buf:
            flush()
        proc.stdin.close()
        proc.wait()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+", type=Path)
    ap.add_argument("--kind", default="maxine")
    a = ap.parse_args()
    for d in a.dirs:
        print(upscale(d, a.kind))


if __name__ == "__main__":
    main()
