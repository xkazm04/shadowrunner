"""MediaPipe Hand Landmarker (Apache-2.0, the task already fetched for round 1) over every frame of a
clip, in IMAGE mode: each frame is detected afresh, so no tracker carries a hand through a frame
where it has fallen apart and the landmarks of one frame never lean on the previous one. The raw
per-frame hands are cached beside the clip (hands.npz) so the check can be re-scored without
re-running MediaPipe.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ...ffmpeg import read_frames
from ...paths import models_dir
from .handcheck import Hand
from .measure import FPS, HAND_TASK, HAND_URL, native_size

MIN_DETECT = 0.3   # low on purpose: a weak detection is evidence (a low score), a miss is not
MIN_PRESENCE = 0.3
CACHE_VERSION = 2


def _landmarker():
    from mediapipe.tasks.python import BaseOptions, vision

    path = models_dir("hands-mediapipe") / HAND_TASK
    if not path.is_file():
        raise SystemExit(f"hands: {path} missing; fetch it from {HAND_URL}")
    return vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(path)),
        running_mode=vision.RunningMode.IMAGE, num_hands=2,
        min_hand_detection_confidence=MIN_DETECT, min_hand_presence_confidence=MIN_PRESENCE,
        min_tracking_confidence=0.3))


def landmark_luminance(frame: np.ndarray, xy: np.ndarray) -> float:
    """Median luma (BT.601) of the 3x3 patches under the 21 landmarks."""
    h, w = frame.shape[:2]
    vals = []
    for x, y in xy:
        xi, yi = int(round(float(x))), int(round(float(y)))
        patch = frame[max(0, yi - 1):min(h, yi + 2), max(0, xi - 1):min(w, xi + 2)].reshape(-1, 3)
        if patch.size:
            vals.append(patch.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32))
    return float(np.median(np.concatenate(vals))) if vals else float("nan")


def scan(video: Path) -> tuple[list[list[Hand]], tuple[int, int]]:
    """Per frame, the hands found: image landmarks in pixels, world landmarks (metres, hand-centred)
    and the handedness score."""
    import mediapipe as mp

    size = native_size(video)
    lm = _landmarker()
    frames: list[list[Hand]] = []
    try:
        for frame in read_frames(video, size, fps=FPS):
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))
            r = lm.detect(img)
            hands = []
            for pts, world, cat in zip(r.hand_landmarks, r.hand_world_landmarks, r.handedness):
                xy = np.array([(p.x * size[0], p.y * size[1]) for p in pts], np.float32)
                w = np.array([(p.x, p.y, p.z) for p in world], np.float32)
                hands.append(Hand(xy, w, float(cat[0].score), cat[0].category_name,
                                  landmark_luminance(frame, xy)))
            frames.append(hands)
    finally:
        lm.close()
    return frames, size


def save(frames: list[list[Hand]], size: tuple[int, int], out: Path) -> Path:
    n = len(frames)
    xy = np.full((n, 2, 21, 2), np.nan, np.float32)
    world = np.full((n, 2, 21, 3), np.nan, np.float32)
    score = np.full((n, 2), np.nan, np.float32)
    lum = np.full((n, 2), np.nan, np.float32)
    for i, hands in enumerate(frames):
        for k, h in enumerate(hands[:2]):
            xy[i, k], world[i, k], score[i, k], lum[i, k] = h.xy, h.world, h.score, h.lum
    np.savez_compressed(out, xy=xy, world=world, score=score, lum=lum, size=np.array(size),
                        version=np.array(CACHE_VERSION))
    return out


def load(path: Path) -> tuple[list[list[Hand]], tuple[int, int]]:
    d = np.load(path)
    frames = []
    for i in range(d["xy"].shape[0]):
        frames.append([Hand(d["xy"][i, k], d["world"][i, k], float(d["score"][i, k]), "",
                            float(d["lum"][i, k]))
                       for k in range(2) if not np.isnan(d["score"][i, k])])
    return frames, (int(d["size"][0]), int(d["size"][1]))


def scan_cached(video: Path, cache: Path | None = None) -> tuple[list[list[Hand]], tuple[int, int]]:
    cache = cache or video.with_name(video.stem + ".hands.npz")
    if cache.is_file() and cache.stat().st_mtime >= video.stat().st_mtime:
        with np.load(cache) as d:
            fresh = "version" in d and int(d["version"]) == CACHE_VERSION
        if fresh:
            return load(cache)
    frames, size = scan(video)
    save(frames, size, cache)
    return frames, size
