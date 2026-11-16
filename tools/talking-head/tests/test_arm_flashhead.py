"""realtime-fh (SoulX-FlashHead): licence gate, driver protocol and the streaming plumbing (a fake
driver stands in for the model); no GPU, no weights."""

from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pytest

from conftest import needs_ffmpeg
from th.arms.base import ArmNotBuilt, Job
from th.arms.flashhead import DRIVER, PARTS, FlashHeadArm, parse_stats, read_chunks, stats_note


def job(tmp_path: Path) -> Job:
    return Job(arm="realtime-fh", script="smoke-6s", script_text="hi", audio=tmp_path / "a.wav",
               audio_s=1.0, portrait=tmp_path / "p.png", seed=3, runtime="native",
               run_dir=tmp_path, log=tmp_path / "log.txt")


@pytest.fixture
def arm(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("TH_FH_MODEL", raising=False)
    return FlashHeadArm()


def stats(fps: float = 30.0, slow: int = 0) -> dict:
    return {"modelLoadS": 9.0, "warmupS": 2.0, "ttffMs": 410.0, "bufferMs": 1120.0, "frames": 56,
            "genS": 56 / fps, "fps": fps, "chunkS": [0.9, 0.9], "chunkBudgetS": 1.12,
            "slowChunks": slow, "targetFps": 25, "compile": False, "model": "lite"}


def test_lite_is_the_default_pro_optional_others_refused(arm, monkeypatch):
    assert arm.model_type() == "lite"
    monkeypatch.setenv("TH_FH_MODEL", "pro")
    assert arm.model_type() == "pro"
    monkeypatch.setenv("TH_FH_MODEL", "pretrained")
    with pytest.raises(ArmNotBuilt, match="TH_FH_MODEL"):
        arm.preflight("native")


def test_ltx_vae_row_carries_openrail_and_its_restriction_note():
    rows = {tuple(p.allow or ()): p for p in PARTS}
    ltx = rows[("VAE_LTX/*",)]
    assert ltx.licence.startswith("OpenRAIL-M") and "use restrictions" in ltx.licence
    rest = [p for p in PARTS if p is not ltx]
    assert all(p.licence.startswith("Apache-2.0") for p in rest)
    assert all(not any("LTX" in a for a in (p.allow or ())) for p in rest)
    assert all(len(p.revision) == 40 for p in PARTS)


def test_command_passes_pro_portrait_audio_seed(arm, tmp_path):
    argv = arm.command(job(tmp_path))
    assert argv[0] == str(arm.env.python) and argv[1] == "th_stream.py"
    assert argv[4] == "lite" and argv[7] == "3"
    assert argv[5] == (tmp_path / "p.png").resolve().as_posix()


def test_driver_is_valid_python_and_redirects_prints():
    compile(DRIVER, "th_stream.py", "exec")
    assert "os.dup2(2, 1)" in DRIVER and "TH_STATS" in DRIVER


def test_read_chunks_round_trip_and_truncation():
    a = np.arange(2 * 4 * 6 * 3, dtype=np.uint8).reshape(2, 4, 6, 3)
    b = np.full((1, 4, 6, 3), 7, np.uint8)
    blob = b"".join(struct.pack("<III", *c.shape[:3]) + c.tobytes() for c in (a, b))
    got = list(read_chunks(io.BytesIO(blob)))
    assert len(got) == 2 and np.array_equal(got[0], a) and np.array_equal(got[1], b)
    assert len(list(read_chunks(io.BytesIO(blob[:-5])))) == 1  # a cut-off chunk is dropped


def test_stats_note_says_whether_it_kept_real_time():
    lines = ["noise\n", "TH_STATS " + json.dumps(stats()) + "\n"]
    s = parse_stats(lines)
    assert s and s["ttffMs"] == 410.0
    assert "kept real time" in stats_note(s) and "410 ms" in stats_note(s)
    assert "did NOT keep" in stats_note(stats(fps=20.0))
    assert "did NOT keep" in stats_note(stats(slow=1))
    assert "stats missing" in stats_note(None)


FAKE = r'''
import json, struct, sys
import numpy as np
out = sys.stdout.buffer
print("loading", file=sys.stderr)
for k in range(2):
    arr = np.full((3, 16, 16, 3), 40 * (k + 1), np.uint8)
    out.write(struct.pack("<III", *arr.shape[:3])); out.write(arr.tobytes()); out.flush()
print("TH_STATS " + json.dumps(__STATS__), file=sys.stderr, flush=True)
'''


@needs_ffmpeg
def test_streaming_plumbing_calls_on_frame_per_frame_and_encodes(arm, tmp_path, monkeypatch):
    fake = tmp_path / "fake_driver.py"
    fake.write_text(FAKE.replace("__STATS__", repr(stats())), encoding="utf-8")
    arm.env.repo.mkdir(parents=True)
    monkeypatch.setattr(FlashHeadArm, "command", lambda self, j: [sys.executable, str(fake)])
    seen: list[np.ndarray] = []
    res = arm.render_native(job(tmp_path), seen.append)
    assert len(seen) == 6 and seen[0].shape == (16, 16, 3) and seen[-1][0, 0, 0] == 80
    assert res.video.is_file() and res.video.stat().st_size > 0
    assert "kept real time" in (res.notes or "")
    log = (tmp_path / "log.txt").read_text(encoding="utf-8")
    assert "loading" in log and "TH_STATS" in log
    assert (arm.env.repo / "th_stream.py").read_text(encoding="utf-8") == DRIVER
