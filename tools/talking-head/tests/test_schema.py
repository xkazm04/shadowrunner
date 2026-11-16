import json

import pytest
from pydantic import ValidationError

from th.schema import ARM_IDS, SCHEMA, RunRecord, json_schema, load_run


def record(**over) -> dict:
    base = {
        "schema": SCHEMA, "arm": "noop", "script": "pitch-45s", "seed": 1116,
        "portrait": "assets/characters/companions/iris/portrait.png", "runtime": "native",
        "width": 1080, "height": 1080, "fps": 30.0, "durationS": 44.9, "renderS": 3.0, "rtf": 0.07,
        "ttffMs": None, "vramPeakMiB": 0, "gpuExclusive": True,
        "sync": {"conf": 0.05, "offsetFrames": None},
        "identity": {"mean": 0.99, "min": 0.98, "p5": 0.98},
        "faceRoi": [454, 509, 182, 75],
        "weights": [{"name": "w", "licence": "MIT", "url": "https://example.com", "revision": "abc"}],
        "notes": None,
    }
    base.update(over)
    return base


def test_valid_record_round_trips(tmp_path):
    rec = RunRecord.model_validate(record())
    p = tmp_path / "run.json"
    rec.write(p)
    data = json.loads(p.read_text())
    assert data["schema"] == "th-run/1"
    assert list(data) == list(record())  # wire order and every key present
    assert data["ttffMs"] is None and "ttffMs" in data
    assert load_run(p) == rec


def test_absent_values_are_null_not_missing():
    data = record()
    del data["ttffMs"]
    with pytest.raises(ValidationError):
        RunRecord.model_validate(data)


def test_unknown_key_and_wrong_schema_rejected():
    with pytest.raises(ValidationError):
        RunRecord.model_validate(record(extra=1))
    with pytest.raises(ValidationError):
        RunRecord.model_validate(record(schema="th-run/2"))
    with pytest.raises(ValidationError):
        RunRecord.model_validate(record(sync={"conf": 1.0}))
    with pytest.raises(ValidationError):
        RunRecord.model_validate(record(runtime="wsl"))


def test_null_everywhere_measured_is_allowed():
    rec = RunRecord.model_validate(record(
        renderS=None, rtf=None, vramPeakMiB=None, gpuExclusive=None, faceRoi=None,
        sync={"conf": None, "offsetFrames": None}, identity={"mean": None, "min": None, "p5": None},
    ))
    assert rec.dump()["identity"] == {"mean": None, "min": None, "p5": None}


def test_json_schema_requires_every_key():
    js = json_schema()
    assert set(js["required"]) == set(record())


def test_arm_ids_match_spec():
    assert ARM_IDS == ("noop", "baseline", "diffusion-it", "diffusion-sa", "realtime-fh", "dub-ls", "a2f-keys")
