"""face transplant (flashhead-live round 4, P2): the similarity fit, the One-Euro smoother, the bust
crop framing and the jitter figures, without a GPU, MediaPipe or video."""

from __future__ import annotations

import math

import numpy as np
import pytest

from th.experiments.transplant import jitter
from th.experiments.transplant.crop import LIVE_FACE, bust_box
from th.experiments.transplant.fit import STABLE, OneEuro, Smoother, apply, params, similarity


def _sim(scale: float, deg: float, tx: float, ty: float) -> np.ndarray:
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[scale * c, -scale * s, tx], [scale * s, scale * c, ty]])


def test_similarity_recovers_a_known_transform() -> None:
    rng = np.random.default_rng(0)
    src = rng.uniform(0, 512, (20, 2))
    m = _sim(0.58, 4.0, 120.0, 40.0)
    fit = similarity(src, apply(m, src))
    assert np.allclose(fit, m, atol=1e-9)
    assert params(fit) == pytest.approx((0.58, 4.0, 120.0, 40.0))


def test_similarity_never_reflects() -> None:
    src = np.array([[0, 0], [1, 0], [0, 1], [1, 1]], float)
    dst = src * [-1, 1]  # a mirror image: the best rotation+scale is not a reflection
    fit = similarity(src, dst)
    assert np.linalg.det(fit[:, :2]) >= 0


def test_one_euro_holds_a_constant_and_follows_a_ramp() -> None:
    f = OneEuro(25.0, min_cutoff=1.0, beta=0.05)
    for _ in range(10):
        out = f(np.array([3.0, -2.0]))
    assert np.allclose(out, [3.0, -2.0])
    g = OneEuro(25.0, min_cutoff=1.0, beta=0.05)
    for t in range(200):
        out = g(np.array([t * 2.0]))  # 50 px/s
    assert abs(out[0] - 398.0) < 20  # lags a fast move a little, never runs away


def test_one_euro_cuts_frame_noise() -> None:
    rng = np.random.default_rng(1)
    f = OneEuro(25.0, min_cutoff=1.0, beta=0.05)
    noisy = 100 + rng.normal(0, 1.0, (250, 1))
    out = np.array([f(x) for x in noisy])
    assert np.std(np.diff(out[50:, 0])) < 0.35 * np.std(np.diff(noisy[50:, 0]))


def test_smoother_holds_the_last_transform_and_counts_it() -> None:
    sm = Smoother((512, 512))
    assert sm.step(None) is None and sm.held == 0  # nothing to hold before the first fit
    m = _sim(0.6, 2.0, 100.0, 50.0)
    first = sm.step(m)
    assert np.allclose(first, m)
    assert np.allclose(sm.step(None), first)
    assert sm.held == 1


def test_smoother_disabled_passes_fits_through() -> None:
    sm = Smoother((512, 512), enabled=False)
    a, b = _sim(0.6, 0.0, 0.0, 0.0), _sim(0.6, 5.0, 10.0, 0.0)
    sm.step(a)
    assert np.allclose(sm.step(b), b)


def test_bust_box_puts_the_face_where_the_live_crop_has_it() -> None:
    face = (400.0, 210.0, 630.0, 468.0)
    x0, y0, x1, y1 = bust_box(face, (1024, 1536))
    side = x1 - x0
    assert side == y1 - y0
    assert (face[0] - x0) / side == pytest.approx(LIVE_FACE[0], abs=0.01)
    assert (face[1] - y0) / side == pytest.approx(LIVE_FACE[1], abs=0.01)


def test_bust_box_stays_inside_the_image() -> None:
    x0, y0, x1, y1 = bust_box((5.0, 5.0, 200.0, 220.0), (1024, 1536))
    assert x0 == 0 and y0 == 0 and x1 <= 1024 and y1 <= 1536


def _faces(t: int, offset: np.ndarray | None = None) -> np.ndarray:
    lms = np.zeros((t, 478, 2))
    lms[:, jitter.FOREHEAD] = (0, 0)
    lms[:, jitter.CHIN] = (0, 100)
    rng = np.random.default_rng(2)
    base = rng.uniform(0, 100, (len(STABLE), 2))
    for k in range(t):
        lms[k, list(STABLE)] = base + (k * 0.5, 0)  # the head drifts 0.5 px per frame
    if offset is not None:
        lms[:, list(STABLE)] += offset
    return lms


def test_jitter_reads_a_still_paste_as_still() -> None:
    clip = _faces(50)
    s = jitter.stats(clip, _faces(50, offset=np.array([1.0, 0.0])))
    assert s["offset"]["px"] == pytest.approx(1.0)
    assert s["slide"]["px"] == pytest.approx(0.0, abs=1e-9)
    assert s["headSpeedMedian"]["px"] == pytest.approx(0.5)
    assert s["faceHeightPx"] == 100.0


def test_jitter_sees_a_sliding_face() -> None:
    clip = _faces(50)
    wobble = np.zeros((50, 1, 2))
    wobble[::2, 0, 0] = 2.0  # the paste flips 2 px left and right every frame
    s = jitter.stats(clip, clip + wobble)
    assert s["slide"]["px"] == pytest.approx(2.0)
    assert s["highpass"]["px"] == pytest.approx(2.0)


def test_fastest_finds_the_biggest_head_move() -> None:
    clip = _faces(30)
    clip[17:, list(STABLE)] += (12.0, 0.0)
    assert jitter.fastest(clip) == 17
