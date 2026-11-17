"""Head motion (th/live/motion.py): determinism, levels, nods and tilts from the audio (rounds 3-4;
applying it to the head is tests/test_live_headlayer.py)."""

from __future__ import annotations

import numpy as np
import pytest

from th.live.motion import HOP, Motion

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
    assert 0.5 < r(nat, 2) < 4.0 and 1.0 < r(nat, 0) < 12.0  # degrees and px: small and natural


def test_nods_follow_onsets_with_a_refractory_period_and_idle_has_none():
    m = Motion("natural", 3)
    run(m, np.concatenate([speech(8), np.zeros(16000 * 12, np.float32)]))
    nods = [i for i, kind in m.events if kind == "nod"]
    assert len(nods) >= 3 and min(np.diff(nods)) >= 50  # at most one per 2 s (round 4)
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


def test_tilts_come_at_sentence_ends_not_starts():
    """A sentence start after voice tilts from the previous sentence's last voiced frame; a line's
    first sentence does not tilt; the line's last sentence tilts after a long pause."""
    t = np.arange(16000 * 8) / 16000
    a = (0.1 * np.random.default_rng(1).standard_normal(len(t))).astype(np.float32)
    a[(t > 3.0) & (t < 3.6)] = 0  # sentence 1 ends at 3.0 s, sentence 2 starts at 3.6 s
    a[t > 6.0] = 0  # the line ends at 6.0 s
    a[t < 1.0] = 0  # sentence 1 starts at 1.0 s
    m = Motion("natural", 4)
    run(m, a, sentences={1: [40.0], 3: [3600.0 - 3 * 960.0]})
    tilts = [i for i, kind in m.events if kind == "tilt"]
    assert tilts[0] == 75  # 3.0 s: right after the last voiced frame, inside the mark's chunk
    assert tilts[1] == 160  # the 11th quiet frame after the last voiced one (149): 0.44 s
    assert len(tilts) == 2 and not any(kind == "nod" and i < 25 for i, kind in m.events)
