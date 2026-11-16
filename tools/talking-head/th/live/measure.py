"""Figures for the idle loop and the seam blend, over frames in memory or a clip on disk.

Per frame, MediaPipe Face Landmarker (Apache-2.0, the `th fetch mediapipe` model) gives:
- head: the nose tip (landmark 1) in pixels; motion range = p95 - p5 of x and of y;
- mouth: the inner-lip gap (13 to 14) in pixels; "closed" below MOUTH_CLOSED_PX at 512;
- eyes: openness (159-145, 386-374) over the eye width; a blink is a dip below BLINK_RATIO of the
  clip's median openness;
- eye-region darkness: the mean grey of both eye boxes; a dip is a drop of DARK_DIP grey levels
  below the rolling median (the brief's cross-check for blinks).
Steps: mean abs difference of consecutive frames (grey, 0..255) on 128 px thumbnails.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

MOUTH_CLOSED_PX = 2.0  # at 512 px; the silent face measures 0.0-0.6
BLINK_RATIO = 0.6
DARK_DIP = 4.0
THUMB = 128
EYES = {"l": (159, 145, 33, 133), "r": (386, 374, 362, 263)}  # upper, lower, corner, corner


@dataclass
class Track:
    nose: np.ndarray  # (N, 2) px, NaN where no face
    gap: np.ndarray  # (N,) inner-lip gap px
    eye: np.ndarray  # (N,) eye openness ratio (mean of both)
    dark: np.ndarray  # (N,) mean grey of the eye boxes
    thumbs: np.ndarray  # (N, THUMB*THUMB) float32 grey


def _grey(f: np.ndarray) -> np.ndarray:
    return f.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)


def thumb(f: np.ndarray) -> np.ndarray:
    step = max(1, f.shape[0] // THUMB)
    return _grey(f[::step, ::step]).reshape(-1)


def track(frames: Iterable[np.ndarray]) -> Track:
    """Landmarks and thumbnails for each RGB uint8 frame."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    from ..fetch import require

    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(require("mediapipe") / "face_landmarker.task")),
        running_mode=vision.RunningMode.IMAGE, num_faces=1)
    nose, gap, eye, dark, th = [], [], [], [], []
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        for f in frames:
            th.append(thumb(f))
            res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f)))
            if not res.face_landmarks:
                nose.append((np.nan, np.nan))
                gap.append(np.nan)
                eye.append(np.nan)
                dark.append(np.nan)
                continue
            h, w = f.shape[:2]
            p = np.array([(q.x * w, q.y * h) for q in res.face_landmarks[0]], np.float32)
            nose.append(tuple(p[1]))
            gap.append(float(np.linalg.norm(p[14] - p[13])))
            opens, greys = [], []
            g = _grey(f)
            for up, lo, c0, c1 in EYES.values():
                width = float(np.linalg.norm(p[c1] - p[c0])) or 1.0
                opens.append(float(np.linalg.norm(p[lo] - p[up])) / width)
                x0, x1 = sorted((int(p[c0][0]), int(p[c1][0])))
                yc = int((p[up][1] + p[lo][1]) / 2)
                r = max(3, int(width * 0.35))
                greys.append(float(g[max(0, yc - r):yc + r, max(0, x0):x1].mean()))
            eye.append(float(np.mean(opens)))
            dark.append(float(np.mean(greys)))
    return Track(np.array(nose, np.float32), np.array(gap, np.float32), np.array(eye, np.float32),
                 np.array(dark, np.float32), np.stack(th))


def steps(thumbs: np.ndarray) -> np.ndarray:
    return np.abs(np.diff(thumbs, axis=0)).mean(1)


def blinks(eye: np.ndarray) -> int:
    """Dips of eye openness below BLINK_RATIO x the median, counted once per dip."""
    med = float(np.nanmedian(eye))
    low = np.nan_to_num(eye, nan=med) < BLINK_RATIO * med
    return int(np.sum(low[1:] & ~low[:-1]) + (1 if low[:1].any() else 0))


def dark_dips(dark: np.ndarray, win: int = 25) -> int:
    """Eye-region grey dropping DARK_DIP levels below its rolling median (either direction counts
    as an eyelid event would change it; we count drops and rises separately and report both)."""
    d = np.nan_to_num(dark, nan=float(np.nanmedian(dark)))
    pad = np.pad(d, win // 2, mode="edge")
    med = np.array([np.median(pad[i:i + win]) for i in range(len(d))])
    ev = np.abs(d - med) > DARK_DIP
    return int(np.sum(ev[1:] & ~ev[:-1]) + (1 if ev[:1].any() else 0))


def summary(t: Track, lo: int = 0, hi: int | None = None) -> dict:
    s = slice(lo, hi)
    nose, gap = t.nose[s], t.gap[s]
    st = steps(t.thumbs[s])
    rng = lambda a: float(np.nanpercentile(a, 95) - np.nanpercentile(a, 5))  # noqa: E731
    return {"frames": int(len(gap)), "faceMissing": int(np.isnan(gap).sum()),
            "headRangePx": {"x": round(rng(nose[:, 0]), 2), "y": round(rng(nose[:, 1]), 2)},
            "mouthGapPx": {"p50": round(float(np.nanmedian(gap)), 2),
                           "max": round(float(np.nanmax(gap)), 2)},
            "mouthClosedFrac": round(float(np.mean(np.nan_to_num(gap, nan=99) <= MOUTH_CLOSED_PX)), 3),
            "blinks": blinks(t.eye[s]), "eyeDarkEvents": dark_dips(t.dark[s]),
            "stepMedian": round(float(np.median(st)), 3), "stepP95": round(float(np.percentile(st, 95)), 3)}


def pick_loop(t: Track, min_len: int, max_len: int, skip: int = 0) -> dict | None:
    """The span [a, b) with every frame's mouth closed whose wrap mismatch is smallest: the frame
    that naturally follows the last (b) against the first (a), over the span's median step (0: the
    wrap is an ordinary step; comparing the last frame itself would favour a repeated frame, a
    stall). Ties (within 5 %) go to the longer span, then more head motion. `wrapStep` is the step
    actually seen at the wrap (frame b-1 -> a). None when no closed span is long enough."""
    closed = np.nan_to_num(t.gap, nan=99) <= MOUTH_CLOSED_PX
    closed[:skip] = False
    n = len(closed)
    run = np.zeros(n + 1, int)  # run[i]: closed frames starting at i
    for i in range(n - 1, -1, -1):
        run[i] = run[i + 1] + 1 if closed[i] else 0
    st = steps(t.thumbs)
    best = None
    for a in range(n):
        if run[a] < min_len:
            continue
        top = min(max_len, run[a], n - 1 - a)  # the frame after the last must exist
        if top < min_len:
            continue
        ends = np.arange(a + min_len - 1, a + top)  # last frame index
        mismatch = np.abs(t.thumbs[ends + 1] - t.thumbs[a]).mean(1)
        for e, m in zip(ends, mismatch):
            med = float(np.median(st[a:e]))
            motion = float(np.ptp(t.nose[a:e + 1, 0]) + np.ptp(t.nose[a:e + 1, 1]))
            key = (round(m / med / 0.05), -(e - a), -motion)
            if best is None or key < best[0]:
                best = (key, a, int(e) + 1, float(m), med)
    if best is None:
        return None
    _, a, b, m, med = best
    w = float(np.abs(t.thumbs[b - 1] - t.thumbs[a]).mean())
    return {"start": a, "end": b, "frames": b - a, "wrapStep": round(w, 3), "medianStep": round(med, 3),
            "wrapOverMedian": round(w / med, 3), "mismatchOverMedian": round(m / med, 3)}


def seam_stats(thumbs: np.ndarray, frame0: int = 0, chunk: int = 24, spans: list[tuple[int, int]] | None = None,
               near: int = 3) -> dict:
    """Step at each chunk boundary (frame n-1 -> n with n % chunk == 0) against the steps away from
    any boundary (more than `near` frames from one), and the largest step within `near` frames of a
    boundary (a blend spreads the jump; this shows it did not just move it). `spans`: only frames
    inside these [lo, hi) ranges count (speech in a mixed clip). Frame i of `thumbs` is stream
    frame frame0 + i."""
    st = steps(thumbs)  # st[i]: frame i -> i+1
    idx = np.arange(len(st)) + frame0 + 1  # the frame each step lands on
    ok = np.ones(len(st), bool)
    if spans is not None:
        ok = np.zeros(len(st), bool)
        for lo, hi in spans:
            ok |= (idx > lo) & (idx < hi)
    dist = np.minimum(idx % chunk, chunk - idx % chunk)
    at = ok & (idx % chunk == 0)
    away = ok & (dist > near)
    win = [float(st[max(0, i - near):i + near].max()) for i in np.flatnonzero(at)]
    r = lambda a: None if len(a) == 0 else round(float(np.mean(a)), 3)  # noqa: E731
    return {"seams": int(at.sum()), "seamStep": r(st[at]), "nonSeamStep": r(st[away]),
            "seamWindowMax": r(win), "nonSeamP95": None if not away.any() else
            round(float(np.percentile(st[away], 95)), 3)}


def clip_thumbs(video: Path, size: int) -> np.ndarray:
    from ..ffmpeg import read_frames

    return np.stack([thumb(f) for f in read_frames(video, (size, size))])


def bench_seams(raw: Path, lines: list[dict], size: int) -> dict:
    """Seam figures for a live-bench clip: inside the spoken lines, and outside them (idle; while
    the idle loop shows, those frames are the loop's, not the model's)."""
    th = clip_thumbs(raw, size)
    spans = [(int(ln["startMs"] // 40), int(ln["endMs"] // 40)) for ln in lines
             if ln["startMs"] is not None and ln["endMs"] is not None]
    n = len(th)
    gaps, prev = [], 0
    for lo, hi in sorted(spans):
        gaps.append((prev, lo))
        prev = hi
    gaps.append((prev, n))
    return {"speech": seam_stats(th, spans=spans) if spans else None,
            "idle": seam_stats(th, spans=gaps), "all": seam_stats(th)}
