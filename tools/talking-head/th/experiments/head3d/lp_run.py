"""Re-render a FlashHead live-bench run through LivePortrait with a rotation track (FlashHead env).

    python -m th.experiments.head3d.lp_run --run <live-bench run dir> --track none|stats|<npz>
        [--source bust|frame] --out <dir>

Streams the run's raw.mp4 in 24-frame chunks (one live chunk), under the GPU lock, and writes
<out>/raw.mp4 (512, with the run's speech.wav), <out>/track.npz (the added rotation, the track file
contract), <out>/pose.npz (LivePortrait's yaw/pitch/roll estimate on the FlashHead input and on the
output, per frame) and <out>/render.json (per-chunk ms, LivePortrait-alone fps).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

import numpy as np

from ...ffmpeg import read_frames
from ...gpu import gpu_lock
from ...paths import th_home
from . import track_stats as ts

CHUNK = 24


def load_audio16k(wav: Path) -> np.ndarray:
    import soundfile as sf
    from scipy.signal import resample_poly

    w, sr = sf.read(str(wav), dtype="float32", always_2d=True)
    w = w.mean(1)
    return w if sr == 16000 else resample_poly(w, 16000, sr).astype(np.float32)


def source_landmarks(rgb: np.ndarray) -> np.ndarray:
    from ..transplant.landmarks import Landmarks

    with Landmarks() as lm:
        pts = lm(rgb)
    if pts is None:
        raise SystemExit("head3d: no face in the source")
    return pts


def bust512() -> np.ndarray:
    from PIL import Image

    img = Image.open(th_home() / "live" / "iris-bust.png").convert("RGB").resize((512, 512), Image.BICUBIC)
    return np.asarray(img)


def get_track(spec: str, audio: np.ndarray, n: int, seed: int, scale: float,
              yaw_scale: float = 1.0) -> np.ndarray:
    tr = _track(spec, audio, n, seed, scale)
    tr[:, 0] *= yaw_scale
    return tr


def _track(spec: str, audio: np.ndarray, n: int, seed: int, scale: float) -> np.ndarray:
    if spec == "none":
        return np.zeros((n, 3), np.float32)
    if spec == "stats":
        return ts.track_for(audio, n, seed=seed, scale=scale)
    tr = ts.load_npz(spec)
    if len(tr) < n:  # hold the last value
        tr = np.concatenate([tr, np.repeat(tr[-1:], n - len(tr), 0)])
    return tr[:n] * scale


def _writer(path: Path, wav: Path, size: int) -> subprocess.Popen:
    argv = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{size}x{size}", "-r", "25", "-i", "-", "-i", str(wav), "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-crf", "12", "-preset", "fast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-shortest", str(path)]
    return subprocess.Popen(argv, stdin=subprocess.PIPE)


def run(run_dir: Path, track: str, source: str, out: Path, seed: int = 1117, scale: float = 1.0,
        stitching: bool = True, yaw_scale: float = 1.0, stride: int = 1, crop_scale: float = 2.3,
        detail: float = 0.0) -> dict:
    import torch

    from .lp_bridge import LPRenderer

    out.mkdir(parents=True, exist_ok=True)
    wav = run_dir / "speech.wav"
    frames = np.stack(list(read_frames(run_dir / "raw.mp4", (512, 512))))
    n = len(frames)
    audio = load_audio16k(wav)
    tr = get_track(track, audio, n, seed, scale, yaw_scale)
    ts.save_npz(out / "track.npz", tr, str(wav))
    src = bust512()
    chunk_ms, pose_in, pose_out = [], [], []
    with gpu_lock():
        t0 = time.perf_counter()
        r = LPRenderer(src, source_landmarks(src), source=source, stitching=stitching,
                       stride=stride, crop_scale=crop_scale,
                       detail=detail)
        load_s = time.perf_counter() - t0
        r.render(torch.from_numpy(frames[:CHUNK]).cuda(), tr[:CHUNK])  # warm-up
        proc = _writer(out / "raw.mp4", wav, 512)
        for i in range(0, n, CHUNK):
            x = torch.from_numpy(frames[i:i + CHUNK]).cuda()
            torch.cuda.synchronize()
            t = time.perf_counter()
            y, info = r.render(x, tr[i:i + CHUNK], return_info=True)
            torch.cuda.synchronize()
            chunk_ms.append((time.perf_counter() - t) * 1000)
            pose_in.append(np.stack([info["yaw"], info["pitch"], info["roll"]], 1))
            pose_out.append(r.pose(y))
            proc.stdin.write(y.cpu().numpy().tobytes())
        proc.stdin.close()
        proc.wait()
        vram = torch.cuda.max_memory_allocated() / 2**20
    pin, pout = np.concatenate(pose_in), np.concatenate(pose_out)
    np.savez(out / "pose.npz", fh=pin, out=pout, track=tr)
    per_frame = np.array(chunk_ms) / np.array([min(CHUNK, n - i) for i in range(0, n, CHUNK)])
    rep = {
        "run": str(run_dir), "track": track, "source": source, "stitching": stitching, "seed": seed,
        "yawScale": yaw_scale, "stride": stride, "cropScale": crop_scale, "detail": detail,
        "scale": scale, "frames": n, "loadS": round(load_s, 2), "vramPeakMiB": round(vram),
        "chunkMs": {"p50": round(float(np.percentile(chunk_ms, 50)), 1),
                    "p95": round(float(np.percentile(chunk_ms, 95)), 1), "max": round(max(chunk_ms), 1)},
        "lpFps": round(float(1000 / np.median(per_frame)), 1),
        "trackStats": ts.stats(tr),
        "achieved": {"added": ts.stats(pout - pin), "fh": ts.stats(pin), "out": ts.stats(pout)},
    }
    (out / "render.json").write_text(json.dumps(rep, indent=2) + "\n", encoding="utf-8", newline="\n")
    return rep


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=Path, required=True)
    ap.add_argument("--track", default="stats")
    ap.add_argument("--source", choices=("bust", "frame"), default="bust")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=1117)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--no-stitching", action="store_true")
    ap.add_argument("--yaw-scale", type=float, default=1.0)
    ap.add_argument("--stride", type=int, default=1, help="frame source: features every Nth frame")
    ap.add_argument("--detail", type=float, default=0.0, help="detail transfer gain (experiment; 0 = off)")
    ap.add_argument("--crop-scale", type=float, default=2.3, help="crop side / landmark extent (upstream 2.3)")
    a = ap.parse_args()
    rep = run(a.run, a.track, a.source, a.out, a.seed, a.scale, not a.no_stitching, a.yaw_scale, a.stride,
              a.crop_scale, a.detail)
    print(json.dumps({k: rep[k] for k in ("chunkMs", "lpFps", "vramPeakMiB")}))
    print(json.dumps(rep["achieved"]["added"]))


if __name__ == "__main__":
    main()
