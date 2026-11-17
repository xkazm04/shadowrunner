"""head3d H1: the statistical rotation track, the track file contract, and the LivePortrait bridge's
crop / paste geometry (no weights, no GPU)."""

from __future__ import annotations

import numpy as np
import pytest

from th.experiments.head3d import track_stats as ts
from th.experiments.head3d.lp_bridge import _grid, crop_transform
from th.experiments.head3d.lp_measure import euler
from th.experiments.head3d.lp_sheet import extremes


def _speechy(seconds: float, seed: int = 3) -> np.ndarray:
    """Voiced-like audio: a 140-220 Hz glottal tone with syllable envelopes and pauses."""
    t = np.arange(int(seconds * ts.RATE)) / ts.RATE
    f0 = 170 + 40 * np.sin(2 * np.pi * 0.37 * t) + 15 * np.sin(2 * np.pi * 1.3 * t)
    tone = np.sign(np.sin(2 * np.pi * np.cumsum(f0) / ts.RATE)) * 0.3
    syll = np.clip(np.sin(2 * np.pi * 4.1 * t), 0, None) ** 0.5
    gate = (np.sin(2 * np.pi * 0.21 * t + 1) > -0.6).astype(float)
    loud = 1 + 1.5 * (np.sin(2 * np.pi * 0.29 * t + seed) > 0.7)  # emphasis
    return (tone * syll * gate * loud * 0.25).astype(np.float32)


def test_track_is_chunk_invariant_and_deterministic():
    audio = _speechy(12.0)
    whole = ts.track_for(audio, seed=5)
    for step in (333, 640, 7001, 15360):
        st = ts.StatTrack(seed=5)
        parts = [st.feed(audio[i:i + step]) for i in range(0, len(audio), step)]
        np.testing.assert_array_equal(np.concatenate(parts), whole)
    assert len(whole) == len(audio) // ts.HOP
    other = ts.track_for(audio, seed=6)
    assert np.abs(other - whole).max() > 0.5  # the seed matters


def test_track_statistics_in_speech_and_silence():
    audio = _speechy(40.0)
    tr = ts.track_for(audio, seed=1)
    s = ts.stats(tr[50:])
    assert 2.0 <= s["yaw"]["sd"] <= 6.0
    assert s["pitch"]["sd"] < s["yaw"]["sd"] and s["roll"]["sd"] < s["yaw"]["sd"]
    assert s["yaw"]["max"] <= 14.0 and s["pitch"]["max"] <= 8.0 and s["roll"]["max"] <= 6.0
    assert 3.0 <= s["speed"] <= 14.0
    quiet = ts.stats(ts.track_for(np.zeros(20 * ts.RATE, np.float32), seed=1)[50:])
    assert quiet["yaw"]["sd"] < s["yaw"]["sd"] and quiet["speed"] < s["speed"]


def test_track_is_smooth_and_not_periodic():
    tr = ts.track_for(_speechy(60.0), seed=2)
    acc = np.abs(np.diff(tr, 2, axis=0)) * ts.FPS * ts.FPS
    assert np.percentile(acc, 99) < 150  # deg/s^2: no frame-to-frame jitter
    y = tr[:, 0] - tr[:, 0].mean()
    ac = np.correlate(y, y, "full")[len(y) - 1:]
    ac = ac / ac[0]
    # no strong repeat at any lag from 2 s to 20 s
    assert ac[50:500].max() < 0.6


def test_track_npz_contract(tmp_path):
    tr = ts.track_for(_speechy(3.0), seed=1)
    p = tmp_path / "t.npz"
    ts.save_npz(p, tr, "C:/x/speech.wav")
    d = np.load(p)
    assert {"yaw", "pitch", "roll", "fps", "audio"} <= set(d.files)
    assert d["yaw"].dtype == np.float32 and float(d["fps"]) == 25 and str(d["audio"]) == "C:/x/speech.wav"
    np.testing.assert_array_equal(ts.load_npz(p), tr)


def _face_points(cx: float, cy: float, angle_deg: float) -> np.ndarray:
    """478 points: a 120x150 box of face points with eyes and mouth corners at their indices."""
    rng = np.random.default_rng(0)
    pts = np.stack([rng.uniform(-60, 60, 478), rng.uniform(-75, 75, 478)], 1)
    pts[[33, 133]] = [[-45, -20], [-15, -20]]
    pts[[362, 263]] = [[15, -20], [45, -20]]
    pts[[61, 291]] = [[-20, 40], [20, 40]]
    pts[0], pts[1] = [-60, -75], [60, 75]
    a = np.deg2rad(angle_deg)
    rot = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    return pts @ rot.T + [cx, cy]


@pytest.mark.parametrize("angle", [0.0, 7.0, -12.0])
def test_crop_transform_upright_and_centred(angle):
    pts = _face_points(250, 230, angle)
    m = crop_transform(pts, dsize=512, scale=2.3, vy=-0.125)
    eye = (pts[[33, 133]].mean(0) + pts[[362, 263]].mean(0)) / 2
    mouth = pts[[61, 291]].mean(0)
    e, mo = (m @ [*eye, 1])[:2], (m @ [*mouth, 1])[:2]
    assert abs(e[0] - mo[0]) < 1e-6 and mo[1] > e[1]  # eye-to-mouth axis vertical, mouth below
    s = np.sqrt(abs(np.linalg.det(m[:2, :2])))
    assert s == pytest.approx(512 / (150 * 2.3), rel=1e-6)  # square side = 2.3x the larger extent
    # the extent centre lands 12.5 % of the side below the crop centre (vy -0.125 shifts up the face)
    c = (m @ [250, 230, 1])[:2]
    assert c[0] == pytest.approx(256, abs=1e-6) and c[1] == pytest.approx(256 + 0.125 * 512, abs=1e-6)


def test_grid_round_trip_is_identity():
    torch = pytest.importorskip("torch")
    import torch.nn.functional as F

    pts = _face_points(256, 240, 4.0)
    m = crop_transform(pts, dsize=512)
    yy, xx = torch.meshgrid(torch.arange(512.0), torch.arange(512.0), indexing="ij")
    img = torch.stack([torch.sin(xx / 23) * torch.cos(yy / 31), xx / 512, yy / 512])[None]
    crop = F.grid_sample(img, _grid(np.linalg.inv(m), (512, 512), (512, 512)), align_corners=False)
    back = F.grid_sample(crop, _grid(m, (512, 512), (512, 512)), align_corners=False)
    inner = (slice(None), slice(None), slice(150, 350), slice(150, 350))  # inside the crop's footprint
    assert (back[inner] - img[inner]).abs().max() < 0.01
    # the crop's centre pixel samples the frame at inv(m) @ (255.5, 255.5)
    cx, cy = (np.linalg.inv(m) @ [255.5, 255.5, 1])[:2]
    g = _grid(np.linalg.inv(m), (512, 512), (512, 512))
    assert float(g[0, 255, 255, 0]) == pytest.approx((cx - 0.5 + 0.5) / 512 * 2 - 1, abs=0.01)


def test_euler_from_rotation():
    a = np.deg2rad(10.0)
    ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    y, p, r = euler(np.pad(ry, ((0, 1), (0, 1))))
    assert y == pytest.approx(10.0) and abs(p) < 1e-9 and abs(r) < 1e-9


def test_extremes_pick_track_ends():
    tr = np.zeros((100, 3), np.float32)
    tr[10, 0], tr[20, 0], tr[30, 1], tr[40, 1] = -9, 8, -3, 4
    assert [i for _, i in extremes(tr)] == [10, 20, 30, 40]


def test_grid_sample_3d_matches_torch():
    torch = pytest.importorskip("torch")
    import torch.nn.functional as F

    from th.experiments.head3d.lp_trt import grid_sample_3d

    g = torch.Generator().manual_seed(0)
    inp = torch.randn(2, 3, 4, 5, 6, generator=g)
    grid = torch.rand(2, 3, 4, 5, 3, generator=g) * 2.4 - 1.2  # some samples fall outside: zeros padding
    ref = F.grid_sample(inp, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
    assert torch.allclose(grid_sample_3d(inp, grid), ref, atol=1e-5)
