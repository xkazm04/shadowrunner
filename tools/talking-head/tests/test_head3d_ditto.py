"""Round 5, H2 (Ditto): the pure parts - MediaPipe->68 mapping, blend, pose conversions, the track
file contract, motion statistics. No GPU, no Ditto env."""

from __future__ import annotations

import math

import numpy as np
import pytest

from th.experiments.head3d import ditto_shims as sh
from th.experiments.head3d import ditto_track as tr
from th.experiments.head3d.ditto_pose import euler, extremes, still_change


def test_mp_to_68_is_68_distinct_mesh_points():
    assert sh.MP_TO_68.shape == (68,)
    assert len(set(sh.MP_TO_68.tolist())) == 68
    assert sh.MP_TO_68.min() >= 0 and sh.MP_TO_68.max() < 478


def test_to68_keeps_upstream_crop_semantics():
    """iBUG roles upstream's parse_pt2_from_pt68 reads: nose tip 30, eye corners 36/39 (image
    left) and 42/45 (image right), mouth corners 48/54."""
    pts = np.zeros((478, 3), np.float32)
    pts[:, 0] = np.arange(478)
    p68 = sh.to68(pts)
    assert p68.shape == (68, 2)
    assert p68[30, 0] == 4 and p68[36, 0] == 33 and p68[45, 0] == 263
    assert p68[48, 0] == 61 and p68[54, 0] == 291


def test_box_of_is_upstream_detector_row():
    b = sh.box_of(np.array([[10, 20], [30, 5], [15, 40]], np.float32))
    assert b.shape == (1, 5)
    assert b[0].tolist() == [10, 5, 30, 40, 1]


def test_blend_matches_formula():
    m = np.array([[0.0, 1.0], [0.5, 0.25]], np.float32)
    warped = np.full((2, 2, 3), 200, np.float32)
    rgb = np.full((2, 2, 3), 100, np.uint8)
    res = np.empty((2, 2, 3), np.uint8)
    sh.blend_images_np(m, warped, rgb, res)
    assert res[..., 0].tolist() == [[100, 200], [150, 125]]


def test_bin66_degrees_and_passthrough():
    logits = np.full((1, 66), -1e4, np.float32)
    logits[0, 40] = 0
    assert sh.bin66_to_degree(logits)[0] == pytest.approx(40 * 3 - 97.5, abs=1e-3)
    assert sh.bin66_to_degree(np.array([[12.5]], np.float32))[0, 0] == 12.5
    assert sh.pose_of({"yaw": np.array([[1.0]]), "pitch": np.array([[2.0]]), "roll": np.array([[3.0]])}) \
        == (1.0, 2.0, 3.0)


def test_resample_identity_and_rate_change():
    x = np.arange(10, dtype=np.float32)[:, None]
    assert np.array_equal(tr.resample(x, 25), x)
    y = tr.resample(x, 50, 25)  # 10 samples at 50 fps = 0.18 s -> 5 samples at 25 fps
    assert y[:, 0].tolist() == [0, 2, 4, 6, 8]


def test_fit_length_pads_and_trims():
    x = np.arange(6, dtype=np.float32).reshape(3, 2)
    assert tr.fit_length(x, 3)[1] == "exact"
    p, how = tr.fit_length(x, 5)
    assert how == "padded 2" and p[-1].tolist() == [4, 5] and len(p) == 5
    t, how = tr.fit_length(x, 2)
    assert how == "trimmed 1" and len(t) == 2


def test_relative_removes_source_and_bias():
    rendered = np.array([[1.0, 13.0, 0.5]], np.float32)
    source = np.array([1.0, 11.0, 0.5], np.float32)
    assert tr.relative(rendered, source).tolist() == [[0.0, 0.0, 0.0]]  # pitch bias 2 removed


def test_export_writes_the_contract(tmp_path):
    n = 30
    rendered = np.stack([np.sin(np.arange(n) / 5) * 4, np.full(n, 11.0), np.zeros(n)], 1).astype(np.float32)
    source = np.tile(np.array([0.0, 9.0, 0.0], np.float32), (n, 1))
    pose = tmp_path / "pose.npz"
    np.savez(pose, rendered=rendered, source=source)
    out = tmp_path / "tracks" / "x.npz"
    rec = tr.export(pose, tmp_path / "a.wav", out, n_frames=32)
    assert rec["fit"] == "padded 2" and rec["frames"] == 32
    d = np.load(out)
    for k in ("yaw", "pitch", "roll"):
        assert d[k].dtype == np.float32 and d[k].shape == (32,)
    assert float(d["fps"]) == 25 and str(d["audio"]).endswith("a.wav")
    assert np.allclose(d["pitch"], 0) and np.allclose(d["yaw"][:n], rendered[:, 0], atol=1e-5)


def test_stats_on_a_known_sine():
    t = np.arange(250) / 25
    yaw = 4 * np.sin(2 * np.pi * 0.5 * t)
    s = tr.stats(np.stack([yaw, np.zeros_like(t), np.zeros_like(t)], 1))
    assert s["yaw"]["sd"] == pytest.approx(4 / math.sqrt(2), abs=0.05)
    # mean |d/dt| of A sin(wt) = 2 A w / pi = 2*4*pi/pi = 8 deg/s
    assert s["yaw"]["speedMean"] == pytest.approx(8, abs=0.2)
    assert s["pitch"]["sd"] == 0


def test_euler_round_trip():
    def rot(yaw, pitch, roll):
        y, p, r = map(math.radians, (yaw, pitch, roll))
        rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
        ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
        rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
        return rz @ ry @ rx

    assert euler(rot(10, -5, 3)) == pytest.approx((10, -5, 3), abs=1e-6)


def test_extremes_and_still_change():
    ypr = np.array([[0, 0, 0], [5, 1, 0], [-3, 2, 1], [np.nan] * 3, [1, -4, 0]], np.float64)
    e = extremes(ypr)
    assert e["yaw-max"] == 1 and e["yaw-min"] == 2 and e["pitch-min"] == 4 and e["pitch-max"] == 2
    frames = [np.zeros((4, 4, 3), np.uint8), np.full((4, 4, 3), 10, np.uint8)]
    assert still_change(iter(frames), (0, 2, 4, 4)) == 10.0


def test_docker_paths_map_through_mounts(tmp_path, monkeypatch):
    from th.experiments.head3d import ditto_docker as dd

    home = tmp_path / "th"
    (home / "live").mkdir(parents=True)
    monkeypatch.setenv("TH_HOME", str(home))
    out = tmp_path / "var" / "h2" / "x" / "online-trt"
    audio = tmp_path / "aud" / "a.wav"
    here, repo = tmp_path / "code", home / "repos" / "head3d-ditto"
    cmd = dd.run_cmd(["--source", str(home / "live" / "b.png"), "--out", str(out), "--audio", str(audio),
                      "--mode", "online"], audio, out, here, repo)
    assert cmd[:4] == ["docker", "run", "--rm", "--gpus"]
    assert "/th/live/b.png" in cmd and "/out/online-trt" in cmd and "/aud/a.wav" in cmd
    assert cmd[cmd.index("-w") + 1] == "/th/repos/head3d-ditto" and cmd[-2:] == ["--mode", "online"]
    with pytest.raises(ValueError):
        dd.to_container(tmp_path / "elsewhere", {home: "/th"})
