"""Seams of a windowed (stitched) take (spec iris-hands, round 2 item 7).

For each join (the frames where window k+1's carried-over motion frames are crossfaded into
window k's tail) it reports:

- the frame step (mean absolute RGB change between consecutive frames) at the join, against the
  clip's median step: a cut or a pop shows as a step many times the median;
- the face-centre step (MediaPipe Face Landmarker, in face heights) at the join, against the
  median: a head that jumps between windows;
- per window: SyncNet and identity (DINOv2 face crop vs the portrait, `th.post.metrics.measure`),
  so identity drift or lip-sync decay across windows is visible.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from ...ffmpeg import read_frames, run_ffmpeg
from ...gpu import gpu_lock
from .measure import FPS, native_size


@dataclass
class Join:
    frame: int               # first frame of the crossfade
    step_ratio: float        # max frame step over the crossfade (+-2 frames) / median step
    face_ratio: float | None  # max face-centre step within the join / median face step


def frame_steps(video: Path) -> np.ndarray:
    size = native_size(video)
    prev, out = None, []
    for f in read_frames(video, size, fps=FPS):
        g = f.astype(np.int16)
        out.append(0.0 if prev is None else float(np.abs(g - prev).mean()))
        prev = g
    return np.array(out, np.float32)


def face_steps(video: Path) -> np.ndarray:
    """Face-centre travel per frame in face heights (NaN where no face)."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    from ...fetch import require

    size = native_size(video)
    lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
        running_mode=vision.RunningMode.IMAGE, num_faces=1))
    centres = []
    try:
        for f in read_frames(video, size, fps=FPS):
            r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f)))
            if r.face_landmarks:
                pts = np.array([(p.x * size[0], p.y * size[1]) for p in r.face_landmarks[0]])
                centres.append((*pts.mean(0), pts[:, 1].max() - pts[:, 1].min()))
            else:
                centres.append((np.nan, np.nan, np.nan))
    finally:
        lm.close()
    c = np.array(centres, np.float64)
    step = np.r_[0.0, np.linalg.norm(np.diff(c[:, :2], axis=0), axis=1)]
    return step / np.nanmedian(c[:, 2])


def joins(steps: np.ndarray, face: np.ndarray | None, plan: list[tuple[int, int]],
          overlap: int, radius: int = 2) -> list[Join]:
    """The crossfade spans [start, start + overlap); a pop can sit at either end of it."""
    med = float(np.median(steps[1:])) or 1e-6
    fmed = float(np.nanmedian(face[1:])) if face is not None else None
    out = []
    for start, _ in plan[1:]:
        lo, hi = max(1, start - radius), min(len(steps), start + overlap + radius + 1)
        fr = None
        if face is not None and fmed:
            seg = face[lo:hi]
            fr = round(float(np.nanmax(seg)) / fmed, 2) if np.isfinite(seg).any() else None
        out.append(Join(start, round(float(steps[lo:hi].max()) / med, 2), fr))
    return out


def per_window(clip: Path, portrait: Path, plan: list[tuple[int, int]], work: Path) -> list[dict]:
    """SyncNet and identity of each window's own span of the finished clip (audio included)."""
    from ...post.metrics import measure

    rows = []
    size = native_size(clip)
    work.mkdir(parents=True, exist_ok=True)
    for k, (start, n) in enumerate(plan):
        seg = work / f"window{k}.mp4"
        run_ffmpeg(["-ss", f"{start / FPS:.3f}", "-i", str(clip), "-t", f"{n / FPS:.3f}",
                    "-c:v", "libx264", "-crf", "16", "-c:a", "aac", str(seg)])
        with gpu_lock():
            m = measure(seg, portrait, size=size)
        rows.append({"window": k, "start": start, "frames": n, "syncConf": m.sync_conf,
                     "identity": (m.identity or {}).get("mean")})
    return rows


def report(clip: Path, portrait: Path, plan: list[tuple[int, int]], overlap: int,
           out_dir: Path) -> dict:
    import json

    steps = frame_steps(clip)
    face = face_steps(clip)
    js = joins(steps, face, plan, overlap)
    rows = per_window(clip, portrait, plan, out_dir / "windows")
    out = {"plan": plan, "medianStep": round(float(np.median(steps[1:])), 3),
           "joins": [asdict(j) for j in js], "windows": rows,
           "worstJoinStepRatio": max((j.step_ratio for j in js), default=None),
           "frameStepP99Ratio": round(float(np.percentile(steps[1:], 99) / np.median(steps[1:])), 2)}
    (out_dir / "seams.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return out
