"""MediaPipe Face Landmarker (Apache-2.0, the `th fetch mediapipe` task file) in VIDEO mode: one
instance per stream, so each stream's tracking state stays its own, as it would live."""

from __future__ import annotations

import numpy as np


class Landmarks:
    def __init__(self, fps: int = 25) -> None:
        from mediapipe.tasks.python import BaseOptions, vision

        from ...fetch import require

        self.fps = fps
        self.i = 0
        self._lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
            running_mode=vision.RunningMode.VIDEO, num_faces=1))

    def __call__(self, rgb: np.ndarray) -> np.ndarray | None:
        """(478, 2) pixel coordinates, or None when no face is found."""
        import mediapipe as mp

        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        res = self._lm.detect_for_video(img, self.i * 1000 // self.fps)
        self.i += 1
        if not res.face_landmarks:
            return None
        h, w = rgb.shape[:2]
        return np.array([(p.x * w, p.y * h) for p in res.face_landmarks[0]], np.float64)

    def close(self) -> None:
        self._lm.close()

    def __enter__(self) -> "Landmarks":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
