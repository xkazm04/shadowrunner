"""dub-ls paste-back: how much of LatentSync's frame reaches the video (`TH_DUB_PASTE`).

LatentSync pastes its whole aligned crop back, VAE round-trip included, so the upper face loses its
texture as well (Laplacian variance on the cheek: 10-13 against the plate's 34). In "mouth" mode
(the default) only the lower face is LatentSync's:

  final = plate25 x (1 - m) + latentsync x m

- `plate25` is the 25 fps plate LatentSync itself read (it resamples its input to 25 fps). Its
  output follows that plate frame for frame, then loops it ping-pong to the audio's length, so
  frame k of the output pairs with plate25 frame `pingpong(k, n)`.
- `m` is per frame, from MediaPipe Face Landmarker (Apache-2.0, CPU) on the plate frame. Both
  frames share one frame space. The polygon is:
  - the face oval from MP 132 down around the chin to 361 (the jaw line), pushed out by JAW_PAD_PX
    from the mouth so the jaw line and the jaw drop stay inside;
  - closed across the lower cheeks and under the nose: 425, 426, 391, 164, 165, 206, 205.
  It is then feathered with a Gaussian blur of FEATHER_PX, so the edge is a gradient, not a step.
"crop" keeps LatentSync's own paste (the v1 behaviour).
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np

from ..ffmpeg import FrameWriter, probe, read_frames, video_stream

MODES = ("mouth", "crop")
OVAL = (132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361)
UPPER = (425, 426, 391, 164, 165, 206, 205)
MOUTH_CENTRE = (13, 14, 61, 291)
JAW_PAD_PX = 24
FEATHER_PX = 16


def mode() -> str:
    m = os.environ.get("TH_DUB_PASTE", "mouth").strip().lower()
    if m not in MODES:
        raise SystemExit(f"TH_DUB_PASTE={m!r}: expected one of {', '.join(MODES)}")
    return m


def pingpong(k: int, n: int) -> int:
    """LatentSync's loop_video index: forward, then reversed, repeated."""
    j = k % (2 * n)
    return j if j < n else 2 * n - 1 - j


def polygon(pts: np.ndarray) -> np.ndarray:
    """The mask polygon in pixels from 478 landmarks (module header)."""
    centre = pts[list(MOUTH_CENTRE)].mean(0)
    oval = pts[list(OVAL)]
    d = oval - centre
    oval = oval + JAW_PAD_PX * d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6)
    return np.concatenate([oval, pts[list(UPPER)]])


def mask(poly: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Filled polygon, feathered, as float32 0..1 of shape (h, w, 1)."""
    from PIL import Image, ImageDraw, ImageFilter

    w, h = size
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).polygon([tuple(map(float, p)) for p in poly], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(FEATHER_PX))
    return (np.asarray(img, np.float32) / 255.0)[..., None]


class Landmarks:
    def __init__(self) -> None:
        from mediapipe.tasks.python import BaseOptions, vision

        from ..fetch import require

        self._lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
            running_mode=vision.RunningMode.IMAGE, num_faces=1))

    def __call__(self, rgb: np.ndarray) -> np.ndarray | None:
        import mediapipe as mp

        res = self._lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
        if not res.face_landmarks:
            return None
        h, w = rgb.shape[:2]
        return np.array([(p.x * w, p.y * h) for p in res.face_landmarks[0]], np.float32)


def composite(plate25: Path, synced: Path, out: Path, log: Path | None = None,
              keep: dict[int, Path] | None = None) -> dict:
    """Writes `out` (H.264, 25 fps, picture only); returns {frames, missed, seconds}.
    `keep` = {frame index: png path} also saves those composite frames with the mask edge drawn."""
    t0 = time.perf_counter()
    vs = video_stream(probe(synced))
    w, h = int(vs["width"]), int(vs["height"])
    plate = list(read_frames(plate25, (w, h)))
    if not plate:
        raise RuntimeError(f"no frames in {plate25}")
    marks = Landmarks()
    last_poly: np.ndarray | None = None
    missed = frames = 0
    with FrameWriter(out, (w, h), 25, "rgb24", ["-c:v", "libx264", "-preset", "medium", "-crf", "12",
                                                 "-pix_fmt", "yuv420p"], log=log) as enc:
        for k, ls in enumerate(read_frames(synced, (w, h))):
            base = plate[pingpong(k, len(plate))]
            pts = marks(base)
            if pts is None:
                missed += 1  # hold the last mask; none yet: LatentSync's frame as it is
                poly = last_poly
            else:
                poly = last_poly = polygon(pts)
            if poly is None:
                frame = ls
            else:
                m = mask(poly, (w, h))
                frame = (base.astype(np.float32) * (1 - m) + ls.astype(np.float32) * m + 0.5).astype(np.uint8)
            enc.write(frame)
            if keep and k in keep and poly is not None:
                from PIL import Image, ImageDraw

                img = Image.fromarray(frame)
                ImageDraw.Draw(img).polygon([tuple(map(float, p)) for p in poly], outline=(0, 255, 0))
                img.save(keep[k])
            frames += 1
    return {"frames": frames, "missed": missed, "seconds": round(time.perf_counter() - t0, 1)}
