"""Measure a head3d clip (core env): SyncNet, identity, face and mouth sharpness, the head pose actually
shown, and how much of the picture outside the head changed against FlashHead alone.

    uv run python -m th.experiments.head3d.lp_measure <clip dir or run dir>... [--ref <FlashHead raw.mp4>]

Each dir holds raw.mp4 (512, 25 fps; `--name up.mp4 --size 1024` measures the Maxine copy) and either speech.wav beside it or a render.json naming the run.
Writes <dir>/video.mp4 (normalised as `th render`) and <dir>/measure.json:
- sync, identity: th.post.metrics on video.mp4 (as live-bench);
- sharpness: variance of the Laplacian on the face crop of video.mp4, 1 frame/s (as live-bench);
- mouthSharpness: variance of the Laplacian (grey, 512 px) on the lip box grown 30 %, per MediaPipe
  landmarks, every 2nd frame where the audio is voiced (level over -40 dBFS);
- pose: MediaPipe Face Landmarker's facial transformation matrix per frame (an estimator independent of
  LivePortrait's), yaw/pitch/roll SD, p95-p5 range and mean speed (deg/s);
- regions (with --ref): mean abs difference (0-255) against the FlashHead frames in the shoulder band
  (y >= 440 of 512), the backdrop corners (x < 40 or x >= 472, y < 300) and the head box.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from ...ffmpeg import duration_s, read_frames
from ...gpu import gpu_lock

FPS = 25
HOP = 16000 // FPS


def clip_wav(d: Path) -> Path:
    if (d / "speech.wav").is_file():
        return d / "speech.wav"
    return Path(json.loads((d / "render.json").read_text(encoding="utf-8"))["run"]) / "speech.wav"


def voiced_frames(wav: Path, n: int) -> np.ndarray:
    from .lp_run import load_audio16k

    a = load_audio16k(wav)
    lv = np.full(n, -99.0)
    for i in range(n):
        s = a[i * HOP:(i + 1) * HOP]
        if len(s):
            lv[i] = 20 * math.log10(math.sqrt(float(np.mean(s * s))) + 1e-9)
    return lv > -40


def euler(m: np.ndarray) -> tuple[float, float, float]:
    r = m[:3, :3]
    yaw = math.degrees(math.asin(max(-1.0, min(1.0, -r[2, 0]))))
    pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
    roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    return yaw, pitch, roll


def landmark_pass(raw: Path, voiced: np.ndarray, size: int = 512):
    """Per frame: pose (yaw, pitch, roll) and, on voiced even frames, the mouth sharpness."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    from scipy.ndimage import laplace

    from ...fetch import require

    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=1, output_facial_transformation_matrixes=True)
    lips = sorted({i for c in vision.FaceLandmarksConnections.FACE_LANDMARKS_LIPS for i in (c.start, c.end)})
    poses, sharp = [], []
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        for i, f in enumerate(read_frames(raw, (size, size))):
            res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f)),
                                      i * 1000 // FPS)
            if not res.face_landmarks:
                poses.append((np.nan, np.nan, np.nan))
                continue
            poses.append(euler(np.asarray(res.facial_transformation_matrixes[0])))
            if i % 2 == 0 and i < len(voiced) and voiced[i]:
                p = np.array([(res.face_landmarks[0][k].x * size, res.face_landmarks[0][k].y * size) for k in lips])
                (x0, y0), (x1, y1) = p.min(0), p.max(0)
                gx, gy = (x1 - x0) * 0.3, (y1 - y0) * 0.3
                c = f[int(max(0, y0 - gy)):int(y1 + gy), int(max(0, x0 - gx)):int(x1 + gx)]
                g = c.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
                sharp.append(float(laplace(g).var()))
    return np.array(poses, np.float64), sharp


def pose_stats(p: np.ndarray, mask: np.ndarray) -> dict:
    out = {}
    v = np.abs(np.diff(p, axis=0)) * FPS
    for i, k in enumerate(("yaw", "pitch", "roll")):
        x = p[mask, i]
        x = x[np.isfinite(x)]
        sp = v[mask[1:], i]
        out[k] = {"sd": round(float(x.std()), 2),
                  "range": round(float(np.percentile(x, 95) - np.percentile(x, 5)), 2),
                  "speed": round(float(np.nanmean(sp)), 2)}
    return out


def regions(raw: Path, ref: Path) -> dict:
    acc = {"shoulders": [], "backdrop": [], "head": []}
    for a, b in zip(read_frames(raw, (512, 512)), read_frames(ref, (512, 512))):
        d = np.abs(a.astype(np.int16) - b.astype(np.int16)).mean(2)
        acc["shoulders"].append(d[440:].mean())
        acc["backdrop"].append(np.concatenate([d[:300, :40].ravel(), d[:300, 472:].ravel()]).mean())
        acc["head"].append(d[20:400, 56:456].mean())
    return {k: round(float(np.mean(v)), 2) for k, v in acc.items()}


def measure_dir(d: Path, ref: Path | None, metrics: bool = True, name: str = "raw.mp4", size: int = 512) -> dict:
    from ...live.bench import sharpness
    from ...paths import portrait_path
    from ...post.metrics import measure
    from ...post.normalise import normalise

    raw = d / name
    tag = "" if name == "raw.mp4" else "-" + Path(name).stem
    wav = clip_wav(d)
    n = int(round(duration_s(raw) * FPS))
    voiced = voiced_frames(wav, n)
    rep: dict = {"clip": str(d), "file": name, "size": size, "frames": n, "voicedFrames": int(voiced.sum())}
    if metrics:
        video = d / f"video{tag}.mp4"
        if not video.is_file():
            normalise(raw, wav, duration_s(wav), video)
        with gpu_lock():  # SyncNet and DINOv2 run on the GPU
            m = measure(video, portrait_path())
        rep["sync"] = {"conf": None if m.sync_conf is None else round(m.sync_conf, 3), "offset": m.sync_offset}
        rep["identity"] = m.identity
        rep["sharpness"] = sharpness(video, m.face_box)
    poses, ms = landmark_pass(raw, voiced, size)
    np.save(d / f"mp_pose{tag}.npy", poses)
    rep["mouthSharpness"] = round(float(np.mean(ms)), 2) if ms else None
    mask = voiced if voiced.sum() > 50 else np.ones(n, bool)
    mask = mask[:len(poses)]
    rep["pose"] = pose_stats(poses, mask)
    rep["poseScope"] = "voiced frames" if voiced.sum() > 50 else "all frames"
    if ref is not None and ref.resolve() != raw.resolve() and size == 512:
        rep["regionsVsRef"] = regions(raw, ref)
    (d / f"measure{tag}.json").write_text(json.dumps(rep, indent=2) + "\n", encoding="utf-8", newline="\n")
    return rep


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+", type=Path)
    ap.add_argument("--ref", type=Path, default=None, help="FlashHead raw.mp4 the clips were made from")
    ap.add_argument("--no-metrics", action="store_true")
    ap.add_argument("--name", default="raw.mp4", help="the clip file in each dir (up.mp4: the Maxine copy)")
    ap.add_argument("--size", type=int, default=512, help="decode size for the landmark pass")
    a = ap.parse_args()
    for d in a.dirs:
        rep = measure_dir(d, a.ref, not a.no_metrics, a.name, a.size)
        print(json.dumps({k: rep.get(k) for k in ("clip", "sync", "identity", "sharpness", "mouthSharpness",
                                                   "regionsVsRef")}))
        print("  pose", json.dumps(rep["pose"]))


if __name__ == "__main__":
    main()
