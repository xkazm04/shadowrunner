"""The paste mask and the colour match.

Mask: MediaPipe's face oval, pulled in at the sides and the forehead (so the cheek edge against the
hair, the ears and the headset stay the clip's) and pushed out below the nose line (so FlashHead's
jaw and chin, and the clip's, are both covered whatever each mouth does), cut above the brows (the
fringe stays the clip's), drawn for both the clip's face and the warped FlashHead face and united,
then feathered with a Gaussian that lies inside the polygon (inset by two sigma first, so the
polygon is the outer limit of the paste).

Colour: Lab mean/std of the warped FlashHead face against the clip's, measured in a band just
inside the mask edge (cheeks and jaw skin, where a seam would show), with the std ratio clamped and
the statistics smoothed over time, applied to the whole pasted face.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# MediaPipe face mesh oval, in order around the face (forehead centre first, then screen-left).
OVAL = (10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
        152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109)
BROWS = (70, 63, 105, 66, 107, 336, 296, 334, 293, 300)
EYES_MID = (168,)
NOSE_TIP = 4
CHIN = 152
SIDES = (234, 454)
# eye contours (lids at the lash line), screen-left eye then screen-right
EYES = ((33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246),
        (263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466))


@dataclass(frozen=True)
class MaskCfg:
    side_shrink: float = 0.02   # x face width, pulled in above the nose line
    low_grow: float = 0.04      # x face height, pushed out below the nose line
    brow_lift: float = 0.03     # x face height, the cut line above the brow tops
    feather: float = 0.035      # Gaussian sigma, x face width (the ramp lies inside the polygon)
    band: float = 0.12          # colour band width inside the edge, x face width
    clip_eyes: bool = False     # keep the clip's eyes (its blinks and gaze): holes in the paste
    eye_grow: tuple[float, float] = (1.35, 2.2)  # eye hole size around the contour, x and y


def axes(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    """(centre, unit down vector, face width, face height) of one landmark set."""
    top, chin = pts[EYES_MID[0]], pts[CHIN]
    down = chin - top
    down = down / (np.linalg.norm(down) + 1e-9)
    w = float(np.linalg.norm(pts[SIDES[0]] - pts[SIDES[1]]))
    h = float(np.linalg.norm(pts[CHIN] - pts[10]))
    return pts[list(OVAL)].mean(0), down, w, h


def polygon(pts: np.ndarray, cfg: MaskCfg) -> np.ndarray:
    """The adjusted oval (36, 2) for one landmark set."""
    centre, down, w, h = axes(pts)
    oval = pts[list(OVAL)].astype(np.float64)
    nose_d = float((pts[NOSE_TIP] - centre) @ down)
    out = []
    for p in oval:
        r = p - centre
        n = np.linalg.norm(r) + 1e-9
        delta = h * cfg.low_grow if float(r @ down) > nose_d else -w * cfg.side_shrink
        out.append(p + r / n * delta)
    return np.array(out)


def eye_holes(pts: np.ndarray, size: tuple[int, int], cfg: MaskCfg) -> np.ndarray:
    """uint8 0/1 (h, w): each eye contour scaled about its centre by `eye_grow` (lids, lashes and
    liner inside), in the head's own axes so a tilted head keeps its holes on the eyes."""
    import cv2

    _, down, _, _ = axes(pts)
    right = np.array([-down[1], down[0]])
    w, h = size
    m = np.zeros((h, w), np.uint8)
    gx, gy = cfg.eye_grow
    for eye in EYES:
        e = pts[list(eye)]
        c = e.mean(0)
        r = e - c
        grown = c + np.outer(r @ right * gx, right) + np.outer(r @ down * gy, down)
        cv2.fillPoly(m, [np.round(grown).astype(np.int32)], 1)
    return m


def brow_cut(pts: np.ndarray, cfg: MaskCfg) -> tuple[np.ndarray, np.ndarray]:
    """(point, unit down vector): keep the side of the line through the point along `down`."""
    _, down, _, h = axes(pts)
    brows = pts[list(BROWS)]
    top = brows[np.argmin(brows @ down)]
    return top - down * h * cfg.brow_lift, down


def hard_mask(size: tuple[int, int], polys: list[np.ndarray], cut: tuple[np.ndarray, np.ndarray]
              ) -> np.ndarray:
    """uint8 0/1 (h, w): the union of `polys`, minus everything above the cut line."""
    import cv2

    w, h = size
    m = np.zeros((h, w), np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.round(p).astype(np.int32)], 1)
    point, down = cut
    yy, xx = np.mgrid[0:h, 0:w]
    below = (xx - point[0]) * down[0] + (yy - point[1]) * down[1] >= 0
    return (m.astype(bool) & below).astype(np.uint8)


def feather(hard: np.ndarray, sigma: float) -> np.ndarray:
    import cv2

    return np.clip(cv2.GaussianBlur(hard.astype(np.float32), (0, 0), max(0.5, sigma)), 0, 1)


def inset(hard: np.ndarray, d: float) -> np.ndarray:
    """`hard` (uint8 0/1) eroded by `d` pixels (elliptical kernel)."""
    import cv2

    r = max(1, int(round(d)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.erode(hard, k)


def band(hard: np.ndarray, width: float) -> np.ndarray:
    """Pixels of `hard` within `width` of its edge (bool)."""
    import cv2

    k = max(3, int(round(width)) | 1)
    inner = cv2.erode(hard, np.ones((k, k), np.uint8))
    return hard.astype(bool) & ~inner.astype(bool)


def lab_stats(rgb: np.ndarray, where: np.ndarray) -> np.ndarray | None:
    """(2, 3): Lab mean and std of `rgb` (uint8) over the bool mask `where`."""
    import cv2

    if where.sum() < 50:
        return None
    lab = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)[where]
    return np.stack([lab.mean(0), lab.std(0) + 1e-3])


class ColourMatch:
    """Moves `src`'s Lab statistics onto `dst`'s, smoothed over time (EMA `alpha`)."""

    def __init__(self, alpha: float = 0.2, ratio: tuple[float, float] = (0.75, 1.33)) -> None:
        self.alpha, self.ratio = alpha, ratio
        self.src: np.ndarray | None = None
        self.dst: np.ndarray | None = None

    def update(self, src: np.ndarray | None, dst: np.ndarray | None) -> None:
        if src is None or dst is None:
            return
        if self.src is None:
            self.src, self.dst = src, dst
        else:
            self.src = self.alpha * src + (1 - self.alpha) * self.src
            self.dst = self.alpha * dst + (1 - self.alpha) * self.dst

    def apply(self, rgb: np.ndarray) -> np.ndarray:
        import cv2

        if self.src is None or self.dst is None:
            return rgb
        lab = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
        k = np.clip(self.dst[1] / self.src[1], *self.ratio)
        lab = (lab - self.src[0]) * k + self.dst[0]
        out = cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_Lab2RGB)
        return np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8)
