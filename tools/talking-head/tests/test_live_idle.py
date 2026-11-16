"""`th live make-idle` pieces without a GPU: candidate tracks, the loop picker, the wrap fade, and
the seam / blink figures (synthetic tracks, no MediaPipe)."""

from __future__ import annotations

import numpy as np

from th.live import idle, measure
from th.live.compose import load_loop
from th.live.measure import Track


def test_candidate_tracks_without_kokoro_are_quiet_and_sized():
    tr = idle.candidate_tracks(10.0)
    assert set(tr) == {"silence", "breaths", "hums"}
    for name, x in tr.items():
        assert x.dtype == np.float32 and len(x) == 10 * idle.RATE and np.abs(x).max() <= 1.0
    assert not tr["silence"].any()
    assert 0 < np.abs(tr["hums"]).max() < 0.5 and 0 < np.abs(tr["breaths"]).max() < 0.5
    calls: list[str] = []
    k = idle.candidate_tracks(10.0, lambda t: calls.append(t) or np.full(4000, 0.1, np.float32))
    assert {"kokoro-mm", "kokoro-phrases", "mm-sparse", "hummed-speech"} <= set(k)
    assert set(idle.KOKORO_MM) <= set(calls)


def _track(n: int, gap: np.ndarray, thumbs: np.ndarray) -> Track:
    nose = np.stack([np.linspace(0, 2, n), np.zeros(n)], 1).astype(np.float32)
    return Track(nose, gap.astype(np.float32), np.full(n, 0.3, np.float32), np.full(n, 80, np.float32),
                 thumbs.astype(np.float32))


def test_pick_loop_keeps_the_mouth_closed_and_finds_the_matching_wrap():
    n = 120
    phase = np.arange(n) * 2 * np.pi / 40  # a 40-frame cycle: frame a+40 matches frame a
    thumbs = np.stack([np.sin(phase + j) for j in range(16)], 1) * 10
    gap = np.zeros(n)
    gap[100:] = 8.0  # mouth open at the end: never inside the loop
    span = measure.pick_loop(_track(n, gap, thumbs), 30, 60, skip=5)
    assert span is not None and span["end"] <= 100 and span["start"] >= 5
    assert span["wrapOverMedian"] <= 1.05  # last frame -> first steps like any other pair
    assert span["frames"] % 40 == 0 and span["mismatchOverMedian"] < 0.05  # b is a's twin
    assert measure.pick_loop(_track(n, np.full(n, 9.0), thumbs), 30, 60) is None


def test_loop_frames_fade_the_tail_into_the_frames_before_the_start():
    f = np.stack([np.full((4, 4, 3), v, np.uint8) for v in range(0, 200, 10)])  # 20 frames
    loop = idle.loop_frames(f, 8, 18)
    assert len(loop) == 10 and (loop[:4] == f[8:12]).all()
    w = (np.arange(6) + 1) / 6
    want = np.rint(f[12:18, 0, 0, 0] * (1 - w) + f[2:8, 0, 0, 0] * w)
    assert loop[4:, 0, 0, 0].tolist() == want.tolist()
    assert loop[-1, 0, 0, 0] == f[7, 0, 0, 0]  # ends on the frame before a: the wrap is a real step
    assert (idle.loop_frames(f, 2, 10) == f[2:10]).all()  # no lead-in frames: no fade


def test_seam_stats_separates_boundary_steps():
    n = 96
    t = np.zeros((n, 4), np.float32)
    level = 0.0
    for i in range(n):
        level += 5.0 if i % 24 == 0 and i else 1.0
        t[i] = level
    s = measure.seam_stats(t)
    assert s["seams"] == 3 and s["seamStep"] == 5.0 and s["nonSeamStep"] == 1.0
    sp = measure.seam_stats(t, spans=[(20, 30)])
    assert sp["seams"] == 1


def test_blinks_count_dips_once():
    eye = np.full(100, 0.3)
    eye[10:13] = 0.1
    eye[50:52] = 0.12
    assert measure.blinks(eye) == 2


def test_load_loop_checks_size_and_switch(tmp_path, monkeypatch):
    p = tmp_path / "loop.npz"
    np.savez(p, frames=np.zeros((5, 16, 16, 3), np.uint8))
    assert load_loop(16, p).shape == (5, 16, 16, 3)
    assert load_loop(32, p) is None
    assert load_loop(16, tmp_path / "missing.npz") is None
    monkeypatch.setenv("TH_LIVE_IDLE", "0")
    assert load_loop(16, p) is None


def test_splice_cuts_out_open_mouth_frames_and_crossfades_every_junction():
    n = 200
    f = np.stack([np.full((4, 4, 3), i % 250, np.uint8) for i in range(n)])
    gap = np.zeros(n)
    gap[80:90] = 9.0  # one open-mouth sound
    gap[140:150] = 9.0
    f[..., 1] = 0
    f[80:90, :, :, 1] = 255  # mark the open-mouth frames in the green channel
    f[140:150, :, :, 1] = 255
    loop, junctions = idle.splice_frames(f, gap, skip=10, max_len=150, min_len=100)
    vals = loop[:, 0, 0, 0].astype(int)
    assert loop[:, 0, 0, 1].max() == 0  # no open-mouth frame, not even mixed into a crossfade
    assert len(junctions) == 3 and 100 <= len(loop) <= 150  # two cuts plus the wrap
    assert vals[0] == 10 + idle.SPLICE_MARGIN + idle.WRAP_FADE  # starts after the wrap's fade
    assert abs(vals[-1] - (vals[0] - 1)) < abs(vals[-2] - (vals[0] - 1))  # the end fades into the start
    assert idle.splice_frames(f, np.zeros(n), skip=10, max_len=150, min_len=100) is None  # one run


def test_splice_rotation_puts_the_wrap_on_a_plain_source_step():
    n = 200
    f = np.stack([np.full((4, 4, 3), i, np.uint8) for i in range(n)])
    gap = np.zeros(n)
    gap[80:90] = 9.0
    thumbs = f[:, 0, 0, :1].astype(np.float32)
    loop, junctions = idle.splice_frames(f, gap, skip=10, max_len=150, min_len=100, thumbs=thumbs)
    v = loop[:, 0, 0, 0].astype(int)
    assert v[0] == v[-1] + 1  # the wrap: two consecutive source frames, unmixed
    assert all(0 < j < len(loop) for j in junctions) and len(junctions) == 2
