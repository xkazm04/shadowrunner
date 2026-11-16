"""th-timeline/1: the wire schema, its committed JSON Schema and the validation rules."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from th.rig.timeline import FPS, SCHEMA, Timeline, empty_frame, json_schema, load_timeline

SCHEMA_FILE = Path(__file__).resolve().parents[1] / "th" / "rig" / "th-timeline.schema.json"


def frame(i: int, **over) -> dict:
    base = {"t": i / FPS, "mouth": {"openMid": 0.4, "rest": 0.6}, "mouthGain": 1.0,
            "expression": {"family": "joy", "w": 0.5}, "gesture": None, "blink": None, "gaze": None}
    base.update(over)
    return base


def timeline(frames: list[dict]) -> dict:
    return {"schema": SCHEMA, "fps": 30, "frames": frames}


def test_valid_timeline_round_trips(tmp_path):
    tl = Timeline.model_validate(timeline([frame(0), frame(1, gesture="nod"), frame(2, mouth=None)]))
    p = tl.write(tmp_path / "t.json")
    back = load_timeline(p)
    assert back.dump() == tl.dump()
    assert json.loads(p.read_text())["schema"] == "th-timeline/1"
    assert tl.duration_s == pytest.approx(0.1)


def test_empty_frame_is_all_null():
    f = empty_frame(3).model_dump()
    assert f["t"] == pytest.approx(0.1)
    assert all(f[k] is None for k in ("mouth", "mouthGain", "expression", "gesture", "blink", "gaze"))


@pytest.mark.parametrize("bad", [
    {"mouth": {"smile": 0.5}},               # not a mouth shape
    {"mouth": {"openWide": 1.5}},            # outside 0..1
    {"mouthGain": 2.0},                      # outside 0.3..1.5
    {"expression": {"family": "rage", "w": 0.5}},
    {"expression": {"family": "joy", "w": 1.2}},
    {"gesture": "wave"},
    {"blink": -0.1},
    {"gaze": [0.0, 2.0]},
    {"extra": 1},                            # unknown key
])
def test_bad_frames_are_refused(bad):
    with pytest.raises(ValidationError):
        Timeline.model_validate(timeline([frame(0, **bad)]))


def test_every_frame_key_is_required():
    f = frame(0)
    del f["gaze"]
    with pytest.raises(ValidationError):
        Timeline.model_validate(timeline([f]))


def test_frames_are_on_the_30fps_clock_and_not_empty():
    with pytest.raises(ValidationError, match="not frame 1"):
        Timeline.model_validate(timeline([frame(0), frame(0)]))
    with pytest.raises(ValidationError):
        Timeline.model_validate(timeline([]))
    with pytest.raises(ValidationError):
        Timeline.model_validate({**timeline([frame(0)]), "fps": 25})


def test_committed_json_schema_matches_the_model():
    assert json.loads(SCHEMA_FILE.read_text(encoding="utf-8")) == json_schema()
    frame_def = json_schema()["$defs"]["Frame"]
    assert set(frame_def["required"]) == {"t", "mouth", "mouthGain", "expression", "gesture", "blink", "gaze"}
    assert frame_def["additionalProperties"] is False
