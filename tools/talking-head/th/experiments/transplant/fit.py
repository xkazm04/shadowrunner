"""The FlashHead-to-EchoMimicV3 face transform: a least-squares similarity fit (Umeyama, no
reflection) on landmarks that do not move with speech, and a causal One-Euro filter over it.

The filter smooths where the transform puts three fixed anchor points of the FlashHead frame (its
centre and two points a face-width away), in destination pixels, then refits the similarity from
those: smoothing pixel positions keeps rotation and translation consistent (filtering the matrix
entries separately makes the face drift when the head turns). A frame without a fit holds the last
transform. Causal, so the same filter runs live.

Tuning (P2 probe, both clips): the per-frame fit is already steady (MediaPipe's VIDEO mode tracks),
so a heavy filter only adds lag while the clip's head moves: min_cutoff 1 Hz / beta 0.05 doubled
the face's slide on the head (0.68 px/frame against 0.31 unfiltered); 3 Hz / beta 1.0 keeps it at
0.38-0.41 and still damps frame-rate noise. Optical flow cannot tell any setting from the clip alone.
"""

from __future__ import annotations

import math

import numpy as np

# MediaPipe face mesh (478 points): eye corners, nose bridge and tip, nostrils, the face sides at
# eye level, the temples and the glabella/forehead centre. No lips, jaw or chin (they move with
# speech), no brows (expression).
STABLE = (33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 98, 327, 234, 454, 127, 356, 93, 323, 9, 151)


def similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """2x3 matrix M (scale, rotation, translation) minimising |M [src;1] - dst|^2. (N,2) inputs."""
    src = np.asarray(src, np.float64)
    dst = np.asarray(dst, np.float64)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    cov = b.T @ a / len(src)
    u, d, vt = np.linalg.svd(cov)
    s = np.eye(2)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        s[1, 1] = -1
    r = u @ s @ vt
    var = (a ** 2).sum() / len(src)
    scale = float(np.trace(np.diag(d) @ s) / var) if var > 0 else 1.0
    m = np.zeros((2, 3))
    m[:, :2] = scale * r
    m[:, 2] = md - scale * r @ ms
    return m


def apply(m: np.ndarray, pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, np.float64)
    return pts @ m[:, :2].T + m[:, 2]


def params(m: np.ndarray) -> tuple[float, float, float, float]:
    """(scale, rotation degrees, tx, ty) of a similarity matrix."""
    return (float(math.hypot(m[0, 0], m[1, 0])), float(math.degrees(math.atan2(m[1, 0], m[0, 0]))),
            float(m[0, 2]), float(m[1, 2]))


class OneEuro:
    """One-Euro filter (Casiez et al. 2012) on a vector, at a fixed rate."""

    def __init__(self, rate: float, min_cutoff: float = 1.0, beta: float = 0.05,
                 d_cutoff: float = 1.0) -> None:
        self.rate, self.min_cutoff, self.beta, self.d_cutoff = rate, min_cutoff, beta, d_cutoff
        self.x: np.ndarray | None = None
        self.dx: np.ndarray | None = None

    def _alpha(self, cutoff: np.ndarray | float) -> np.ndarray | float:
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau * self.rate)

    def __call__(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, np.float64)
        if self.x is None:
            self.x, self.dx = x.copy(), np.zeros_like(x)
            return x.copy()
        dx = (x - self.x) * self.rate
        a_d = self._alpha(self.d_cutoff)
        self.dx = a_d * dx + (1 - a_d) * self.dx
        cutoff = self.min_cutoff + self.beta * np.abs(self.dx)
        a = self._alpha(cutoff)
        self.x = a * x + (1 - a) * self.x
        return self.x.copy()


class Smoother:
    """Smooths a stream of similarity transforms from a `size`-sized source frame (w, h)."""

    def __init__(self, size: tuple[int, int], rate: float = 25.0, min_cutoff: float = 3.0,
                 beta: float = 1.0, enabled: bool = True) -> None:
        w, h = size
        c = np.array([w / 2, h / 2])
        self.anchors = np.array([c, c + (w / 4, 0), c + (0, h / 4)])
        self.filter = OneEuro(rate, min_cutoff, beta)
        self.enabled = enabled
        self.last: np.ndarray | None = None
        self.held = 0

    def step(self, m: np.ndarray | None) -> np.ndarray | None:
        """The smoothed transform for this frame; None only before the first fit."""
        if m is None:
            self.held += self.last is not None
            return self.last
        if not self.enabled:
            self.last = m
            return m
        q = self.filter(apply(m, self.anchors).ravel()).reshape(-1, 2)
        self.last = similarity(self.anchors, q)
        return self.last
