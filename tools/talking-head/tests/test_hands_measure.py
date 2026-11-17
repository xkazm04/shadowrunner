"""iris-hands experiment pieces without a GPU or MediaPipe: the gesture/speech lag search, the RMS
envelope, the nvidia-smi parser and the CLI wiring."""

from __future__ import annotations

import numpy as np
import pytest

from th.experiments.hands import health, measure
from th.experiments.hands.__main__ import main
from th.experiments.hands.image import face_frac


def test_best_lag_finds_a_delayed_copy() -> None:
    rng = np.random.default_rng(0)
    env = rng.random(200).astype(np.float32)
    speed = np.r_[np.zeros(4), env[:-4]]  # the hands follow the sound by 4 frames
    r, lag = measure.best_lag(speed, env)
    assert lag == 4
    assert r > 0.99


def test_best_lag_negative_when_hands_lead() -> None:
    rng = np.random.default_rng(1)
    env = rng.random(200)
    speed = np.r_[env[3:], np.zeros(3)]  # hands 3 frames early
    assert measure.best_lag(speed, env)[1] == -3


def test_best_lag_none_on_flat_input() -> None:
    assert measure.best_lag(np.zeros(100), np.ones(100)) is None


def test_rms_envelope_one_value_per_frame() -> None:
    hop = 16000 // measure.FPS
    audio = np.r_[np.zeros(hop), np.full(hop, 16384)].astype(np.int16)
    env = measure.rms_envelope(audio, 3)
    assert env.shape == (3,)
    assert env[0] == 0.0
    assert env[1] == pytest.approx(0.5, abs=1e-3)
    assert env[2] == 0.0  # past the end


def test_spread_is_p95_minus_p5() -> None:
    assert measure.spread(np.arange(101, dtype=np.float64)) == pytest.approx(90.0)


def test_parse_smi() -> None:
    assert health.parse_smi("4272, 24564, 47\n") == (4272, 24564, 47)
    assert health.parse_smi("[N/A], 1, 2") is None
    assert health.parse_smi("") is None


def test_face_frac() -> None:
    assert face_frac(256.0, 1536) == pytest.approx(0.1667, abs=1e-4)


def test_cli_requires_a_command() -> None:
    with pytest.raises(SystemExit):
        main([])


def test_frame_crops_wide_and_pads_tall() -> None:
    from th.experiments.hands.frame import crop_box, pad_width

    # 2:3 source into 480x832 (narrower aspect): trim the sides
    assert crop_box((1024, 1536), (480, 832)) == (69, 0, 955, 1536)
    # 2:3 source into a square: no crop, pad 512 px of backdrop
    assert crop_box((1024, 1536), (768, 768)) is None
    assert pad_width((1024, 1536), (768, 768)) == 512


def test_track_keeps_identity_when_a_hand_crosses_or_drops() -> None:
    frames = [
        [(100.0, 500.0), (300.0, 500.0)],   # ordered by x on the first frame
        [(305.0, 495.0), (102.0, 501.0)],   # detector order flipped: nearest track wins
        [(310.0, 400.0)],                   # one hand (track 1 rises)
        [(98.0, 502.0), (320.0, 300.0)],
    ]
    t = measure.track(frames)
    assert t[0] == {0: (100.0, 500.0), 1: (300.0, 500.0)}
    assert t[1] == {0: (102.0, 501.0), 1: (305.0, 495.0)}
    assert t[2] == {1: (310.0, 400.0)}
    assert t[3][1] == (320.0, 300.0)
