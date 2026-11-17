"""Gaze glances (th/live/gaze.py and the engine's switch): the scheduler, the reference switch on a
fake pipeline, the live window over the idle loop, and the bust crops (round 3)."""

from __future__ import annotations

import time

import numpy as np
from PIL import Image

from th.live.engine import Engine, Line, Segment
from th.live.gaze import GazePolicy, gaze_refs
from th.live.models import BUST_BOX, SLICE_SAMPLES, FakeModel


def speech_glances(policy: GazePolicy, chunks: int) -> list[tuple[int, str]]:
    for k in range(chunks):
        policy.decide(k, 1 if k % 2 == 0 else 0, True)
    return policy.log


def test_speech_glances_at_about_30_percent_of_boundaries_left_or_right_never_back_to_back():
    log = speech_glances(GazePolicy("natural", 1), 2000)
    ks = [k for k, _ in log]
    assert all(k % 2 == 0 for k in ks)  # only chunks that hold a sentence start
    assert min(np.diff(ks)) * 0.96 >= 3.0  # the minimum gap
    assert {r for _, r in log} == {"gazeL", "gazeR"}  # no up or down while speaking
    rate = len(ks) / 1000  # per boundary
    assert 0.15 < rate < 0.3  # 30 % per eligible boundary, thinned by the 3 s gap
    assert len(speech_glances(GazePolicy("lively", 1), 2000)) > len(log)
    assert speech_glances(GazePolicy("off", 1), 2000) == []
    assert speech_glances(GazePolicy("natural", 1, speech=False), 2000) == []  # the owner's switch
    assert speech_glances(GazePolicy("natural", 1), 2000) == log  # deterministic


def test_idle_glances_every_6_to_10_s_planned_one_chunk_ahead():
    p = GazePolicy("natural", 2)
    shown = []
    for k in range(400):
        planned = p.planned
        ref = p.decide(k, 0, False)
        if ref != "main":
            assert planned == (k, ref)  # announced one chunk before
            shown.append(k)
    gaps = np.diff(shown) * 0.96
    assert len(shown) > 30 and gaps.min() >= 5.7 and gaps.max() <= 11.0
    lively = GazePolicy("lively", 2)
    assert sum(lively.decide(k, 0, False) != "main" for k in range(400)) > len(shown)


def test_speech_cancels_a_planned_idle_glance():
    p = GazePolicy("natural", 3)
    k = 0
    while p.planned is None:
        p.decide(k, 0, False)
        k += 1
    assert p.decide(k, 0, True) == "main" and p.planned is None


class RefModel(FakeModel):
    def __init__(self) -> None:
        super().__init__(size=32, compute_s=0)
        self.refs = {"gazeL": None, "gazeR": None}
        self.switches: list[tuple[str, bool]] = []

    def set_reference(self, name: str, keep_motion: bool = True) -> None:
        self.switches.append((name, keep_motion))
        super().set_reference(name, keep_motion)


def _engine(model, loop=None) -> Engine:
    e = Engine(model, lambda kind, payload: None, raw_frames=True, loop=loop, motion="natural", seed=4)
    e._t0 = time.perf_counter()
    return e


def test_engine_switches_the_reference_for_one_chunk_and_back_keeping_motion():
    m = RefModel()
    e = _engine(m)
    for k in range(40):  # 38 s of idle
        e._compute(k)
    glances = [i for i, r in enumerate(m.references) if r != "main"]
    assert glances and all(m.references[i + 1] == "main" for i in glances if i + 1 < len(m.references))
    assert all(keep for _, keep in m.switches)  # never upstream's reset_person_name
    assert [r for _, r in e.gaze.log] == [m.references[i] for i in glances]
    assert len(e.stats["motion"]) > 0 and e.stats["motionMs"]


def test_idle_glance_shows_the_live_model_over_the_loop_around_the_switch():
    m = RefModel()
    loop = np.zeros((10, 32, 32, 3), np.uint8)
    e = _engine(m, loop)
    modes = []
    for k in range(30):
        modes.append(e._compute(k).idle)
        if m.references[-1] != "main":
            break
    g = len(modes) - 1
    assert m.references[g] != "main" and g > 2
    assert modes[g] == "live" and modes[g - 2] == "loop"  # live for the glance, the loop otherwise
    assert e._live_at((g * 24 - 3) * 40.0) and not e._live_at((g * 24 - 12) * 40.0)
    assert e._live_at((g * 24 + 29) * 40.0) and not e._live_at((g * 24 + 40) * 40.0)


def test_speech_glance_at_a_sentence_start_and_no_dissolve_in_speech():
    m = RefModel()
    e = _engine(m)
    e.gaze.rng = np.random.default_rng(0)
    from th.live import gaze

    old = dict(gaze.P_SPEECH)
    gaze.P_SPEECH["natural"] = 1.0
    try:
        ln = Line("a", "x")
        e.open_line(ln)
        pcm = (np.random.default_rng(1).standard_normal(SLICE_SAMPLES * 8) * 0.1).astype(np.float32)
        for i in range(8):  # eight one-chunk sentences
            seg = pcm[i * SLICE_SAMPLES:(i + 1) * SLICE_SAMPLES]
            e.enqueue(Segment(ln, seg, seg, 16000))
        dissolved = []
        orig = e._dissolve
        e._dissolve = lambda *a: dissolved.append(a[2]) or orig(*a)
        for k in range(8):
            e._compute(k)
    finally:
        gaze.P_SPEECH.update(old)
    refs = m.references
    assert refs[0] == "main" or refs[0] in ("gazeL", "gazeR")
    assert any(r in ("gazeL", "gazeR") for r in refs) and dissolved == []


def test_gaze_refs_are_bust_crops_of_the_edits(tmp_path):
    refs = gaze_refs(out=tmp_path)
    assert set(refs) == {"gazeL", "gazeR", "gazeU", "gazeD"}
    im = Image.open(refs["gazeL"])
    w, h = BUST_BOX[2] - BUST_BOX[0], BUST_BOX[3] - BUST_BOX[1]
    assert im.size == (w, h)
    t = refs["gazeL"].stat().st_mtime
    gaze_refs(out=tmp_path)
    assert refs["gazeL"].stat().st_mtime == t  # written once
