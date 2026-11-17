"""Head motion (th/live/motion.py): determinism, levels, nods and tilts from the audio, the warp on
frames and alpha, and the no-border check (round 3)."""

from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch")
import torch.nn.functional as F  # noqa: E402

from th.live.motion import HOP, ZOOM, Motion, _inverse_theta, fit, warp  # noqa: E402

SLICE = 24 * HOP


def speech(seconds: float, seed: int = 0) -> np.ndarray:
    """Syllable-like bursts (4 per second) with a pause every 2 s."""
    t = np.arange(int(seconds * 16000)) / 16000
    env = (np.sin(2 * np.pi * 4 * t) > 0.2).astype(np.float32)
    env[(t % 2.0) > 1.7] = 0
    noise = np.random.default_rng(seed).standard_normal(len(t)).astype(np.float32)
    return 0.1 * env * noise


def run(m: Motion, audio: np.ndarray, sentences=None) -> np.ndarray:
    n = len(audio) // SLICE
    out = []
    for k in range(n):
        m.feed(k * 24, audio[k * SLICE:(k + 1) * SLICE], (sentences or {}).get(k, []))
        out.append(m.get(k * 24, 24))  # the engine reads each chunk right after feeding it
    return np.concatenate(out)


def test_deterministic_for_a_seed_and_independent_of_how_it_is_fed():
    a = speech(10)
    p1 = run(Motion("natural", 7), a, sentences={0: [0.0], 4: [300.0]})
    p2 = run(Motion("natural", 7), a, sentences={0: [0.0], 4: [300.0]})
    assert np.array_equal(p1, p2)
    m = Motion("natural", 7)  # two long feeds instead of ten chunks
    m.feed(0, a[:4 * SLICE], [0.0])
    first = m.get(0, 96)
    m.feed(96, a[4 * SLICE:10 * SLICE], [300.0])
    assert np.array_equal(np.concatenate([first, m.get(96, 144)]), p1)
    assert not np.array_equal(run(Motion("natural", 8), a), run(Motion("natural", 7), a))


def test_levels_off_is_identity_and_lively_is_about_1_6x_natural():
    a = speech(12)
    off = run(Motion("off", 1), a)
    assert np.array_equal(off, np.tile(np.array([0, 0, 0, 1, 0], np.float32), (len(off), 1)))
    nat, liv = run(Motion("natural", 1), a), run(Motion("lively", 1), a)
    r = lambda p, c: np.percentile(p[:, c], 95) - np.percentile(p[:, c], 5)  # noqa: E731
    for c in (0, 1, 2):
        assert r(liv, c) / r(nat, c) == pytest.approx(1.6, rel=0.02)
    assert 1.0 < r(nat, 2) < 4.0 and 2.0 < r(nat, 0) < 12.0  # degrees and px: small and natural


def test_nods_follow_onsets_with_a_refractory_period_and_idle_has_none():
    m = Motion("natural", 3)
    run(m, np.concatenate([speech(8), np.zeros(16000 * 12, np.float32)]))
    nods = [i for i, kind in m.events if kind == "nod"]
    assert len(nods) >= 8 and min(np.diff(nods)) >= 20  # 0.8 s at 25 fps
    assert all(i < 8 * 25 + 5 for i in nods)  # none in the silence
    assert any(kind == "idle-tilt" for i, kind in m.events if i > 8 * 25)


def test_level_change_eases_instead_of_jumping():
    a = speech(6)
    m = Motion("lively", 2)
    m.feed(0, a[:SLICE * 2])
    head = m.get(0, 48)
    m.set_level("off")
    m.feed(48, a[SLICE * 2:SLICE * 6])
    p = np.concatenate([head, m.get(48, 96)])  # the generator keeps the last 4 s only
    zw = p[:, 4]  # min(1, eased gain): falls over about half a second, never in one step
    assert zw[47] == 1.0 and 0 < zw[52] < 1 and zw[48 + 13] == 0
    assert np.abs(np.diff(zw)).max() <= 1.6 / 12.5 + 1e-6
    assert np.array_equal(p[-24:], np.tile(np.array([0, 0, 0, 1, 0], np.float32), (24, 1)))
    assert m.idle(120, 24) and not m.idle(48, 24)


def _marker(size: int = 128) -> np.ndarray:
    f = np.full((2, size, size, 3), 60, np.uint8)
    f[:, 40:44, 60:64] = 255
    return f


def test_warp_moves_frame_and_alpha_together():
    f = _marker()
    al = np.zeros((2, 128, 128), np.uint8)
    al[:, 40:44, 60:64] = 255
    p = np.array([[0, 0, 0, 1, 0], [10 * 512 / 128, 0, 0, 1, 0]], np.float32)  # dx = 10 px at 128
    out, oal, _ = warp(f, p, al, matte=True)
    assert np.array_equal(out[0], f[0]) and np.array_equal(oal[0], al[0])  # identity is exact
    ys, xs = np.nonzero(out[1, :, :, 0] > 200)
    assert xs.min() == 70 and ys.min() == 40
    ys2, xs2 = np.nonzero(oal[1] > 200)
    assert (xs2.min(), ys2.min()) == (70, 40)
    r, _, _ = warp(f, np.array([[0, 0, 3.0, 1, 0]] * 2, np.float32), al, matte=True)
    assert not np.array_equal(r[0], f[0])


def _grid(p: np.ndarray, size: int, zoom: float):
    th = torch.as_tensor(_inverse_theta(p, size, size, zoom), dtype=torch.float32)
    return F.affine_grid(th, [len(p), 3, size, size], align_corners=False)


@pytest.mark.parametrize("level,boost", [("natural", 1.0), ("lively", 1.0), ("lively", 3.0)])
def test_no_border_without_a_matte(level, boost):
    size = 512
    p = run(Motion(level, 5), speech(20), sentences={k: [0.0] for k in range(0, 20, 3)}) * np.array(
        [boost, boost, boost, 1, 1], np.float32)
    p[:, 3] = 1 + (p[:, 3] - 1) * boost
    fitted = fit(p, size, size, ZOOM)
    lim = 1 - 1 / size + 1e-6
    assert float(_grid(fitted, size, ZOOM).abs().max()) <= lim  # every sample inside the source
    if boost > 1:  # the check has teeth: unfitted, these transforms would show the border
        assert float(_grid(p, size, ZOOM).abs().max()) > lim
    # on pixels: a constant frame sampled with zero padding keeps its value everywhere
    frames = torch.full((len(fitted[:48]), 3, size, size), 200.0)
    out = F.grid_sample(frames, _grid(fitted[:48], size, ZOOM), mode="bilinear", padding_mode="zeros",
                        align_corners=False)
    assert float(out.min()) > 199.9
    rgb, _, applied = warp(np.full((48, size, size, 3), 200, np.uint8), p[:48])
    assert rgb.min() == 200 and np.allclose(applied, fitted[:48])


def test_numpy_path_matches_torch_grid_sample():
    rng = np.random.default_rng(0)
    f = rng.integers(0, 256, (3, 64, 64, 3), dtype=np.uint8)
    al = rng.integers(0, 256, (3, 64, 64), dtype=np.uint8)
    p = np.array([[3, -2, 1.5, 1.01, 1], [0, 0, 0, 1, 0], [-6, 4, -2.5, 0.99, 0.5]], np.float32)
    for matte in (False, True):
        rgb, a, applied = warp(f, p, al, matte=matte)
        ref, ra, _ = warp(torch.from_numpy(f), p, torch.from_numpy(al), matte=matte)
        assert np.abs(rgb.astype(int) - ref.numpy()).max() <= 1
        assert np.abs(a.astype(int) - ra.numpy()).max() <= 1
