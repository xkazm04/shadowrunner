"""MediaPipe Face Landmarker (Apache-2.0): the face box and the lip box of one RGB frame."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..fetch import require

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in pixels


@dataclass(frozen=True)
class Face:
    box: Box   # extent of all 478 landmarks (brow-to-chin, ear-to-ear, no hair)
    lips: Box  # extent of the lip landmarks (outer and inner contour)


class FaceTracker:
    def __init__(self) -> None:
        from mediapipe.tasks.python import BaseOptions, vision

        self._vision = vision
        path = require("mediapipe") / "face_landmarker.task"
        opts = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(path)),
            running_mode=vision.RunningMode.IMAGE, num_faces=1,
        )
        self._lm = vision.FaceLandmarker.create_from_options(opts)
        self._lip_ids = sorted({i for c in vision.FaceLandmarksConnections.FACE_LANDMARKS_LIPS
                                for i in (c.start, c.end)})

    def detect(self, rgb: np.ndarray) -> Face | None:
        import mediapipe as mp

        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        res = self._lm.detect(img)
        if not res.face_landmarks:
            return None
        h, w = rgb.shape[:2]
        pts = np.array([(p.x * w, p.y * h) for p in res.face_landmarks[0]], np.float32)
        lips = pts[self._lip_ids]
        return Face(box=_extent(pts), lips=_extent(lips))

    def close(self) -> None:
        self._lm.close()

    def __enter__(self) -> "FaceTracker":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _extent(pts: np.ndarray) -> Box:
    return (float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max()))


def grow(box: Box, frac: float) -> Box:
    """Grow a box by `frac` of its width/height on every side."""
    x0, y0, x1, y1 = box
    dx, dy = (x1 - x0) * frac, (y1 - y0) * frac
    return (x0 - dx, y0 - dy, x1 + dx, y1 + dy)


def union(boxes: list[Box]) -> Box | None:
    if not boxes:
        return None
    a = np.array(boxes, np.float32)
    return (float(a[:, 0].min()), float(a[:, 1].min()), float(a[:, 2].max()), float(a[:, 3].max()))


def to_xywh(box: Box, size: tuple[int, int]) -> list[int]:
    """Integer [x, y, w, h], clipped to the frame."""
    w, h = size
    x0, y0 = max(0, int(np.floor(box[0]))), max(0, int(np.floor(box[1])))
    x1, y1 = min(w, int(np.ceil(box[2]))), min(h, int(np.ceil(box[3])))
    return [x0, y0, max(0, x1 - x0), max(0, y1 - y0)]


def square_crop(rgb: np.ndarray, box: Box, margin: float, out: int) -> np.ndarray:
    """A square crop centred on `box`, side = max(w, h) * (1 + 2*margin), edge-padded, resized."""
    from PIL import Image

    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = max(x1 - x0, y1 - y0) * (0.5 + margin)
    pad = int(np.ceil(half)) + 2
    padded = np.pad(rgb, ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    l, t = int(round(cx - half)) + pad, int(round(cy - half)) + pad
    side = int(round(2 * half))
    crop = padded[t:t + side, l:l + side]
    return np.asarray(Image.fromarray(crop).resize((out, out), Image.BICUBIC))
