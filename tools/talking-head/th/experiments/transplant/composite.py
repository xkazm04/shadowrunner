"""The per-frame compositor: landmarks on the EchoMimicV3 frame and the FlashHead frame, a stable-
point similarity fit (smoothed), the FlashHead frame warped onto the clip, colour-matched in a band
inside the mask edge, and blended through the feathered face mask. A frame where either face is not
found holds the last transform (and the clip's last landmarks for the mask); those are counted.

Writes the composite (with the line's audio), <composite>.npz (per-frame landmarks, transforms and
the mask, for the report) and returns the counts and the measured cost per frame.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from ...ffmpeg import FrameWriter, probe, read_frames, video_stream
from .fit import STABLE, Smoother, apply, params, similarity
from .landmarks import Landmarks
from .mask import (ColourMatch, MaskCfg, axes, band, brow_cut, eye_holes, feather, hard_mask, inset,
                   lab_stats, polygon)

FPS = 25
CODEC = ["-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-shortest"]


def native_size(video: Path) -> tuple[int, int]:
    s = video_stream(probe(video))
    return int(s["width"]), int(s["height"])


def warp(src: np.ndarray, m: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """`src` through the 2x3 similarity `m` into a `size` (w, h) frame. A downscale is done first
    with area averaging (a plain cubic warp would alias FlashHead's fine detail)."""
    import cv2

    s = params(m)[0]
    h, w = src.shape[:2]
    m2 = m.copy()
    if s < 0.95:
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
        src = cv2.resize(src, (nw, nh), interpolation=cv2.INTER_AREA)
        m2[:, 0] *= w / nw
        m2[:, 1] *= h / nh
    return cv2.warpAffine(src, m2, size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def paste(clip: np.ndarray, fh: np.ndarray, le: np.ndarray, lf: np.ndarray, m: np.ndarray,
          cfg: MaskCfg, colour: ColourMatch) -> tuple[np.ndarray, np.ndarray]:
    """(composite, alpha) for one frame; `le` and `lf` are the clip's and FlashHead's landmarks.
    All the work happens in the box around the two mask polygons (the cost per frame live)."""
    h, w = clip.shape[:2]
    _, _, fw, _ = axes(le)
    sigma = cfg.feather * fw
    polys = [polygon(le, cfg), polygon(apply(m, lf), cfg)]
    pts = np.concatenate(polys)
    pad = 2
    x0, y0 = (max(0, int(np.floor(v)) - pad) for v in pts.min(0))
    x1, y1 = min(w, int(np.ceil(pts[:, 0].max())) + pad), min(h, int(np.ceil(pts[:, 1].max())) + pad)
    alpha_full = np.zeros((h, w), np.float32)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return clip, alpha_full
    off = np.array([x0, y0], np.float64)
    ml = m.copy()
    ml[:, 2] -= off
    size = (x1 - x0, y1 - y0)
    warped = warp(fh, ml, size)
    point, down = brow_cut(le, cfg)
    hard = hard_mask(size, [p - off for p in polys], (point - off, down))
    ring = band(hard, cfg.band * fw)
    local = clip[y0:y1, x0:x1]
    colour.update(lab_stats(warped, ring), lab_stats(local, ring))
    alpha = feather(inset(hard, 2 * sigma), sigma)
    if cfg.clip_eyes:
        alpha = alpha * (1 - feather(eye_holes(le - off, size, cfg), sigma * 0.6))
    alpha = alpha[..., None]
    out = clip.copy()
    face = colour.apply(warped)
    out[y0:y1, x0:x1] = np.clip(local * (1 - alpha) + face * alpha + 0.5, 0, 255).astype(np.uint8)
    alpha_full[y0:y1, x0:x1] = alpha[..., 0]
    return out, alpha_full


def composite(clip_path: Path, fh_path: Path, wav: Path, out: Path, smooth: bool = True,
              cfg: MaskCfg = MaskCfg()) -> dict:
    size = native_size(clip_path)
    fh_size = native_size(fh_path)
    smoother = Smoother(fh_size, FPS, enabled=smooth)
    colour = ColourMatch()
    miss_e = miss_f = 0
    last_le: np.ndarray | None = None
    rec_le, rec_lf, rec_raw, rec_m, rec_a = [], [], [], [], []
    cost = {"clipLandmarksMs": [], "fhLandmarksMs": [], "pasteMs": []}
    out.parent.mkdir(parents=True, exist_ok=True)
    writer = FrameWriter(out, size, FPS, "rgb24", CODEC, extra_inputs=["-i", str(wav)])
    with Landmarks(FPS) as lm_e, Landmarks(FPS) as lm_f, writer:
        for e, f in zip(read_frames(clip_path, size, fps=FPS), read_frames(fh_path, fh_size, fps=FPS)):
            t0 = time.perf_counter()
            le = lm_e(e)
            t1 = time.perf_counter()
            lf = lm_f(f)
            t2 = time.perf_counter()
            miss_e += le is None
            miss_f += lf is None
            raw = similarity(lf[list(STABLE)], le[list(STABLE)]) if le is not None and lf is not None else None
            m = smoother.step(raw)
            last_le = le if le is not None else last_le
            if m is None or last_le is None or lf is None:
                frame, alpha = e, np.zeros(e.shape[:2], np.float32)  # no fit so far
            else:
                frame, alpha = paste(e, f, last_le, lf, m, cfg, colour)
            t3 = time.perf_counter()
            writer.write(frame)
            cost["clipLandmarksMs"].append((t1 - t0) * 1000)
            cost["fhLandmarksMs"].append((t2 - t1) * 1000)
            cost["pasteMs"].append((t3 - t2) * 1000)
            nan = np.full((478, 2), np.nan)
            rec_le.append(le if le is not None else nan)
            rec_lf.append(lf if lf is not None else nan)
            rec_raw.append(raw if raw is not None else np.full((2, 3), np.nan))
            rec_m.append(m if m is not None else np.full((2, 3), np.nan))
            rec_a.append(np.round(alpha * 255).astype(np.uint8))
    np.savez_compressed(out.with_suffix(".npz"), clip=np.array(rec_le), fh=np.array(rec_lf),
                        raw=np.array(rec_raw), smoothed=np.array(rec_m), alpha=np.array(rec_a))
    n = len(rec_le)
    return {
        "out": str(out), "frames": n, "smooth": smooth, "mask": cfg.__dict__,
        "clipFaceMissed": miss_e, "fhFaceMissed": miss_f, "heldFrames": smoother.held,
        "costMs": {k: {"median": round(float(np.median(v)), 2), "p95": round(float(np.percentile(v, 95)), 2)}
                   for k, v in cost.items()},
    }
