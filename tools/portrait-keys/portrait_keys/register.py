"""Registration of an edit to its portrait (design "Builder" step 2): ECC affine on half-size greys."""
from __future__ import annotations

import cv2
import numpy as np

from .common import grey


def register(portrait: np.ndarray, edit: np.ndarray, mask: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, float]:
    """Returns the edit warped onto the portrait, the 2 x 3 affine (portrait px -> edit px, full
    size) and the largest corner shift in px. `mask` (portrait frame, 1 = use) leaves out what the
    edit was asked to change, or a ground it replaced."""
    h, w = portrait.shape[:2]
    a = cv2.resize(grey(portrait), (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    b = cv2.resize(grey(edit), (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    m = None
    if mask is not None:
        m = (cv2.resize(mask.astype(np.float32), (w // 2, h // 2), interpolation=cv2.INTER_AREA) > 0.99).astype(np.uint8)
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-7)
    _, warp = cv2.findTransformECC(a, b, warp, cv2.MOTION_AFFINE, crit, m, 5)
    full = warp.astype(np.float64).copy()
    A = full[:, :2]
    # half-size px x_h = x/2 - 0.25 (area resize): x_edit = A x + 2t + 0.5 (1 - A 1)
    full[:, 2] = 2.0 * full[:, 2] + 0.5 * (1.0 - A.sum(axis=1))
    out = cv2.warpAffine(edit, full, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    corners = np.array([[0, 0], [w, 0], [0, h], [w, h]], np.float64)
    moved = corners @ A.T + full[:, 2]
    shift = float(np.linalg.norm(moved - corners, axis=1).max())
    return out.astype(np.float32), full, shift
