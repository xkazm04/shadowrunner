"""Gesture persistence across a passage (spec iris-hands round 3, req 11).

Per window of the passage (the Flash `--long` window plan, also used for a full-arm take so the
two arms are cut the same way):

- wrist travel: for each wrist track (handcheck.track, nearest-wrist tracking) seen in at least a
  third of the window's frames, the larger of its p95-p5 x and y spread, in face heights; the
  window's travel is the larger of the two wrists (as `measure.wrist_range` does for a whole clip);
  0 when neither wrist is seen enough;
- clasped-rest share: the share of the window's frames where every visible hand is clasped (both
  hands found with touching boxes, or one found over the other's last box: `FrameCheck.clasped`
  with nothing judged) and the wrists are still (mean wrist speed over +-2 frames below
  REST_SPEED face heights per frame).

A passage holds its gestures when every later window's travel is at least HOLD (60 %) of the first
window's.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .handcheck import FrameCheck, Hand, track

HOLD = 0.6
REST_SPEED = 0.02   # face heights per frame (0.5 face heights per second at 25 fps)
MIN_SEEN = 1 / 3


def _spread(x: np.ndarray) -> float:
    return float(np.percentile(x, 95) - np.percentile(x, 5))


def wrists(frames: list[list[Hand]]) -> np.ndarray:
    """(frames, 2, 2) wrist pixels per track (0 screen-left, 1 screen-right), NaN where unseen."""
    out = np.full((len(frames), 2, 2), np.nan, np.float64)
    for i, t in enumerate(track(frames)):
        for side, h in t.items():
            out[i, side] = h.xy[0]
    return out


def speeds(w: np.ndarray, face_h: float, radius: int = 2) -> np.ndarray:
    """Mean wrist speed per frame (face heights per frame) over +-radius frames; NaN if unseen."""
    step = np.linalg.norm(np.diff(w, axis=0), axis=2) / face_h       # (n - 1, 2), NaN if unseen
    seen = np.isfinite(step)
    total = np.where(seen, step, 0.0).sum(axis=1)
    count = seen.sum(axis=1)
    per = np.r_[np.nan, np.where(count > 0, total / np.maximum(count, 1), np.nan)]
    out = np.full(len(w), np.nan)
    for i in range(len(w)):
        seg = per[max(1, i - radius):i + radius + 1]
        if np.isfinite(seg).any():
            out[i] = float(np.nanmean(seg))
    return out


def clasped_rest(checks: list[FrameCheck], speed: np.ndarray, rest: float = REST_SPEED) -> np.ndarray:
    return np.array([c.clasped > 0 and c.hands == 0 and np.isfinite(s) and s < rest
                     for c, s in zip(checks, speed)])


def window_travel(w: np.ndarray, face_h: float) -> float:
    best = 0.0
    for side in (0, 1):
        seen = np.isfinite(w[:, side, 0])
        if seen.sum() < max(2, int(np.ceil(len(w) * MIN_SEEN))):
            continue
        xy = w[seen, side]
        best = max(best, _spread(xy[:, 0]) / face_h, _spread(xy[:, 1]) / face_h)
    return round(best, 4)


def persistence(w: np.ndarray, rest: np.ndarray, face_h: float,
                plan: list[tuple[int, int]], hold: float = HOLD) -> dict:
    rows = []
    for k, (start, n) in enumerate(plan):
        rows.append({"window": k, "start": start, "frames": n,
                     "wristTravel": window_travel(w[start:start + n], face_h),
                     "claspedRest": round(float(rest[start:start + n].mean()), 3)})
    first = rows[0]["wristTravel"]
    later = [r["wristTravel"] for r in rows[1:]]
    ratio = None if not later or not first else round(min(later) / first, 3)
    return {"windows": rows, "minLaterOverFirst": ratio,
            "holds": None if not later else bool(first and ratio is not None and ratio >= hold),
            "hold": hold}


def face_height(clip: Path, every: int = 10) -> float:
    """Median landmark-extent face height (px) over every `every`-th frame (as measure.py)."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    from ...fetch import require
    from ...ffmpeg import read_frames
    from .measure import FPS, native_size

    size = native_size(clip)
    lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
        running_mode=vision.RunningMode.IMAGE, num_faces=1))
    hs = []
    try:
        for i, f in enumerate(read_frames(clip, size, fps=FPS)):
            if i % every:
                continue
            r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f)))
            if r.face_landmarks:
                ys = [p.y * size[1] for p in r.face_landmarks[0]]
                hs.append(max(ys) - min(ys))
    finally:
        lm.close()
    if not hs:
        raise SystemExit(f"hands: no face in {clip}")
    return float(np.median(hs))


def report(clip: Path, plan: list[tuple[int, int]], write: bool = True) -> dict:
    """Persistence of a finished take (its hands.npz), written into its figures.json (`write`)."""
    from .handcheck import check
    from .handscan import scan_cached

    hands, size = scan_cached(clip, clip.parent / "hands.npz")
    fh = face_height(clip)
    w = wrists(hands)
    out = persistence(w, clasped_rest(check(hands, size), speeds(w, fh)), fh, plan)
    out["faceHeightPx"] = round(fh, 1)
    fig = clip.parent / "figures.json"
    if write and fig.is_file():
        f = json.loads(fig.read_text(encoding="utf-8"))
        fig.write_text(json.dumps({**f, "persistence": out}, indent=2) + "\n", encoding="utf-8")
    return out
