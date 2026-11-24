"""The face box the full EchoMimicV3 arm needs, from MediaPipe Face Landmarker (Apache-2.0) instead of
upstream's `src/face_detect.py` (RetinaFace; InsightFace weights are non-commercial).

Upstream `get_mask_coord` returns RetinaFace's `facial_area` as (y1, y2, x1, x2, height, width) in
the reference image's pixels, with no margin; `infer_preview.py` then scales it to the sample size
and floors it onto the 16-px patch grid, and the box limits where the audio cross-attention acts
(`get_audio_mask`). RetinaFace's facial_area is the tight face box (brow-forehead to chin, cheek to
cheek); the Face Landmarker mesh extent (forehead landmark 10 to chin 152, cheek 234 to 454) is the
same box, so it is used as is, also without a margin, and goes through upstream's own scaling.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

Coords = tuple[int, int, int, int, int, int]


def mask_coords(points: np.ndarray, width: int, height: int) -> Coords:
    """(y1, y2, x1, x2, height, width) of the landmark extent, clamped to the image; `points` are
    pixel (x, y) rows."""
    x1, y1 = np.floor(points.min(0)).astype(int)
    x2, y2 = np.ceil(points.max(0)).astype(int)
    x1, x2 = max(0, int(x1)), min(width, int(x2))
    y1, y2 = max(0, int(y1)), min(height, int(y2))
    if x2 <= x1 or y2 <= y1:
        raise ValueError("empty face box")
    return y1, y2, x1, x2, height, width


def patch_grid(coords: Coords, sample_hw: tuple[int, int]) -> tuple[float, float, float, float]:
    """upstream's scaling of the box onto the sample's 16-px patch grid (infer_preview.main):
    (y1, y2, x1, x2) in patches."""
    y1, y2, x1, x2, h, w = coords
    r = float(np.sqrt(sample_hw[0] * sample_hw[1] / h / w))
    return y1 * r // 16, y2 * r // 16, x1 * r // 16, x2 * r // 16


def detect(image: Path) -> Coords:
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    from PIL import Image

    from ...fetch import require

    rgb = np.asarray(Image.open(image).convert("RGB"))
    lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
        running_mode=vision.RunningMode.IMAGE, num_faces=1))
    try:
        r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    finally:
        lm.close()
    if not r.face_landmarks:
        raise SystemExit(f"hands: no face in {image}")
    h, w = rgb.shape[:2]
    pts = np.array([(p.x * w, p.y * h) for p in r.face_landmarks[0]])
    return mask_coords(pts, w, h)
