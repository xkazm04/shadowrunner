"""Audio2Face blendshape weights -> th-timeline/1 (th/rig/a2f_map.py), on synthetic curves."""

import numpy as np
import pytest

from th.rig import a2f_map
from th.rig.timeline import Timeline

N = 300  # 10 s at 30 fps


def weights(**curves) -> dict[str, np.ndarray]:
    base = {k: np.zeros(N) for k in ("jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthSmileLeft",
                                       "mouthSmileRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
                                       "browDownLeft", "browDownRight", "eyeSquintLeft", "eyeSquintRight")}
    base.update({k: np.asarray(v, dtype=float) for k, v in curves.items()})
    return base


def test_csv_round_trip(tmp_path):
    p = tmp_path / "w.csv"
    p.write_text("frame,t,jawOpen,mouthFunnel\n0,0,0.5,0.1\n1,533,0.25,0\n", encoding="utf-8")
    w = a2f_map.read_weights(p)
    assert set(w) == {"jawOpen", "mouthFunnel"}
    assert w["jawOpen"].tolist() == [0.5, 0.25]


def test_channels_are_relative_to_the_clips_own_rest():
    jaw = np.full(N, 0.09)       # Mark's rest jaw is not 0
    jaw[100:200] = 0.4
    shrug = np.full(N, 0.39)     # a constant rest offset reads 0
    c = a2f_map.Channels(weights(jawOpen=jaw, mouthShrugLower=shrug), N)
    assert c.norm("jawOpen")[50] == 0 and c.norm("jawOpen")[150] == 1
    assert c.norm("mouthShrugLower").max() == 0
    assert c.raw("jawOpen")[150] == pytest.approx(0.31)


def test_open_jaw_opens_round_lips_round_and_sealed_lips_close():
    jaw = np.zeros(N)
    jaw[30:60] = 0.6          # wide open
    jaw[90:120] = 0.2         # a little open
    funnel = np.zeros(N)
    funnel[150:180] = 0.8     # "oo"
    close = np.zeros(N)
    close[210:240] = 0.3      # lips sealed over a slightly open jaw ("m"), rolled in
    jaw[210:240] = 0.3
    roll = np.zeros(N)
    roll[210:240] = 0.5
    mix = a2f_map.mouth_mix(a2f_map.Channels(weights(jawOpen=jaw, mouthFunnel=funnel, mouthClose=close,
                                                     mouthRollLower=roll), N))
    assert mix["openWide"][45] > 0.9
    assert mix["openMid"][105] > 0.4 and mix["openWide"][105] == 0
    assert mix["round"][165] > 0.7 and mix["openWide"][165] == 0
    assert mix["closed"][225] > 0.4 and mix["openWide"][225] == 0
    total = sum(mix.values())
    assert float(total.max()) <= 1 + 1e-9
    assert float(total[0]) == 0  # silence is rest


def test_timeline_validates_with_rest_padding_and_null_eyes():
    jaw = 0.3 + 0.3 * np.sin(np.arange(N) / 3)
    tl = a2f_map.to_timeline(weights(jawOpen=np.clip(jaw, 0, 1)), N + 15)
    Timeline.model_validate(tl.dump())
    assert len(tl.frames) == N + 15
    assert tl.frames[-1].mouth == {"rest": 1.0}
    assert all(f.blink is None and f.gaze is None for f in tl.frames)
    for f in tl.frames[:N]:
        assert f.mouth is not None and sum(f.mouth.values()) == pytest.approx(1, abs=1e-3)
        assert 0.3 <= f.mouthGain <= 1.5


def test_expression_needs_a_held_signal_and_does_not_flicker():
    smile = np.zeros(N)
    smile[60:200] = 0.8
    blip = np.zeros(N)
    blip[250:253] = 1.0  # a 0.1 s brow-down blip: never shown
    tl = a2f_map.to_timeline(weights(mouthSmileLeft=smile, mouthSmileRight=smile, browDownLeft=blip,
                                     browDownRight=blip), N)
    fams = [f.expression.family if f.expression else None for f in tl.frames]
    assert fams[0] is None and fams[150] == "joy"
    assert "anger" not in fams
    changes = sum(1 for a, b in zip(fams, fams[1:]) if a != b)
    assert changes <= 2


def test_gestures_respect_refractory_periods():
    jaw = 0.3 + 0.2 * np.sin(np.arange(N) / 6)  # syllables: a jaw peak every ~1.3 s
    jaw[100:130] = 0.0  # a 1 s pause, then a phrase starts at 130
    tl = a2f_map.to_timeline(weights(jawOpen=jaw), N)
    marks = [(i, f.gesture) for i, f in enumerate(tl.frames) if f.gesture]
    nods = [i for i, g in marks if g == "nod"]
    assert nods and all(b - a >= a2f_map.NOD_REFRACTORY_S * 30 for a, b in zip(nods, nods[1:]))
    assert any(g == "tilt" and 130 <= i <= 160 for i, g in marks)
    for (a, _), (b, _) in zip(marks, marks[1:]):
        assert b - a >= a2f_map.GESTURE_GAP_S * 30
