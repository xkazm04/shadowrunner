"""face transplant (flashhead-live round 4, P2): the paste mask, the colour match and one composited
frame on a synthetic face (landmarks drawn on an ellipse), without MediaPipe or video."""

from __future__ import annotations

import math

import numpy as np
import pytest

from th.experiments.transplant import mask
from th.experiments.transplant.composite import paste, warp
from th.experiments.transplant.fit import params


def synthetic_face(cx: float = 100.0, cy: float = 110.0, rx: float = 40.0, ry: float = 55.0
                   ) -> np.ndarray:
    """478 landmarks: the oval on an ellipse (forehead at the top), eyes, nose, chin and brows."""
    pts = np.tile([cx, cy], (478, 1)).astype(np.float64)
    n = len(mask.OVAL)
    for k, i in enumerate(mask.OVAL):
        a = -math.pi / 2 + 2 * math.pi * k / n  # 10 at the top, then clockwise on screen
        pts[i] = (cx + rx * math.cos(a), cy + ry * math.sin(a))
    pts[168] = (cx, cy - 0.35 * ry)
    pts[mask.NOSE_TIP] = (cx, cy + 0.05 * ry)
    pts[234], pts[454] = (cx - rx, cy - 0.2 * ry), (cx + rx, cy - 0.2 * ry)
    for k, i in enumerate(mask.BROWS):
        pts[i] = (cx - 0.6 * rx + 1.2 * rx * k / 9, cy - 0.5 * ry)
    return pts


def test_polygon_grows_below_the_nose_and_shrinks_above() -> None:
    pts = synthetic_face()
    poly = mask.polygon(pts, mask.MaskCfg())
    oval = pts[list(mask.OVAL)]
    centre = oval.mean(0)
    r_old = np.linalg.norm(oval - centre, axis=1)
    r_new = np.linalg.norm(poly - centre, axis=1)
    chin = list(mask.OVAL).index(mask.CHIN)
    forehead = list(mask.OVAL).index(10)
    assert r_new[chin] > r_old[chin]
    assert r_new[forehead] < r_old[forehead]


def test_hard_mask_is_cut_above_the_brows() -> None:
    pts = synthetic_face()
    cfg = mask.MaskCfg()
    hard = mask.hard_mask((200, 220), [mask.polygon(pts, cfg)], mask.brow_cut(pts, cfg))
    brow_y = pts[list(mask.BROWS)][:, 1].min()
    rows = np.nonzero(hard.any(1))[0]
    assert rows.min() >= brow_y - 0.05 * 110 - 1  # nothing much above the brow line
    assert hard[int(pts[mask.CHIN][1]), 100] == 1  # the chin is in


def test_inset_and_band() -> None:
    hard = np.zeros((60, 60), np.uint8)
    hard[10:50, 10:50] = 1
    assert mask.inset(hard, 5).sum() < hard.sum()
    ring = mask.band(hard, 5)
    assert ring[10, 30] and not ring[30, 30] and not ring[5, 30]


def test_colour_match_moves_the_statistics() -> None:
    rng = np.random.default_rng(0)
    src = np.clip(rng.normal(150, 20, (40, 40, 3)), 0, 255).astype(np.uint8)
    dst = np.clip(rng.normal(110, 20, (40, 40, 3)), 0, 255).astype(np.uint8)
    every = np.ones((40, 40), bool)
    cm = mask.ColourMatch()
    cm.update(mask.lab_stats(src, every), mask.lab_stats(dst, every))
    out = cm.apply(src)
    assert abs(float(out.mean()) - float(dst.mean())) < 3
    assert mask.lab_stats(src, np.zeros((40, 40), bool)) is None


def test_colour_match_without_statistics_is_identity() -> None:
    img = np.full((4, 4, 3), 77, np.uint8)
    assert np.array_equal(mask.ColourMatch().apply(img), img)


def test_warp_identity_keeps_the_frame() -> None:
    rng = np.random.default_rng(3)
    img = rng.integers(0, 255, (50, 60, 3), dtype=np.uint8)
    m = np.array([[1.0, 0, 0], [0, 1.0, 0]])
    assert np.abs(warp(img, m, (60, 50)).astype(int) - img).max() <= 1


def test_warp_downscale_lands_where_the_transform_says() -> None:
    img = np.zeros((100, 100, 3), np.uint8)
    img[40:60, 40:60] = 255
    m = np.array([[0.5, 0, 10], [0, 0.5, 20]])
    assert params(m)[0] == pytest.approx(0.5)
    out = warp(img, m, (80, 80))
    ys, xs = np.nonzero(out[..., 0] > 127)
    assert (xs.mean(), ys.mean()) == pytest.approx((10 + 25, 20 + 25), abs=1.0)


def test_paste_replaces_the_face_and_nothing_else() -> None:
    rng = np.random.default_rng(4)
    clip = rng.integers(60, 120, (220, 200, 3), dtype=np.uint8)
    fh = rng.integers(140, 200, (220, 200, 3), dtype=np.uint8)
    face = synthetic_face()
    m = np.array([[1.0, 0, 0], [0, 1.0, 0]])
    out, alpha = paste(clip, fh, face, face, m, mask.MaskCfg(), mask.ColourMatch(alpha=1.0))
    assert alpha[int(face[mask.NOSE_TIP][1]), 100] > 0.95
    outside = alpha == 0
    assert outside[5, 5] and np.array_equal(out[outside], clip[outside])
    inner = alpha > 0.99
    assert not np.array_equal(out[inner], clip[inner])  # the pasted texture, not the clip's


def test_clip_eyes_cuts_holes_over_the_eyes_only() -> None:
    face = synthetic_face()
    for k, i in enumerate(mask.EYES[0]):  # a small eye contour, screen-left
        a = 2 * math.pi * k / len(mask.EYES[0])
        face[i] = (85 + 8 * math.cos(a), 95 + 3 * math.sin(a))
    for k, i in enumerate(mask.EYES[1]):
        a = 2 * math.pi * k / len(mask.EYES[1])
        face[i] = (115 + 8 * math.cos(a), 95 + 3 * math.sin(a))
    holes = mask.eye_holes(face, (200, 220), mask.MaskCfg())
    assert holes[95, 85] == 1 and holes[95, 115] == 1
    assert holes[int(face[mask.NOSE_TIP][1]), 100] == 0
    rng = np.random.default_rng(5)
    clip = rng.integers(60, 120, (220, 200, 3), dtype=np.uint8)
    fh = rng.integers(140, 200, (220, 200, 3), dtype=np.uint8)
    m = np.array([[1.0, 0, 0], [0, 1.0, 0]])
    cfg = mask.MaskCfg(clip_eyes=True)
    _, alpha = paste(clip, fh, face, face, m, cfg, mask.ColourMatch())
    assert alpha[95, 85] < 0.2 and alpha[int(face[mask.NOSE_TIP][1]), 100] > 0.9
