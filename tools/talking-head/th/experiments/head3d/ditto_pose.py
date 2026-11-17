"""Per-frame head pose and sharpness read from a rendered clip, so Ditto and FlashHead are measured
by the same instrument (round 5, H2).

- Pose: MediaPipe Face Landmarker's facial transformation matrix (Apache-2.0, `th fetch mediapipe`)
  -> yaw / pitch / roll in degrees (`euler`). Its sign convention is MediaPipe's, not LivePortrait's;
  the statistics compared (SD, range, speed) do not depend on it.
- Sharpness: variance of the Laplacian of the grey crop, resampled to a fixed size first (face box
  256 px, mouth box 128 px) so clips of different resolutions (Ditto 640, FlashHead 512) compare.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

FACE_PX = 256
MOUTH_PX = 128
LIPS = (61, 291, 0, 17, 13, 14, 78, 308, 40, 270, 91, 321)  # MediaPipe lip ring points


def euler(m: np.ndarray) -> tuple[float, float, float]:
    """(yaw, pitch, roll) in degrees from a 3x3 (or 4x4) rotation, R = Rz(roll) Ry(yaw) Rx(pitch)."""
    r = np.asarray(m, np.float64)[:3, :3]
    yaw = math.degrees(math.asin(max(-1.0, min(1.0, -r[2, 0]))))
    pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
    roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    return yaw, pitch, roll


def box(pts: np.ndarray, grow: float, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """Square box around `pts` (N,2 px), grown by `grow` of its side, clipped to `size` (w, h)."""
    x0, y0 = pts.min(0)
    x1, y1 = pts.max(0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = max(x1 - x0, y1 - y0) * (0.5 + grow)
    w, h = size
    return (int(max(0, cx - half)), int(max(0, cy - half)), int(min(w, cx + half)), int(min(h, cy + half)))


def lap_var(rgb: np.ndarray, out_px: int) -> float:
    """Variance of the Laplacian of `rgb` resized to out_px square (grey, 0..255)."""
    from PIL import Image
    from scipy.ndimage import laplace

    g = np.asarray(Image.fromarray(rgb).convert("L").resize((out_px, out_px), Image.BICUBIC), np.float32)
    return float(laplace(g).var())


@dataclass
class ClipPose:
    ypr: np.ndarray  # (N,3) degrees, NaN without a face
    face_sharp: list[float] = field(default_factory=list)
    mouth_sharp: list[float] = field(default_factory=list)
    face_boxes: list[tuple[int, int, int, int] | None] = field(default_factory=list)


def read_clip(video: Path, size: tuple[int, int], sharp_every: int = 5) -> ClipPose:
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    from ...ffmpeg import read_frames
    from ...fetch import require

    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
        running_mode=vision.RunningMode.IMAGE, num_faces=1, output_facial_transformation_matrixes=True)
    ypr, fs, ms, boxes = [], [], [], []
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        for i, f in enumerate(read_frames(video, size, fps=25)):
            res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f)))
            if not res.face_landmarks:
                ypr.append((np.nan,) * 3)
                boxes.append(None)
                continue
            ypr.append(euler(np.array(res.facial_transformation_matrixes[0])))
            p = np.array([(q.x * size[0], q.y * size[1]) for q in res.face_landmarks[0]], np.float32)
            fb = box(p, 0.05, size)
            boxes.append(fb)
            if i % sharp_every == 0:
                fs.append(lap_var(f[fb[1]:fb[3], fb[0]:fb[2]], FACE_PX))
                mb = box(p[list(LIPS)], 0.25, size)
                ms.append(lap_var(f[mb[1]:mb[3], mb[0]:mb[2]], MOUTH_PX))
    return ClipPose(np.array(ypr, np.float64), fs, ms, boxes)


def extremes(ypr: np.ndarray, n_neutral: int = 1) -> dict[str, int]:
    """Frames at the extremes of yaw and pitch (and roll), plus the frame nearest the median pose."""
    ok = np.isfinite(ypr).all(1)
    idx = np.where(ok)[0]
    if not len(idx):
        return {}
    v = ypr[idx]
    out = {"yaw-min": int(idx[v[:, 0].argmin()]), "yaw-max": int(idx[v[:, 0].argmax()]),
           "pitch-min": int(idx[v[:, 1].argmin()]), "pitch-max": int(idx[v[:, 1].argmax()]),
           "roll-max": int(idx[np.abs(v[:, 2] - np.median(v[:, 2])).argmax()])}
    if n_neutral:
        out["neutral"] = int(idx[np.linalg.norm(v - np.median(v, 0), axis=1).argmin()])
    return out


def still_change(frames, region: tuple[int, int, int, int]) -> float:
    """Mean abs change (0..255) of `region` (x0, y0, x1, y1) against the first frame, over an
    iterable of frames: is the body still?"""
    x0, y0, x1, y1 = region
    ref, vals = None, []
    for f in frames:
        c = f[y0:y1, x0:x1].astype(np.float32)
        if ref is None:
            ref = c
            continue
        vals.append(float(np.abs(c - ref).mean()))
    return round(float(np.mean(vals)), 3) if vals else 0.0
