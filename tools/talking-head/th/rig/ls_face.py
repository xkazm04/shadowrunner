"""MediaPipe Face Landmarker (Apache-2.0) in place of LatentSync's InsightFace `FaceDetector`
(buffalo_l: non-commercial, refused by repo law). Runs in the dub-ls arm env, never in the core venv.

LatentSync's `ImageProcessor.affine_transform` reads only these 106-point indices and builds 3 points:
  left brow  = mean(lmk[43, 48, 49, 51, 50])     right brow = mean(lmk[101:106])
  nose       = mean(lmk[74, 77, 83, 86])
then fits a similarity transform onto its template ((17, 20), (58, 20), (37.5, 40) x 2.8 x res/256).
The adapter fills exactly those indices from MediaPipe's 478 landmarks (everything else is 0):
  image-left brow  <- mean(MP 70, 63, 105, 66, 107, 46, 53, 52, 65, 55)    (the subject's right brow)
  image-right brow <- mean(MP 300, 293, 334, 296, 336, 276, 283, 282, 295, 285)
  nose             <- mean(MP 197, 195, 5)   (the nose bridge where it sits 0.47 brow-spacings
                      below the brow line on Iris; the template's own ratio is 20 / 41 = 0.49)
  The two brows are ordered by x, so a mirrored face still maps image-left to the template's left.
The box is the landmarks' extent (LatentSync only checks it is not None)."""

from __future__ import annotations

import numpy as np

BROW_A = (70, 63, 105, 66, 107, 46, 53, 52, 65, 55)
BROW_B = (300, 293, 334, 296, 336, 276, 283, 282, 295, 285)
NOSE = (197, 195, 5)
LS_LEFT = (43, 48, 49, 51, 50)
LS_RIGHT = (101, 102, 103, 104, 105)
LS_NOSE = (74, 77, 83, 86)
MODEL_PATH = None  # set by the runner: the core `th fetch mediapipe` face_landmarker.task


def three_points(lm: np.ndarray) -> np.ndarray:
    """[image-left brow, image-right brow, nose] from 478 MediaPipe landmarks in pixels."""
    a, b = lm[list(BROW_A)].mean(0), lm[list(BROW_B)].mean(0)
    left, right = (a, b) if a[0] <= b[0] else (b, a)
    return np.stack([left, right, lm[list(NOSE)].mean(0)])


def as_106(points3: np.ndarray) -> np.ndarray:
    """A 106x2 array whose LatentSync-read indices give back `points3` (their means are the points)."""
    out = np.zeros((106, 2), dtype=np.float64)
    out[list(LS_LEFT)] = points3[0]
    out[list(LS_RIGHT)] = points3[1]
    out[list(LS_NOSE)] = points3[2]
    return out


class FaceDetector:
    """Drop-in for latentsync.utils.face_detector.FaceDetector: __call__(rgb HxWx3) -> (box, lmk106)."""

    def __init__(self, device: str = "cuda") -> None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        if MODEL_PATH is None:
            raise RuntimeError("ls_face.MODEL_PATH is not set")
        self._mp = mp
        self._lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL_PATH)), num_faces=1,
            min_face_detection_confidence=0.5))
        self.last: dict | None = None  # the last call's landmarks, points and box (the sheet reads it)

    def landmarks(self, frame: np.ndarray) -> np.ndarray | None:
        rgb = np.ascontiguousarray(np.asarray(frame)[..., :3], dtype=np.uint8)
        res = self._lm.detect(self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb))
        if not res.face_landmarks:
            return None
        h, w = rgb.shape[:2]
        return np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]], dtype=np.float64)

    def __call__(self, frame, threshold: float = 0.5):
        frame = np.asarray(frame)
        lm = self.landmarks(frame)
        if lm is None:
            self.last = None
            return None, None
        h, w = frame.shape[:2]
        x1, y1 = np.clip(lm.min(0), 0, [w, h]).astype(int)
        x2, y2 = np.clip(lm.max(0), 0, [w, h]).astype(int)
        pts = three_points(lm)
        self.last = {"landmarks": lm, "points": pts, "box": (int(x1), int(y1), int(x2), int(y2))}
        return (int(x1), int(y1), int(x2), int(y2)), as_106(pts)
