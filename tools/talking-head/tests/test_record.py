"""th/record.py: the one th-run/1 record builder every producer calls (render, live-bench, dub_repost)."""

from pathlib import Path

from th.paths import TOOL_DIR, portrait_path
from th.post.metrics import Metrics
from th.record import (
    Provenance, Timing, build_record, contention_notes, gpu_exclusive, join_notes, repo_relative, stage,
)

PROBE = {"format": {"duration": "44.9"},
         "streams": [{"codec_type": "audio"},
                     {"codec_type": "video", "width": 1080, "height": 1080, "r_frame_rate": "30/1"}]}
PROV = Provenance(arm="noop", script="pitch-45s", seed=1116,
                  portrait="assets/characters/companions/iris/portrait.png", runtime="native")


def test_build_record_rtf_is_render_over_audio_seconds():
    rec = build_record(probe=PROBE, metrics=Metrics(), timing=Timing(render_s=50.5, audio_s=44.89),
                       provenance=PROV, weights=[], notes=None)
    assert rec.rtf == round(50.5 / 44.89, 4) == 1.125
    d = rec.dump()
    assert (d["width"], d["height"], d["fps"], d["durationS"], d["renderS"]) == (1080, 1080, 30.0, 44.9, 50.5)
    assert d["schema"] == "th-run/1" and d["arm"] == "noop" and d["portrait"] == PROV.portrait
    assert d["sync"] == {"conf": None, "offsetFrames": None} and d["gpuExclusive"] is None
    assert d["ttffMs"] is None and d["vramPeakMiB"] is None and d["notes"] is None


def test_build_record_rtf_uses_audio_seconds_not_video_duration():
    probe = {**PROBE, "format": {"duration": "60.0"}}
    rec = build_record(probe=probe, metrics=Metrics(),
                       timing=Timing(render_s=48.0, audio_s=40.0, ttff_ms=812.5, vram_peak_mib=9000),
                       provenance=PROV, weights=[], notes="live", gpu_exclusive=True)
    assert rec.durationS == 60.0
    assert rec.rtf == 1.2  # 48 / 40, never 48 / 60
    assert (rec.ttffMs, rec.vramPeakMiB, rec.gpuExclusive, rec.notes) == (812.5, 9000, True, "live")


def test_build_record_without_render_time_has_null_rtf():
    rec = build_record(probe=PROBE, metrics=Metrics(), timing=Timing(render_s=None, audio_s=44.89),
                       provenance=PROV, weights=[], notes=None)
    assert rec.renderS is None and rec.rtf is None


def test_gpu_exclusive_tri_state():
    assert gpu_exclusive(None, []) is None
    assert gpu_exclusive([], None) is None
    assert gpu_exclusive([], []) is True
    assert gpu_exclusive([(4, 900)], []) is False
    assert gpu_exclusive([], [(4, 900)]) is False


def test_contention_notes():
    assert contention_notes("start", [(12, 900)]) == ["other GPU processes at start: pid 12 900 MiB"]
    assert contention_notes("end", None) == ["gpuExclusive unmeasurable at end (no per-process VRAM figure)"]
    assert contention_notes("end", []) == []
    assert contention_notes("start", [(1, 600), (2, 700)]) == [
        "other GPU processes at start: pid 1 600 MiB, pid 2 700 MiB"]


def test_join_notes():
    assert join_notes(["arm note", None, "", "m1"], extra=["c1"]) == "arm note; m1; c1"
    assert join_notes([None, ""]) is None
    rec = build_record(probe=PROBE, metrics=Metrics(), timing=Timing(render_s=1.0, audio_s=2.0),
                       provenance=PROV, weights=[], notes=join_notes([None, ""], extra=[]))
    assert "notes" in rec.dump() and rec.dump()["notes"] is None


def test_repo_relative():
    outside = Path(TOOL_DIR.anchor) / "elsewhere-xyz" / "portrait.png"
    assert repo_relative(outside) == outside.as_posix()
    assert repo_relative(portrait_path()) == "assets/characters/companions/iris/portrait.png"


def test_stage_logs_one_line_and_returns_value(tmp_path):
    log = tmp_path / "log.txt"
    log.write_text("head\n", encoding="utf-8")
    out = stage(log, "normalise", lambda a, b=0: a + b, 2, b=3)
    assert out == 5
    lines = log.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "head" and len(lines) == 2
    assert lines[1].startswith("stage normalise: ") and lines[1].endswith("s")
    float(lines[1].removeprefix("stage normalise: ").removesuffix("s"))


def test_producers_do_not_hand_build_the_record():
    th = TOOL_DIR / "th"
    for rel in ("render.py", "rig/dub_repost.py", "live/bench.py"):
        src = (th / rel).read_text(encoding="utf-8")
        assert "RunRecord(" not in src, rel
    assert "from ..render import" not in (th / "live" / "bench.py").read_text(encoding="utf-8")
