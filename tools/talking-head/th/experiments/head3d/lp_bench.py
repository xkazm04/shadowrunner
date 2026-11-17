"""Combined speed: FlashHead Lite + the statistical track + LivePortrait + Maxine, chunk by chunk, as the
live engine's GPU thread would run them (FlashHead env, under the GPU lock; the live engine itself is
not touched).

    python -m th.experiments.head3d.lp_bench --wav <speech.wav> [--chunks 50] [--source frame]
        [--stride 1] [--upscale maxine|none] [--out <json>] [--save <raw.mp4>]

Each 0.96 s slice of the audio goes through FlashHead (24 frames), then the track for those frames,
then LivePortrait (rotation added), then the upscaler, each stage timed with a CUDA sync. A chunk
whose compute exceeds its 960 ms budget is counted `over`: back-to-back with no pipelining, that is
what would make the live stream fall behind (the engine computes up to 2 chunks ahead, so a single
over-budget chunk is absorbed; a sustained rate under 25 fps is not).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

import numpy as np

from ...gpu import gpu_lock
from ...paths import th_home
from . import track_stats as ts

SLICE = 15360  # 0.96 s at 16 kHz
FRAMES = 24


def pct(x: list[float]) -> dict:
    return {"p50": round(float(np.percentile(x, 50)), 1), "p95": round(float(np.percentile(x, 95)), 1),
            "max": round(float(max(x)), 1)}


def main() -> None:
    import torch

    from ...live.models import FlashHeadModel
    from ...live.upscale import get_upscaler
    from .lp_bridge import LPRenderer
    from .lp_run import bust512, load_audio16k, source_landmarks

    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", type=Path, required=True)
    ap.add_argument("--chunks", type=int, default=50)
    ap.add_argument("--source", choices=("bust", "frame"), default="frame")
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--upscale", default="maxine")
    ap.add_argument("--no-lp", action="store_true", help="FlashHead + upscaler only (the baseline)")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--save", type=Path, default=None, help="write the 512 frames (before upscaling)")
    a = ap.parse_args()

    audio = load_audio16k(a.wav)
    n = min(a.chunks, len(audio) // SLICE)
    bust = th_home() / "live" / "iris-bust.png"
    stats: dict[str, list[float]] = {"fh": [], "track": [], "lp": [], "up": [], "total": []}
    writer = None
    if a.save:
        writer = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo",
                                   "-pix_fmt", "rgb24", "-s", "512x512", "-r", "25", "-i", "-", "-c:v", "libx264",
                                   "-crf", "12", "-pix_fmt", "yuv420p", str(a.save)], stdin=subprocess.PIPE)
    with gpu_lock():
        t0 = time.perf_counter()
        model = FlashHeadModel(bust)
        model.load()
        up = get_upscaler(a.upscale)
        up.warmup()
        src = bust512()
        lp = None if a.no_lp else LPRenderer(src, source_landmarks(src), source=a.source, stride=a.stride)
        load_s = time.perf_counter() - t0
        track = ts.StatTrack()
        if lp is not None:  # warm-up on a dummy chunk
            lp.render(torch.zeros((FRAMES, 512, 512, 3), dtype=torch.uint8, device="cuda"),
                      np.zeros((FRAMES, 3), np.float32))
        torch.cuda.reset_peak_memory_stats()
        for k in range(n):
            sl = audio[k * SLICE:(k + 1) * SLICE]
            torch.cuda.synchronize()
            t = [time.perf_counter()]
            frames = model.chunk(sl)
            torch.cuda.synchronize()
            t.append(time.perf_counter())
            ang = track.feed(sl)
            t.append(time.perf_counter())
            if lp is not None:
                frames = lp.render(frames, ang)
                torch.cuda.synchronize()
            t.append(time.perf_counter())
            if writer is not None:
                writer.stdin.write(frames.cpu().numpy().tobytes())
            t.append(time.perf_counter())
            big = up(frames)
            torch.cuda.synchronize()
            t.append(time.perf_counter())
            del big
            for key, (i, j) in {"fh": (0, 1), "track": (1, 2), "lp": (2, 3), "up": (4, 5)}.items():
                stats[key].append((t[j] - t[i]) * 1000)
            stats["total"].append(stats["fh"][-1] + stats["track"][-1] + stats["lp"][-1] + stats["up"][-1])
        vram = torch.cuda.max_memory_allocated() / 2**20
    if writer is not None:
        writer.stdin.close()
        writer.wait()
    tot = stats["total"][1:]  # the first chunk carries one-off allocations
    rep = {
        "wav": str(a.wav), "chunks": n, "source": a.source, "stride": a.stride, "upscale": a.upscale,
        "lp": not a.no_lp, "loadS": round(load_s, 1), "vramPeakMiB": round(vram),
        **{f"{k}Ms": pct(v[1:]) for k, v in stats.items() if any(v)},
        "capacityFps": {"p50": round(FRAMES / (np.percentile(tot, 50) / 1000), 1),
                        "p95": round(FRAMES / (np.percentile(tot, 95) / 1000), 1)},
        "overBudget": int(sum(x > 960 for x in tot)),
        "gpuUtilNote": subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
                                       "--format=csv,noheader"], capture_output=True, text=True).stdout.strip(),
    }
    print(json.dumps(rep))
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(rep, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
