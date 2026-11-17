"""Does the pasted face sit still on the clip's head? From MediaPipe landmarks of the composite
against the clip's own (both at 25 fps), on the stable points (eyes, nose, temples, forehead):

- `offset`: the median distance between the two (a constant offset reads as a slightly different
  face, not as sliding);
- `slide`: the RMS frame-to-frame change of that residual (the face moving on the head);
- `highpass`: the RMS of the residual minus the mean of its neighbours (frame-rate jitter);
- the clip's own head motion (stable-point centroid speed) for scale, and the same high-pass on the
  clip's centroid as the landmark noise floor.

All in pixels and as a fraction of the median face height (forehead to chin).
"""

from __future__ import annotations

import numpy as np

from .fit import STABLE

FOREHEAD, CHIN = 10, 152


def face_height(lms: np.ndarray) -> float:
    return float(np.nanmedian(np.linalg.norm(lms[:, CHIN] - lms[:, FOREHEAD], axis=1)))


def highpass(x: np.ndarray) -> np.ndarray:
    """x[t] - (x[t-1] + x[t+1]) / 2 for the interior frames, (T-2, 2)."""
    return x[1:-1] - (x[:-2] + x[2:]) / 2


def rms(v: np.ndarray) -> float:
    v = v[~np.isnan(v).any(axis=-1)] if v.ndim > 1 else v[~np.isnan(v)]
    return float(np.sqrt(np.mean(np.sum(v ** 2, axis=-1)))) if v.size else float("nan")


def stats(clip: np.ndarray, comp: np.ndarray) -> dict:
    """`clip` and `comp`: (T, 478, 2) landmarks, NaN where no face was found."""
    ids = list(STABLE)
    fh = face_height(clip)
    res = (comp[:, ids] - clip[:, ids]).mean(1)          # (T, 2) mean residual per frame
    cen = clip[:, ids].mean(1)                             # (T, 2) the clip's head position
    speed = np.linalg.norm(np.diff(cen, axis=0), axis=1)
    speed = speed[~np.isnan(speed)]
    dist = np.linalg.norm(res, axis=1)
    dist = dist[~np.isnan(dist)]

    def both(px: float) -> dict:
        return {"px": round(px, 3), "faceH": round(px / fh, 5)}

    return {
        "faceHeightPx": round(fh, 1),
        "framesMeasured": int((~np.isnan(res).any(axis=1)).sum()),
        "offset": both(float(np.median(dist)) if dist.size else float("nan")),
        "slide": both(rms(np.diff(res, axis=0))),
        "highpass": both(rms(highpass(res))),
        "headSpeedMedian": both(float(np.median(speed)) if speed.size else float("nan")),
        "headSpeedMax": both(float(speed.max()) if speed.size else float("nan")),
        "headTravel": both(float(np.linalg.norm(np.nanmax(cen, 0) - np.nanmin(cen, 0)))),
        "noiseFloorHighpass": both(rms(highpass(cen))),
    }


def fastest(clip: np.ndarray) -> int:
    """The frame index ending the largest frame-to-frame move of the clip's head."""
    cen = clip[:, list(STABLE)].mean(1)
    speed = np.nan_to_num(np.linalg.norm(np.diff(cen, axis=0), axis=1), nan=-1)
    return int(np.argmax(speed)) + 1


def flow_slide(frames: list[np.ndarray], alphas: np.ndarray, box: tuple[int, int, int, int],
               upper: np.ndarray | None = None, min_luma: int = 60) -> dict:
    """An independent check that does not trust any landmarks: dense optical flow (Farneback) of the
    pasted face (alpha > 0.9, above the row `upper[t]` per frame when given, so the mouth and jaw,
    which move on their own, do not count) against the rest of the head (hair, ears, skin outside the mask: luma
    above `min_luma`, so the dark backdrop and jacket do not count), frame to frame, medians of each.
    The RMS of the difference is how fast the face slides on the head, px per frame; run it on the
    clip alone with the same masks for the clip's own figure."""
    import cv2

    x0, y0, x1, y1 = box
    rel = []
    prev = None
    ring_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    for t, (f, a) in enumerate(zip(frames, alphas)):
        gray = cv2.cvtColor(np.ascontiguousarray(f[y0:y1, x0:x1]), cv2.COLOR_RGB2GRAY)
        if prev is not None:
            flow = cv2.calcOpticalFlowFarneback(prev, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            al = a[y0:y1, x0:x1]
            face = al > 230
            if upper is not None and not np.isnan(upper[t]):
                face[max(0, int(upper[t]) - y0):] = False
            head = (cv2.dilate((al > 0).astype(np.uint8), ring_k) == 0) & (gray > min_luma)
            if face.sum() > 50 and head.sum() > 50:
                rel.append(np.median(flow[face], 0) - np.median(flow[head], 0))
        prev = gray
    r = np.array(rel)
    return {"frames": len(r), "slideRms": round(rms(r), 4) if len(r) else None,
            "slideP95": round(float(np.percentile(np.linalg.norm(r, axis=1), 95)), 4) if len(r) else None}
