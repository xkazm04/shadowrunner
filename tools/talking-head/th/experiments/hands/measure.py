"""Clip figures for the verdict, all at the clip's native size and 25 fps:

- lip sync and identity: `th.post.metrics.measure` (SyncNet v2, DINOv2 face crop vs the portrait);
- hands: MediaPipe Hand Landmarker (Apache-2.0) per frame: how often 0/1/2 hands are found, the
  wrist travel (range, in face heights) and how hand speed follows the speech energy (Pearson r of
  the wrist speed against the audio RMS envelope, and the lag in frames that maximises it);
- head: MediaPipe Face Landmarker: the face-centre travel (in face heights) and the roll range
  (degrees, from the outer eye corners);
- a sheet of six evenly spaced frames.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from ...ffmpeg import duration_s, probe, read_frames, video_stream
from ...paths import models_dir

FPS = 25
HAND_TASK = "hand_landmarker.task"
HAND_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/"
            "float16/1/hand_landmarker.task")
HAND_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
EYE_OUTER = (33, 263)  # MediaPipe face mesh: right and left outer eye corners
MAX_LAG = 12           # frames either way for the gesture/speech lag search (0.48 s)


@dataclass
class ClipStats:
    frames: int = 0
    hands_found: dict[str, float] = field(default_factory=dict)  # "0"/"1"/"2" -> fraction
    wrist_range: float | None = None    # max over wrists of the p95-p5 travel / face height
    gesture_r: float | None = None      # wrist speed vs audio RMS, best r within +-MAX_LAG
    gesture_lag: int | None = None      # frames; positive = hands move after the sound
    head_travel: float | None = None    # p95-p5 face-centre travel / face height
    head_roll_deg: float | None = None  # p95-p5 roll


def native_size(video: Path) -> tuple[int, int]:
    s = video_stream(probe(video))
    return int(s["width"]), int(s["height"])


def sheet(video: Path, out: Path, n: int = 6, cols: int = 3, width: int = 360) -> Path:
    """`n` evenly spaced frames (centres of n equal spans), captioned with their time."""
    size = native_size(video)
    dur = duration_s(video)
    frames = list(read_frames(video, size, fps=FPS))
    picks = [min(len(frames) - 1, int((i + 0.5) * len(frames) / n)) for i in range(n)]
    h = round(width * size[1] / size[0])
    rows = (n + cols - 1) // cols
    canvas = Image.new("RGB", (cols * width, rows * (h + 22)), (12, 12, 14))
    draw = ImageDraw.Draw(canvas)
    for k, idx in enumerate(picks):
        x, y = (k % cols) * width, (k // cols) * (h + 22)
        canvas.paste(Image.fromarray(frames[idx]).resize((width, h), Image.LANCZOS), (x, y))
        draw.text((x + 6, y + h + 4), f"f{idx}  {idx / FPS:.2f}s / {dur:.2f}s", fill=(220, 220, 220))
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    return out


def rms_envelope(audio16k: np.ndarray, frames: int) -> np.ndarray:
    """RMS per 40 ms video frame (640 samples at 16 kHz)."""
    a = audio16k.astype(np.float32) / 32768.0
    hop = 16000 // FPS
    out = np.zeros(frames, np.float32)
    for i in range(frames):
        seg = a[i * hop:(i + 1) * hop]
        out[i] = float(np.sqrt(np.mean(seg ** 2))) if seg.size else 0.0
    return out


def best_lag(speed: np.ndarray, env: np.ndarray, max_lag: int = MAX_LAG) -> tuple[float, int] | None:
    """Pearson r of speed[t] vs env[t - lag] for lag in [-max_lag, max_lag]; the best (r, lag).
    Positive lag means the hands move `lag` frames after the sound."""
    best: tuple[float, int] | None = None
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            s, e = speed[lag:], env[:len(env) - lag]
        else:
            s, e = speed[:lag], env[-lag:]
        n = min(len(s), len(e))
        s, e = s[:n], e[:n]
        if n < 10 or s.std() == 0 or e.std() == 0:
            continue
        r = float(np.corrcoef(s, e)[0, 1])
        if best is None or r > best[0]:
            best = (r, lag)
    return best


def track(frames: list[list[tuple[float, float]]]) -> list[dict[int, tuple[float, float]]]:
    """Two wrist tracks (0 = screen-left, 1 = screen-right) from per-frame detections. MediaPipe's
    handedness label can flip between frames, so each detection goes to the nearest last-known
    track position; with no history, two hands are ordered by x and a lone hand starts track 0."""
    last: dict[int, tuple[float, float]] = {}
    out: list[dict[int, tuple[float, float]]] = []
    for dets in frames:
        cur: dict[int, tuple[float, float]] = {}
        if len(dets) >= 2 and len(last) < 2:
            a, b = sorted(dets[:2])
            cur = {0: a, 1: b}
        elif len(dets) >= 2:
            a, b = dets[0], dets[1]
            keep = _d(a, last[0]) + _d(b, last[1]) <= _d(a, last[1]) + _d(b, last[0])
            cur = {0: a, 1: b} if keep else {0: b, 1: a}
        elif len(dets) == 1:
            p = dets[0]
            if last:
                cur = {min(last, key=lambda k: _d(p, last[k])): p}
            else:
                cur = {0: p}
        last.update(cur)
        out.append(cur)
    return out


def _d(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def spread(x: np.ndarray) -> float:
    return float(np.percentile(x, 95) - np.percentile(x, 5))


def _landmarkers():
    from mediapipe.tasks.python import BaseOptions, vision

    from ...fetch import require

    hand_path = models_dir("hands-mediapipe") / HAND_TASK
    if not hand_path.is_file():
        raise SystemExit(f"hands: {hand_path} missing; fetch it from {HAND_URL}")
    hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(hand_path)),
        running_mode=vision.RunningMode.VIDEO, num_hands=2,
        min_hand_detection_confidence=0.4, min_tracking_confidence=0.4))
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=1))
    return hands, face


def motion_stats(video: Path, audio16k: np.ndarray) -> ClipStats:
    import mediapipe as mp

    size = native_size(video)
    hands_lm, face_lm = _landmarkers()
    counts: list[int] = []
    dets: list[list[tuple[float, float]]] = []
    centres, rolls, heights = [], [], []
    try:
        for i, frame in enumerate(read_frames(video, size, fps=FPS)):
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))
            ts = i * 1000 // FPS
            hr = hands_lm.detect_for_video(img, ts)
            counts.append(len(hr.hand_landmarks))
            dets.append([(lm[0].x * size[0], lm[0].y * size[1]) for lm in hr.hand_landmarks])
            fr = face_lm.detect_for_video(img, ts)
            if fr.face_landmarks:
                pts = np.array([(p.x * size[0], p.y * size[1]) for p in fr.face_landmarks[0]])
                centres.append(pts.mean(0))
                heights.append(pts[:, 1].max() - pts[:, 1].min())
                a, b = pts[EYE_OUTER[0]], pts[EYE_OUTER[1]]
                rolls.append(np.degrees(np.arctan2(b[1] - a[1], b[0] - a[0])))
    finally:
        hands_lm.close()
        face_lm.close()
    st = ClipStats(frames=len(counts))
    if not counts:
        return st
    c = np.array(counts)
    st.hands_found = {str(k): round(float((c == k).mean()), 3) for k in (0, 1, 2)}
    fh = float(np.median(heights)) if heights else None
    if fh:
        cen = np.array(centres)
        st.head_travel = round(max(spread(cen[:, 0]), spread(cen[:, 1])) / fh, 4)
        st.head_roll_deg = round(spread(np.array(rolls)), 2)
        wrists = track(dets)
        speed = np.zeros(len(wrists), np.float32)
        ranges = []
        for side in (0, 1):
            idx = [i for i, w in enumerate(wrists) if side in w]
            if len(idx) < max(10, len(wrists) // 3):
                continue
            xy = np.array([wrists[i][side] for i in idx])
            ranges.append(max(spread(xy[:, 0]), spread(xy[:, 1])) / fh)
            full = np.stack([np.interp(np.arange(len(wrists)), idx, xy[:, k]) for k in (0, 1)], 1)
            speed += np.r_[0, np.linalg.norm(np.diff(full, axis=0), axis=1)].astype(np.float32)
        if ranges:
            st.wrist_range = round(max(ranges), 4)
            found = best_lag(speed, rms_envelope(audio16k, len(wrists)))
            if found:
                st.gesture_r, st.gesture_lag = round(found[0], 3), found[1]
    return st
