"""Ditto adaptations applied from our side, never by editing the upstream clone (round 5, H2).

Runs inside $TH_HOME/envs/head3d-ditto (imported by ditto_run.py). The pure-numpy helpers at the top
are also imported by the tests from the core env, so this module imports nothing heavy at load time.

1. No InsightFace. Ditto's avatar registration (`core/atomic_components/source2info.py`) finds the
   face with InsightFace (`det_10g` / `insightface_det`, then `2d106det` / `landmark106`), both
   non-commercial weights. `install()` replaces those two classes in that module's namespace with
   MediaPipe Face Landmarker (Apache-2.0) shims: the detector returns the landmarks' box, and the
   "106" step returns 68 iBUG-order points mapped from MediaPipe's 478, which upstream's crop code
   already parses (`parse_pt2_from_pt68`). The rest of the chain (landmark203, the 478 eye info, the
   LivePortrait extractors) is unchanged. The InsightFace files are never downloaded.
   (`np.atan2` is aliased to `np.arctan2`: upstream uses the numpy-2 name, our envs pin 1.26.)
2. No Cython build. `core/utils/blend` compiles a .pyx with pyximport at import time (needs MSVC on
   Windows); a numpy module with the same `blend_images_cy` signature is registered first.
3. Head-pose recorder. `MotionStitch.__call__` is wrapped so every output frame records the
   rendered yaw / pitch / roll (degrees) and the source pose; that is the track H1 consumes.
"""

from __future__ import annotations

import sys
import types

import numpy as np

# MediaPipe Face Mesh (478) -> iBUG 68: jaw 17, brows 10, nose bridge 4, nostrils 5, eyes 6+6,
# outer lip 12, inner lip 8. Image-left first (the subject's right), as iBUG orders them.
MP_TO_68 = np.array([
    127, 234, 93, 132, 58, 172, 136, 150, 176, 152, 400, 379, 365, 397, 288, 361, 323,  # jaw
    70, 63, 105, 66, 107, 336, 296, 334, 293, 300,  # brows
    168, 6, 195, 4, 98, 97, 2, 326, 327,  # nose
    33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,  # eyes
    61, 39, 37, 0, 267, 269, 291, 405, 314, 17, 84, 181,  # outer lip
    78, 82, 13, 312, 308, 317, 14, 87,  # inner lip
], dtype=np.int64)


def to68(pts478: np.ndarray) -> np.ndarray:
    """(478, >=2) MediaPipe points in pixels -> (68, 2) iBUG-order points."""
    return np.ascontiguousarray(pts478[MP_TO_68, :2], dtype=np.float32)


def box_of(pts: np.ndarray, score: float = 1.0) -> np.ndarray:
    """Upstream's detector row format: [[x0, y0, x1, y1, score]]."""
    x0, y0 = pts[:, 0].min(), pts[:, 1].min()
    x1, y1 = pts[:, 0].max(), pts[:, 1].max()
    return np.array([[x0, y0, x1, y1, score]], dtype=np.float32)


def blend_images_np(mask_warped, frame_warped, frame_rgb, result) -> None:
    """Same contract as upstream's Cython blend_images_cy: result = m*warped + (1-m)*rgb, uint8."""
    m = mask_warped[..., None].astype(np.float32)
    out = m * frame_warped.astype(np.float32) + (1.0 - m) * frame_rgb.astype(np.float32)
    np.clip(out + 0.5, 0, 255, out=out)
    result[...] = out.astype(np.uint8)


def bin66_to_degree(pred: np.ndarray) -> np.ndarray:
    """Upstream's conversion: 66-bin logits -> degrees; anything else is already degrees."""
    pred = np.asarray(pred, dtype=np.float32)
    if pred.ndim > 1 and pred.shape[1] == 66:
        e = np.exp(pred - pred.max(1, keepdims=True))
        p = e / e.sum(1, keepdims=True)
        return (p * np.arange(66, dtype=np.float32)).sum(1) * 3 - 97.5
    return pred


def pose_of(info: dict) -> tuple[float, float, float]:
    """(yaw, pitch, roll) in degrees from a LivePortrait kp-info dict."""
    return tuple(float(bin66_to_degree(info[k]).reshape(-1)[0]) for k in ("yaw", "pitch", "roll"))


class PoseRecorder:
    """Per output frame: the rendered pose and the source pose, both (yaw, pitch, roll) degrees."""

    def __init__(self) -> None:
        self.rendered: list[tuple[float, float, float]] = []
        self.source: list[tuple[float, float, float]] = []
        self.t: list[tuple[float, float]] = []
        self._last: dict | None = None


RECORDER = PoseRecorder()


class _MediaPipeFace:
    """One MediaPipe Face Landmarker shared by the two shims (IMAGE mode, one face)."""

    _inst = None

    def __init__(self, task: str) -> None:
        from mediapipe.tasks.python import BaseOptions, vision

        opts = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=task),
                                            running_mode=vision.RunningMode.IMAGE, num_faces=1)
        self.lm = vision.FaceLandmarker.create_from_options(opts)
        self.last: tuple[int, np.ndarray | None] | None = None

    @classmethod
    def get(cls, task: str) -> "_MediaPipeFace":
        if cls._inst is None:
            cls._inst = cls(task)
        return cls._inst

    def points(self, img: np.ndarray) -> np.ndarray | None:
        key = id(img)
        if self.last is not None and self.last[0] == key:
            return self.last[1]
        import mediapipe as mp

        res = self.lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
        pts = None
        if res.face_landmarks:
            h, w = img.shape[:2]
            pts = np.array([(q.x * w, q.y * h) for q in res.face_landmarks[0]], np.float32)
        self.last = (key, pts)
        return pts


def install(task_path: str) -> None:
    """Patch Ditto's modules (the repo must be on sys.path, cwd at its root). Call before import of
    stream_pipeline_*."""
    if not hasattr(np, "atan2"):  # upstream's 478 ROI code uses the numpy-2 name; our envs pin 1.26
        np.atan2 = np.arctan2
    blend = types.ModuleType("core.utils.blend")
    blend.blend_images_cy = blend_images_np
    sys.modules["core.utils.blend"] = blend

    import core.atomic_components.motion_stitch as ms
    import core.atomic_components.source2info as s2i

    class MPDet:  # replaces InsightFaceDet (det_10g)
        def __init__(self, **_kw) -> None:
            self.face = _MediaPipeFace.get(task_path)

        def __call__(self, img):
            pts = self.face.points(img)
            return (np.zeros((0, 5), np.float32), None) if pts is None else (box_of(pts), None)

    class MP68:  # replaces Landmark106 (2d106det)
        def __init__(self, **_kw) -> None:
            self.face = _MediaPipeFace.get(task_path)

        def __call__(self, img, _box):
            pts = self.face.points(img)
            if pts is None:
                raise RuntimeError("MediaPipe found no face in the source image")
            return to68(pts)

    s2i.InsightFaceDet = MPDet
    s2i.Landmark106 = MP68

    orig_tk = ms.transform_keypoint

    def recording_tk(kp_info):
        RECORDER._last = {"pose": pose_of(kp_info),
                          "t": tuple(float(v) for v in np.asarray(kp_info["t"]).reshape(-1)[:2])}
        return orig_tk(kp_info)

    ms.transform_keypoint = recording_tk
    orig_call = ms.MotionStitch.__call__

    def recording_call(self, x_s_info, x_d_info, **kw):
        src = pose_of(x_s_info)
        out = orig_call(self, x_s_info, x_d_info, **kw)
        last = RECORDER._last or {"pose": (np.nan,) * 3, "t": (np.nan, np.nan)}
        RECORDER.rendered.append(last["pose"])
        RECORDER.t.append(last["t"])
        RECORDER.source.append(src)
        return out

    ms.MotionStitch.__call__ = recording_call
