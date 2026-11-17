"""iris-hands round 2: the per-frame hand check on synthetic landmarks (no MediaPipe, no video)."""

from __future__ import annotations

import numpy as np

from th.experiments.hands import handcheck as hc

SIZE = (624, 928)


def _world() -> np.ndarray:
    """A flat open right hand in metres: wrist at the origin, knuckles 9 cm up, fingers straight."""
    w = np.zeros((21, 3), np.float32)
    w[1:5] = [(-0.03, 0.02, 0), (-0.045, 0.04, 0), (-0.055, 0.06, 0), (-0.065, 0.075, 0)]
    for k, (mcp, x) in enumerate(zip(hc.KNUCKLES, (-0.025, -0.005, 0.015, 0.033))):
        length = (0.045, 0.028, 0.022) if k < 3 else (0.035, 0.02, 0.018)
        y = 0.09
        w[mcp] = (x, y, 0)
        for j, seg in enumerate(length, start=1):
            y += seg
            w[mcp + j] = (x, y, 0)
    return w


def _hand(dx: float = 0.0, score: float = 0.99, lum: float = 180.0, scale: float = 1000.0) -> hc.Hand:
    w = _world()
    xy = np.c_[w[:, 0] * scale + 300 + dx, 700 - w[:, 1] * scale].astype(np.float32)
    return hc.Hand(xy, w, score, "Right", lum)


def test_a_plain_hand_passes_the_geometry() -> None:
    w = _world()
    assert hc.bone_flags(w) == []
    assert hc.shape_flags(w) == []


def test_a_collapsed_phalanx_and_fused_knuckles_are_flagged() -> None:
    w = _world()
    w[7] = w[6] + (w[7] - w[6]) * 0.02     # index middle phalanx collapses to a stub
    assert any(f.startswith("bones:index2") for f in hc.bone_flags(w))
    w = _world()
    w[9] = w[5] + 0.0005                    # middle knuckle fused onto the index knuckle
    assert any(f.startswith("shape:knuckles0") for f in hc.shape_flags(w))


def test_fit_residual_ignores_motion_but_sees_shape_change() -> None:
    a = _hand().xy
    th = np.radians(20)
    rot = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]], np.float32)
    moved = (a - a.mean(0)) @ rot.T * 1.3 + a.mean(0) + (40, -25)
    assert hc.fit_residual(a, moved) < 1e-3
    warped = moved.copy()
    warped[8] += (0, 120)                    # the index tip folds back by 120 px
    assert hc.fit_residual(a, warped) / hc.hand_size(warped) > hc.JUMP_MAX


def test_check_flags_conf_jump_fade_and_a_melted_hand() -> None:
    frames = [[_hand()] for _ in range(20)]
    frames[3] = [_hand(score=0.90)]
    frames[6] = [_hand(lum=80.0)]
    bent = _hand()
    bent.xy = bent.xy.copy()
    bent.xy[8] += (0, 120)
    frames[9] = [bent]
    for i in range(14, 20):
        frames[i] = []                       # vanishes in the middle of the frame
    checks = hc.check(frames, SIZE)
    assert any("conf" in f for f in checks[3].flags)
    assert any("faded" in f for f in checks[6].flags)
    assert any("jump" in f for f in checks[9].flags)
    assert all(c.flags == ["0:lost"] for c in checks[14:])
    assert checks[0].good and checks[12].good


def test_a_hand_that_leaves_the_frame_is_not_lost() -> None:
    frames = [[_hand(dx=-280)] for _ in range(5)] + [[] for _ in range(5)]  # at the left edge
    checks = hc.check(frames, SIZE)
    assert all(c.hands == 0 for c in checks[5:])


def test_two_hands_keep_their_tracks() -> None:
    left, right = _hand(dx=-150), _hand(dx=150)
    tracks = hc.track([[right, left], [left, right], [right]])
    assert tracks[0][0] is left and tracks[1][1] is right
    assert list(tracks[2]) == [1]


def test_score_is_the_good_share_and_the_worst_window() -> None:
    checks = [hc.FrameCheck(hands=1) for _ in range(50)]
    for i in range(30, 36):
        checks[i].flags.append("0:conf=0.9")
    checks.append(hc.FrameCheck(hands=0))    # a frame with no hand does not count
    s = hc.score(checks)
    assert s.hand_frames == 50
    assert s.good_share == round(44 / 50, 4)
    assert s.worst_window == round(7 / 13, 4) and 23 <= s.worst_at <= 30
    assert s.flagged == list(range(30, 36))
    assert hc.score([hc.FrameCheck()]).good_share is None


def test_seam_join_ratio_finds_a_pop_inside_the_crossfade() -> None:
    from th.experiments.hands.seam import joins

    steps = np.full(300, 2.0, np.float32)
    steps[118] = 20.0                        # a pop at the end of the first crossfade (112 + 6)
    face = np.full(300, 0.01)
    js = joins(steps, face, [(0, 121), (112, 121), (224, 76)], overlap=9)
    assert [j.frame for j in js] == [112, 224]
    assert js[0].step_ratio == 10.0 and js[1].step_ratio == 1.0
    assert js[0].face_ratio == 1.0


def test_interlaced_hands_skip_the_geometry_flags() -> None:
    a, b = _hand(), _hand(dx=40)            # boxes overlap: clasped hands
    a.world = a.world.copy()
    a.world[9] = a.world[5] + 0.0005        # MediaPipe's fused-knuckle noise on interlaced fingers
    assert hc.overlapped({0: a, 1: b})
    checks = hc.check([[a, b]], SIZE)
    assert not any("shape" in f for f in checks[0].flags)
    alone = hc.check([[a]], SIZE)
    assert any("shape" in f for f in alone[0].flags)


def test_a_hand_hidden_behind_the_other_is_not_lost() -> None:
    left, right = _hand(dx=-20), _hand(dx=20)   # clasped: the boxes meet
    frames = [[left, right]] * 3 + [[right]] * 4
    checks = hc.check(frames, SIZE)
    assert all(c.good for c in checks)


def test_clasped_hands_are_not_judged_on_score() -> None:
    a, b = _hand(score=0.94), _hand(dx=40, score=0.95)   # boxes overlap
    c = hc.check([[a, b]], SIZE)[0]
    assert c.good and c.hands == 0 and c.clasped == 2      # not a hand frame
    assert hc.score([c]).good_share is None
    assert not hc.check([[_hand(score=0.94)]], SIZE)[0].good
